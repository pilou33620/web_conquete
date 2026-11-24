//! Tour par tour, mois par mois (à la Civilization ou Empire : Total War), bâti sur la simulation continue.
//!
//! Un tour = un mois, en deux temps :
//!
//! 1. **Le tour du joueur** (phase « ordres ») : la date ne bouge pas, et chaque ordre s'exécute tout de suite.
//!    Une armée qui reçoit un ordre de marche part aussitôt, sous vos yeux, et avance jusqu'à épuiser ses jours de
//!    marche du mois (march_days : tout le mois) ou jusqu'à rencontrer l'ennemi ; si la route est plus longue, elle
//!    la reprend d'elle-même au tour suivant. Une bataille qu'elle déclenche se livre sur-le-champ (jouée sur le champ de
//!    bataille, ou réglée par le général : resolve_battle_now), un assaut aussi. Les achats, constructions, recherches
//!    et décisions de gouvernement sont payés tout de suite ; les travaux, eux, avancent avec le temps.
//! 2. **Le tour des IA** (« Tour suivant ») : le mois est calculé d'un coup, aussi vite que possible (une ou deux
//!    secondes), par tranches de BUDGET secondes pour que le serveur réponde encore au navigateur : les IA marchent,
//!    négocient et se battent, les travaux et les sièges avancent, les revenus tombent. Vos armées, qui ont déjà joué,
//!    restent en place (Game.paused). Tout s'arrête au 1er du mois suivant, à 0 h : les batailles encore en cours sont
//!    réglées, les jours de marche sont rendus (begin_turn) et c'est de nouveau à vous.
//!
//! Le tour des IA ne s'interrompt que si le joueur doit choisir, comme dans Total War :
//! - une bataille où il a une armée ou une place attend son choix (la livrer ou la laisser au général) ;
//! - une décision l'attend (événement historique ou local) ;
//! - la partie est finie.
//! Le choix fait (bataille réglée, décision prise), le tour des IA reprend tout seul. Le reste (armée ennemie sur ses
//! terres, siège, guerre, proposition, nouvelle époque, traité) n'arrête plus rien : c'est dans le récapitulatif.
//!
//! Pendant le tour des IA, le journal est relu pas à pas pour préparer le récapitulatif du mois (batailles, places prises
//! ou perdues, constructions, découvertes, revenus), affiché au début du tour suivant.
//!
//! Le temps se compte en tours (SPEC-TOURS.md) : la production avance d'un tour de travail par mois (work), les durées
//! finissent au début d'un tour du joueur et lui laissent des tours entiers (deadline), l'écran dit « au prochain tour »,
//! « dans N tours » (tours_left, ready_in, eta).
//!
//! Le temps réel d'origine (vitesses ×½ à ×30) reste disponible : tour['on'] = False.
//!
//! Porte game/turns.py (PORTAGE.md). `g.tour` : le dict de new_state ; `t`, `until`, `end` : des jours de
//! la partie (f64) ; `calendar.monthrange(y, m)[1]` : `Date::days_in_month(y, m)`.
#![allow(non_snake_case)]

use crate::army_actions as AA;
use crate::crue as CR;
use crate::engine::{Date, Game, SUBSTEP};
use crate::py::{self, Val};
use crate::rules as R;
use crate::engine::raccord as TB;
use crate::{dict, list, py_const, pyset, tup};

/// `round(v, n)` d'une valeur : un entier reste un entier, comme en Python (aide du portage).
fn _round_v(v: &Val, n: i32) -> Val {
    if v.is_float() { Val::from(py::round_n(v.f(), n)) } else { Val::from(v.i()) }
}

pub const BUDGET: f64 = 0.25;  // secondes de calcul du tour des IA par appel (la boucle du serveur appelle toutes les 0,1 s)
pub const MARCH_FRAC: f64 = 1.0;  // part du mois qu'une armée peut marcher pendant le tour du joueur (1 : tout le mois, comme les IA)
pub const MARCH_STEP: f64 = 0.1;  // jours : pas de la marche instantanée (rencontres examinées à chaque pas, contact à 2,6 km)
pub const RETREAT_DAYS: f64 = 4.0;  // jours de marche d'une armée battue qui se replie, tout de suite, pendant le tour du joueur
pub const TRAIL_PTS: i64 = 90;  // points gardés du trajet d'une marche, pour l'animer dans le navigateur
pub const FOE_MIN_MEN: i64 = 150;  // récapitulatif : un parti de moins de 150 hommes (éclaireurs, fourrageurs) sur vos terres n'y est pas
py_const!(PRIORITY, list!["fin", "decision", "bataille"]);
pub const MAX_ITEMS: i64 = 30;  // par rubrique du récapitulatif
/// `_DIPLO = re.compile(r"guerre|paix|alliance|trêve|soumi|vassal|traité")` : pas les accords de commerce ni les
/// échanges. (Pas d'expressions régulières dans la caisse : `_DIPLO.search(txt)` s'écrit `_DIPLO(txt)`.)
pub fn _DIPLO(txt: &str) -> bool {
    ["guerre", "paix", "alliance", "trêve", "soumi", "vassal", "traité"].iter().any(|m| txt.contains(m))
}
/// `_BUILT = re.compile(r"^(Fin des travaux à |Magasin aux vivres construit à )|( terminées à | s'agrandit )")` :
/// `_BUILT.search(txt)` s'écrit `_BUILT(txt)`.
pub fn _BUILT(txt: &str) -> bool {
    txt.starts_with("Fin des travaux à ") || txt.starts_with("Magasin aux vivres construit à ")
        || txt.contains(" terminées à ") || txt.contains(" s'agrandit ")
}

/// État du tour par tour, enregistré dans la sauvegarde (Game.tour).
/// Python : `new_state(on=True)`.
/// on : True par défaut.
// game/turns.py, lignes 54 à 56
pub fn new_state(on: bool) -> Val {
    dict! {"on" => on, "end" => Val::None, "stop" => Val::None, "seen" => Val::None, "acc" => Val::None, "recap" => Val::None}
}

/// Anciennes sauvegardes (avant le tour par tour) : elles passent au tour par tour, comme les nouvelles parties.
/// Le réglage avancé du menu rend le temps réel.
/// Python : `migrate(g)`.
/// `getattr(g, 'tour', None)` : g.tour (None le temps d'un chargement).
// game/turns.py, lignes 59 à 89
pub fn migrate(g: &mut Game) {
    if !g.tour.is_dict() {
        g.tour = new_state(true);
    }
    let tr = g.tour.clone();
    for (k, v) in new_state(true).items() {
        tr.setdefault(k, v);
    }
    let seen = tr.at("seen");
    if !seen.is_dict() || !(seen.len() == 2 && seen.has("bt") && seen.has("ev")) {
        tr.set("seen", Val::None);
    }
    for k in ["pace", "last", "mem"] {
        tr.pop(k); // (ancien rythme du tour des IA, anciennes interruptions : le mois se calcule d'un coup)
    }
    if tr.at("end").is_some() && tr.atf("end") <= g.t - 1e-6 {
        tr.set("end", Val::None); // échéance dépassée (sauvegarde bricolée) : on attend les ordres
    }
    for a in g.armies.values() {
        a.setdefault("mp", Val::None);
    }
    // échéances d'avant les tours (en plein milieu d'un mois) : ramenées au début du tour suivant
    let up = |g: &Game, t: Val| if t.f() <= g.t { t } else { Val::from(turn_start_after(g, t.f())) }; // (déjà échue : elle le reste)
    // (celles entre IA gardent leur rythme, n mois à partir de leur début : voir deadline)
    for (code, f) in g.factions.items() {
        for d in [f.at("truce"), f.get("passage").or(dict! {})] {
            for k in d.keys() {
                if g.player == code.s() || g.player == k.s() {
                    d.set(&k, up(g, d.at(&k)));
                }
            }
        }
    }
    for x in g.proposals.iter() {
        x.set("expires", up(g, x.at("expires")));
    }
    for x in g.pending_ev.iter() {
        x.set("until", up(g, x.at("until")));
    }
    for n in g.nodes.iter() {
        if n.at("owner") == g.player.as_str() {
            for e in n.get("tm").or(list![]).iter() {
                e.set("until", up(g, e.at("until")));
            }
        }
    }
}

// ================================================================== calendrier

/// Échéance du tour : le 1er du mois suivant (ou du k-ième mois après celui de t), à 0 h, en jours depuis le début de
/// la partie.
/// Python : `month_end(g, t=None, k=1)`.
/// t : None (par défaut : maintenant) ou un jour de la partie (`g.date(t)`) ; k : 1 par défaut.
// game/turns.py, lignes 93 à 98
pub fn month_end(g: &Game, t: &Val, k: i64) -> f64 {
    let d = g.date(t);
    let (y, m) = (py::floordiv_i(d.month - 1 + k, 12), py::mod_i(d.month - 1 + k, 12));
    (Date::new(d.year + y, m + 1, 1).toordinal() - g.start_ord) as f64
}

/// Longueur du mois qui s'achève à l'échéance.
/// Python : `month_days(g, end)`.
// game/turns.py, lignes 101 à 104
pub fn month_days(g: &Game, end: f64) -> i64 {
    let d = g.date(&Val::from(end - 1.0));
    Date::days_in_month(d.year, d.month)
}

/// 'ordres' (carte figée, on attend « Fin du mois »), 'cours' (le mois se joue) ou 'arret' (interrompu).
/// Python : `phase(g)`.
// game/turns.py, lignes 107 à 112
pub fn phase(g: &Game) -> &'static str {
    let tr = &g.tour;
    if tr.at("end").is_none() {
        return "ordres";
    }
    if g.speed_idx != 0 { "cours" } else { "arret" }
}

// ================================================================== le temps en tours (SPEC-TOURS.md)
pub const TOUR_DAYS: f64 = 30.0;  // jours de travail d'un tour, quelle que soit la longueur du mois (règle A : capacité par tour)

/// Jours de travail du pas de dt jours qui vient de s'écouler (g.t est à sa fin) : un mois entier en fait TOUR_DAYS,
/// février comme mars. (Le dernier pas du mois franchit minuit : il compte dans le mois où il a commencé.)
/// Python : `work(g, dt)`.
// game/turns.py, lignes 119 à 123
pub fn work(g: &Game, dt: f64) -> f64 {
    let d = g.date(&Val::from(g.t - dt));
    dt * TOUR_DAYS / Date::days_in_month(d.year, d.month) as f64
}

/// Dans combien de tours est prêt ce qui demande encore work_left jours de travail, à la capacité d'un tour par
/// mois (1 : au prochain tour ; 0 : rien à faire). Le tour en cours n'a plus que ce qui reste du mois.
/// Python : `ready_in(g, work_left)`.
// game/turns.py, lignes 126 à 133
pub fn ready_in(g: &Game, work_left: f64) -> i64 {
    if work_left <= 1e-6 {
        return 0;
    }
    let d = g.date(&Val::None);
    let cap = (month_end(g, &Val::None, 1) - g.t) * TOUR_DAYS / Date::days_in_month(d.year, d.month) as f64;
    if work_left <= cap + 1e-6 { 1 } else { 1 + ((work_left - cap) / TOUR_DAYS - 1e-6).ceil() as i64 }
}

/// Échéance d'une durée de n tours (règle B) : le début d'un tour du joueur, qui garde n tours entiers. Pendant son
/// tour, ce tour compte (n = 1 : jusqu'à la fin du mois) ; ailleurs (tour des IA, temps réel), à partir du suivant.
/// who : les camps concernés ; sans le joueur, n mois à partir de maintenant (les IA gardent leur rythme d'avant).
/// Python : `deadline(g, n, *who)`.
/// who : `*who` du Python (les camps concernés ; `&[]` : aucun). `int(n)` : les appelants passent un entier.
// game/turns.py, lignes 136 à 144
pub fn deadline(g: &Game, n: i64, who: &[&str]) -> f64 {
    let n = if n > 1 { n } else { 1 };
    if !who.is_empty() && !who.contains(&g.player.as_str()) {
        return g.t + n as f64 * TOUR_DAYS;
    }
    let fresh = planning(g) || g.t <= month_end(g, &Val::None, 0) + 1e-6; // (au début d'un tour, même au dernier pas des IA)
    month_end(g, &Val::None, if fresh { n } else { n + 1 })
}

/// Le début de tour (1er du mois, 0 h) à t ou juste après : ce qu'une échéance en jours devient en tours.
/// Python : `turn_start_after(g, t)`.
// game/turns.py, lignes 147 à 150
pub fn turn_start_after(g: &Game, t: f64) -> f64 {
    let start = month_end(g, &Val::from(t), 0);
    if t <= start + 1e-6 { start } else { month_end(g, &Val::from(t), 1) }
}

/// Une durée en jours de travail, en tours, pour les messages (comme partTour dans web/js/map.js).
/// Python : `part_tour(days)`.
// game/turns.py, lignes 153 à 156
pub fn part_tour(days: f64) -> String {
    let x = days / TOUR_DAYS;
    if x < 0.9 {
        return "moins d'un tour".to_string();
    }
    let n = py::int(x + 0.5);
    R::pl(if n > 1 { n } else { 1 }, "tour", None)
}

/// Dans combien de tours ce qui finit à `until` est fait (1 : au prochain tour ; 0 : déjà fait).
/// Python : `tours_left(g, until)`.
// game/turns.py, lignes 159 à 164
pub fn tours_left(g: &Game, until: f64) -> i64 {
    if until <= g.t + 1e-6 {
        return 0;
    }
    let (a, b) = (g.date(&Val::None), g.date(&Val::from(until - 1e-6)));
    (b.year - a.year) * 12 + b.month - a.month + 1
}

// ================================================================== le tour du joueur : tout s'exécute tout de suite

/// Vrai pendant le tour du joueur (tour par tour, avant « Tour suivant ») : les ordres s'exécutent aussitôt.
/// Python : `planning(g)`.
/// `not g.over` : `!g.over.truthy()`.
// game/turns.py, lignes 168 à 170
pub fn planning(g: &Game) -> bool {
    g.tour.atb("on") && g.tour.at("end").is_none() && !g.over.truthy()
}

/// Jours de marche d'une armée par tour : le mois entier, ou ce qu'il en reste au premier tour d'une partie lancée en
/// cours de mois (le 4 mars, le 19 juillet).
/// Python : `march_days(g)`.
// game/turns.py, lignes 173 à 176
pub fn march_days(g: &Game) -> f64 {
    let me = month_end(g, &Val::None, 1);
    let (md, rest) = (month_days(g, me) as f64, me - g.t);
    py::round_n((if rest < md { rest } else { md }) * MARCH_FRAC, 2)
}

/// Jours de marche qui restent à cette armée ce tour.
/// Python : `march_left(g, a)`.
// game/turns.py, lignes 179 à 181
pub fn march_left(g: &Game, a: &Val) -> f64 {
    let mp = a.get("mp");
    if mp.is_none() {
        return march_days(g);
    }
    if mp.f() > 0.0 { mp.f() } else { 0.0 }
}

/// Dans combien de tours l'armée arrive au bout de sa route, ou de `legs` (estimation : longueur du chemin et vitesse
/// du moment ; 0 : ce tour-ci, 1 : au prochain tour), ou None sans route.
/// Python : `eta(g, a, legs=None)`.
/// legs : None (par défaut : a['path']) ou une liste d'étapes. Rend None sans route.
// game/turns.py, lignes 184 à 208
pub fn eta(g: &Game, a: &Val, legs: &Val) -> Option<i64> {
    let legs = if legs.is_none() { a.at("path") } else { legs.clone() };
    if !legs.truthy() {
        return None;
    }
    // (rail : jours de train, embarquements compris, et jours perdus à la crue)
    let (mut km, mut rail, mut x, mut y) = (0.0, 0.0, a.atf("x"), a.atf("y"));
    let mut on = a.getb("rail");
    for leg in legs.iter() {
        if leg.at_is("kind", "road") {
            let e = g.geo.edges.at(leg.at("e"));
            let k = e.atf("len") - leg.atf("pos");
            if leg.getb("rail") {
                rail += k / R::RAIL_SPEED + (if on { 0.0 } else { R::RAIL_EMBARK });
            } else {
                km += k;
                if g.cut_edges().has(leg.at("e")) {
                    rail += CR::DELAY * k / e.atf("len"); // (route coupée par la crue : un jour sur l'arête)
                }
            }
            on = leg.getb("rail");
            (x, y) = g.node_xy(leg.ati("to"));
        } else {
            for p in leg.at("pts").slice(Some(leg.ati("i")), None).iter() {
                let (px, qy) = p.xy();
                km += py::hypot(px - x, qy - y);
                (x, y) = (px, qy);
            }
        }
    }
    let sp = g.army_speed(a);
    let days = km / (if sp > 0.5 { sp } else { 0.5 }) + rail - (if planning(g) { march_left(g, a) } else { 0.0 });
    if days <= 1e-6 {
        return Some(0);
    }
    let n = (days / (month_days(g, month_end(g, &Val::None, 1)) as f64 * MARCH_FRAC) - 1e-6).ceil() as i64;
    Some(if n > 1 { n } else { 1 })
}

/// Arrivée estimée (en tours, 0 : ce tour-ci) si l'armée marchait là, sans lui donner d'ordre : même itinéraire que
/// l'ordre de marche (terres fermées contournées, sinon traversées en force). Renvoie (tours, None) ou (None, raison).
/// Python : `preview(g, code, aid, x, y, node, mode)`.
/// aid, x, y, node, mode : ce que le serveur reçoit du navigateur (x, y : nombres ou None ; node : numéro ou None).
/// Rend (tours, None) ou (None, raison). Le `try / finally` remet a['mode'] même si plan_legs échoue.
// game/turns.py, lignes 211 à 232
pub fn preview(g: &mut Game, code: &str, aid: &Val, x: &Val, y: &Val, node: &Val, mode: &Val) -> (Option<i64>, Option<String>) {
    // (aid vient du navigateur : les armées sont rangées sous des textes, rien d'autre ne les trouve)
    let a = if aid.is_str() { g.armies.get(aid) } else { Val::None };
    if !a.truthy() || a.at("owner") != code {
        return (None, Some("Armée introuvable.".to_string()));
    }
    if !(*mode == "route" || *mode == "champs") {
        return (None, Some("Itinéraire inconnu.".to_string()));
    }
    if node.is_some() && !g.valid_node(node) {
        return (None, Some("Lieu inconnu.".to_string()));
    }
    let fini = |v: &Val| v.num().is_some_and(|n| n.f().is_finite()); // (math.isfinite ; autre chose qu'un nombre : refusé)
    if node.is_none() && !(x.is_some() && y.is_some() && fini(x) && fini(y)) {
        return (None, Some("Destination invalide.".to_string()));
    }
    let old = a.at("mode");
    a.set("mode", mode);
    let essai = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let block = AA::closed_owners(g, code);
        let (mut legs, _, mut err) = g.plan_legs(&a, x, y, node, &block);
        if legs.is_none() {
            (legs, _, err) = g.plan_legs(&a, x, y, node, &pyset![]);
        }
        (legs, err)
    }));
    a.set("mode", old); // (finally)
    let (legs, err) = match essai {
        Ok(r) => r,
        Err(e) => std::panic::resume_unwind(e),
    };
    if legs.is_none() {
        (None, if err.is_none() { None } else { Some(err.string()) })
    } else {
        (eta(g, &a, &legs), None)
    }
}

/// Début du tour du joueur : les armées retrouvent tous leurs jours de marche, et celles qui avaient une longue
/// route la reprennent là où elles s'étaient arrêtées.
/// Python : `begin_turn(g)`.
// game/turns.py, lignes 235 à 242
pub fn begin_turn(g: &mut Game) {
    for a in g.armies.values() {
        a.set("trail", Val::None);
        a.set("mp", Val::None);
        a.set("rt", false);
    }
    crate::engine::marine::debut_tour(g); // les flottes (SPEC-EMPIRE, module 2)
    crate::engine::agents::debut_tour(g); // les agents (SPEC-POLITIQUE, module 4)
    settle(g);
}

/// Pourquoi le joueur ne peut pas donner d'ordre de marche maintenant, ou None.
/// Python : `lock_reason(g)`.
/// (Suppose `TB::frozen(&Game)`.)
// game/turns.py, lignes 245 à 254
pub fn lock_reason(g: &Game) -> Option<String> {
    if !g.tour.atb("on") || g.over.truthy() {
        return None;
    }
    if g.tour.at("end").is_some() {
        return Some("C'est le tour des IA : vos armées ont déjà joué ce mois-ci. Attendez le mois suivant.".to_string());
    }
    if TB::frozen(g) {
        return Some("Réglez d'abord la bataille en cours.".to_string());
    }
    None
}

/// L'armée du joueur marche tout de suite, dans la limite de ses jours de marche (ou de `days` : retraite forcée), en
/// s'arrêtant au contact de l'ennemi, devant une place à assiéger ou quand la route est finie. Le temps est virtuel : la
/// date de la campagne ne bouge pas, mais délais de grâce, saisons et rencontres s'écoulent comme pendant la marche.
/// Renvoie le nombre de jours de marche employés.
/// Python : `march_now(g, a, days=None)`.
/// days : None (par défaut : ses jours de marche) ou des jours (retraite forcée). Le `try / finally` remet l'horloge
/// (g.restore_clock) quoi qu'il arrive.
// game/turns.py, lignes 257 à 309
pub fn march_now(g: &mut Game, a: &Val, days: &Val) -> f64 {
    if a.getb("rg") {
        AA::rangs_stop(g, a, "l'armée s'est mise en marche");
    }
    let aid = a.at("id");
    let mp0 = march_left(g, a);
    let mut left = if days.is_none() { mp0 } else { days.f() };
    let mut spent = 0.0;
    let t0 = g.t;
    let hot = Val::dict_from(g.weather.items().into_iter().map(|(z, w)| (z, Val::from(w.at_is("kind", "canicule")))).collect());
    let mut trail: Vec<(Val, Val)> = vec![(a.at("x"), a.at("y"))];
    let mut fought = false;
    a.pop("took"); // (une place ralliée plus tôt ne compte que pour la marche où elle l'a été)
    let essai = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        for _ in 0..py::int(40.0 / MARCH_STEP) {
            if left <= 1e-6
                || !g.armies.has(&aid)
                || !(a.at_is("state", "move") || a.at_is("state", "retreat"))
                || !a.atb("path")
            {
                break;
            }
            let dt = if left < MARCH_STEP { left } else { MARCH_STEP };
            let (x0, y0, n0) = (a.at("x"), a.at("y"), a.at("path").len());
            let rem = g.move_army(a, dt);
            let used = if dt - rem > 0.0 { dt - rem } else { 0.0 };
            let moved = (a.at("x"), a.at("y")) != (x0.clone(), y0.clone()) || a.at("path").len() != n0;
            if !moved && used <= 1e-9 {
                break; // bloquée (rien ne se passe) : on n'insiste pas
            }
            let used = if used > 1e-9 { used } else { dt };
            left -= used;
            spent += used;
            g.t += if 1e-4 > used { 1e-4 } else { used };
            if (a.at("x"), a.at("y")) != (x0, y0) {
                trail.push((a.at("x"), a.at("y")));
            }
            TB::army_tick(g, a, used, &hot); // la marche fatigue les hommes comme pendant le tour des IA
            g.update_hidden();
            g.detect_contacts(&aid);
            if g.armies.has(&aid) && (a.at_is("state", "battle") || a.pop("took").truthy()) {
                fought = true; // attaquer, être arrêté au contact ou rallier une place termine la marche du tour
                break;
            }
        }
    }));
    // (finally)
    g.restore_clock(t0);
    if g.armies.has(&aid) && days.is_none() {
        // (même si la marche a échoué en chemin)
        let r = mp0 - spent;
        a.set("mp", if fought { 0.0 } else { py::round_n(if r > 0.0 { r } else { 0.0 }, 3) });
    }
    if let Err(e) = essai {
        std::panic::resume_unwind(e);
    }
    if g.armies.has(&aid) {
        if trail.len() as i64 > TRAIL_PTS {
            let k = (trail.len() - 1) as f64 / (TRAIL_PTS - 1) as f64;
            trail = (0..TRAIL_PTS).map(|i| trail[py::round(i as f64 * k) as usize].clone()).collect();
        }
        if trail.len() > 1 {
            a.set("trail", trail.iter().map(|(x, y)| list![_round_v(x, 1), _round_v(y, 1)]).collect::<Val>());
            a.set("tn", &a.get_or("tn", 0) + &Val::from(1));
        }
    }
    spent
}

/// Après un ordre du joueur : ses armées en marche partent (ou continuent) tout de suite, celles qui battent en
/// retraite se replient, puis les batailles que cela a déclenchées et que le général règle seul sont réglées.
/// Renvoie les jours de marche employés par armée.
/// Python : `settle(g)`.
/// Rend {aid: jours de marche employés} (le serveur teste `aid in used`).
// game/turns.py, lignes 312 à 335
pub fn settle(g: &mut Game) -> Val {
    let out = dict! {};
    if !planning(g) {
        return out;
    }
    AA::asking(g); // (choix devant une place devenus caducs : levés ; la place prise, l'armée reprend sa route)
    for a in g.armies.values() {
        if a.at("owner") == g.player.as_str() && a.at_is("state", "move") && a.atb("path") && march_left(g, &a) > 1e-6 {
            if TB::frozen(g) {
                break; // une bataille attend le joueur : les autres armées ne bougent pas avant qu'elle soit réglée
            }
            let used = march_now(g, &a, &Val::None);
            out.set(a.at("id"), used);
        }
    }
    resolve_autos(g);
    for a in g.armies.values() {
        if a.at("owner") == g.player.as_str()
            && a.at_is("state", "retreat")
            && a.atb("path")
            && !a.getb("rt")
            && !TB::frozen(g)
        {
            march_now(g, &a, &Val::from(RETREAT_DAYS)); // une armée en retraite se replie tout de suite, une fois par tour…
            if g.armies.has(a.at("id")) {
                a.set("rt", true);
                a.set("mp", 0.0); // … et n'a plus de marche ce tour
            }
        }
    }
    resolve_autos(g);
    out
}

/// Batailles automatiques (réglage « toujours automatique », ou choix du joueur) : réglées sur-le-champ.
/// Python : `resolve_autos(g)`.
// game/turns.py, lignes 338 à 345
pub fn resolve_autos(g: &mut Game) {
    if !planning(g) {
        return;
    }
    for bt in g.battles.values() {
        if TB::is_auto(&bt) && g.battles.has(bt.at("id")) {
            g.resolve_battle_now(&bt);
        }
    }
}

// ================================================================== commandes

/// Python : `command(g, action, value=None)`.
/// action : `str(body.get('action'))` ; value : ce qu'envoie le navigateur (None par défaut). Le message peut être None.
// game/turns.py, lignes 349 à 369
pub fn command(g: &mut Game, action: &str, value: &Val) -> (bool, Option<String>) {
    let tr = g.tour.clone();
    if action == "mode" {
        let on = value.truthy();
        if Val::from(on) == tr.at("on") {
            return (true, None);
        }
        g.speed_idx = 0;
        tr.update(&dict! {"on" => on, "end" => Val::None, "stop" => Val::None, "acc" => Val::None});
        for a in g.armies.values() {
            a.set("mp", Val::None);
            a.set("trail", Val::None);
            a.set("rt", false);
        }
        let m = if on {
            "Tour par tour : donnez vos ordres (ils s’exécutent tout de suite), puis « Tour suivant »."
        } else {
            "Temps réel : choisissez une vitesse en haut. Le jeu est en pause."
        };
        return (true, Some(m.to_string()));
    }
    if !tr.atb("on") {
        return (false, Some("La partie se joue en temps réel (menu ☰, réglages avancés).".to_string()));
    }
    if g.over.truthy() {
        return (false, Some("La partie est terminée.".to_string()));
    }
    if action == "go" {
        return go(g);
    }
    (false, Some("Commande inconnue.".to_string()))
}

/// « Fin du mois » (début du déroulement) ou « Continuer le mois » (après une interruption ou un arrêt).
/// Python : `go(g)`.
// game/turns.py, lignes 372 à 385
pub fn go(g: &mut Game) -> (bool, Option<String>) {
    let tr = g.tour.clone();
    if g.over.truthy() || !tr.atb("on") {
        let m = if g.over.truthy() { "La partie est terminée." } else { "La partie se joue en temps réel." };
        return (false, Some(m.to_string()));
    }
    if tr.at("end").is_none() {
        tr.set("end", month_end(g, &Val::None, 1));
        tr.set("recap", Val::None);
        tr.set("acc", _new_acc(g));
    }
    tr.set("stop", Val::None);
    // tout ce qui existe déjà (ordres donnés pendant la pause, alertes vues) n'interrompt pas le tour
    tr.set("seen", _scan(g));
    g.speed_idx = 1;
    (true, None)
}

// ================================================================== déroulement

/// Remplace Game.advance en mode tour : joue le mois aussi vite que possible, BUDGET secondes de calcul par appel
/// (real_dt ne sert plus), et s'arrête pile à l'échéance ou sur une alerte.
/// Python : `advance(g, real_dt)`.
/// `time.monotonic()` : `std::time::Instant`.
// game/turns.py, lignes 389 à 415
pub fn advance(g: &mut Game, real_dt: f64) {
    let _ = real_dt; // (ne sert plus)
    let tr = g.tour.clone();
    if g.over.truthy() {
        return;
    }
    if g.speed_idx == 0 {
        if tr.at("end").is_none() || !_settled(g) {
            return;
        }
        go(g); // le choix est fait : le tour des IA reprend tout seul
    }
    if tr.at("end").is_none() {
        go(g); // le temps lancé autrement que par « Fin du mois » (script, ancienne commande) : le mois se joue
    }
    let until = std::time::Instant::now() + std::time::Duration::from_secs_f64(BUDGET);
    while !g.over.truthy() && g.speed_idx != 0 && std::time::Instant::now() < until {
        let sub = if g.battles.truthy() { SUBSTEP } else { SUBSTEP * 2.0 };
        let rem = tr.atf("end") - g.t;
        let seq0 = g.seq;
        if rem <= sub + 1e-6 {
            // dernier pas : on franchit minuit pour que le 1er du mois se joue (revenus, bilan, sauvegarde)…
            g.step((if 0.0 > rem { 0.0 } else { rem }) + 1e-9);
            g.t = tr.atf("end"); // … et l'on s'arrête pile au 1er, à 0 h
            watch(g, rem, seq0);
            finish(g);
            return;
        }
        g.step(sub);
        watch(g, sub, seq0);
    }
}

/// Python : `finish(g)`.
// game/turns.py, lignes 418 à 430
pub fn finish(g: &mut Game) {
    let tr = g.tour.clone();
    AA::tick(g, 0.0, true);
    g.speed_idx = 0;
    let recap = _recap(g);
    tr.set("recap", recap);
    tr.update(&dict! {"end" => Val::None, "stop" => Val::None, "acc" => Val::None});
    for bt in g.battles.values() {
        // (batailles automatiques qui duraient encore au 1er du mois : réglées, pour que le tour du joueur parte net)
        if TB::is_auto(&bt) && g.battles.has(bt.at("id")) {
            g.resolve_battle_now(&bt);
        }
    }
    begin_turn(g);
}

/// Après chaque pas : relit le journal pour le récapitulatif, et arrête le tour des IA seulement si le joueur doit
/// choisir (bataille, décision) ou si la partie est finie.
/// Python : `watch(g, dt, seq0)`.
// game/turns.py, lignes 433 à 457
pub fn watch(g: &mut Game, dt: f64, seq0: i64) {
    let _ = seq0; // (inutilisé, comme en Python)
    let tr = g.tour.clone();
    if tr.getb("acc") {
        _accumulate(g, dt);
    }
    let old = tr.at("seen").or_else(|| _scan(g));
    let cur = _scan(g);
    tr.set("seen", &cur);
    let cands = _candidates(g, &old, &cur);
    if g.over.truthy() {
        let text = if g.over.is_dict() { g.over.get_or("text", "La partie est terminée.") } else { Val::from("La partie est terminée.") };
        cands.insert(0, dict! {"kind" => "fin", "text" => text});
    }
    if !cands.truthy() {
        if g.speed_idx == 0 {
            g.speed_idx = 1; // un grand moment (époque, traité…) arrête le temps réel, pas le tour des IA : il va au récap
        }
        return;
    }
    cands.sort_by_key(|c| PRIORITY().index_of(&c.at("kind")).expect("ValueError: is not in list"));
    let best = cands.at(0);
    g.speed_idx = 0;
    let rest = cands.slice(Some(1), None);
    let next: Val = rest.iter().filter(|c| c.at_is("kind", "decision")).map(|c| c.at("ev")).collect();
    tr.set(
        "stop",
        dict! {"kind" => best.at("kind"), "text" => best.at("text"), "x" => best.get("x"), "y" => best.get("y"),
               "sel" => best.get("sel"), "ev" => best.get("ev"), "next" => next, "more" => cands.len() - 1,
               "date" => g.date_str(&Val::None)},
    );
    if tr.getb("acc") {
        tr.at("acc").inc("stops", 1);
    }
}

/// La raison de l'arrêt a disparu (bataille réglée ou jouée, décision prise) : le tour des IA peut reprendre seul.
/// (Game.advance ne vient pas jusqu'ici tant qu'une bataille attend le joueur.)
/// Python : `_settled(g)`.
// game/turns.py, lignes 460 à 475
pub fn _settled(g: &Game) -> bool {
    let st = g.tour.at("stop");
    if !st.truthy() || st.at_is("kind", "fin") || (st.at_is("kind", "decision") && !st.getb("ev")) {
        return false; // (partie chargée en plein tour des IA : on attend « Continuer »)
    }
    if st.at_is("kind", "decision") {
        if g.pending_ev.iter().any(|x| x.at("id") == st.at("ev")) {
            return false;
        }
        let next = st.get_or("next", tup![]);
        let nxt: Vec<Val> = g.pending_ev.iter().filter(|x| next.has(x.at("id"))).collect();
        if !nxt.is_empty() {
            // d'autres décisions arrivées au même moment : le tour s'arrête aussi sur chacune
            let x = &nxt[0];
            st.update(&dict! {"ev" => x.at("id"), "text" => format!("Une décision vous attend : {}.", x.at("title")),
                              "next" => nxt[1..].iter().map(|y| y.at("id")).collect::<Val>(), "more" => nxt.len() - 1});
            return false;
        }
    }
    true
}

/// Ce qui peut interrompre le tour, à cet instant (comparé d'un pas à l'autre) : les batailles qui attendent le
/// choix du joueur, les décisions qui l'attendent.
/// Python : `_scan(g)`.
/// Rend dict(bt, ev) : deux listes d'identifiants.
// game/turns.py, lignes 478 à 482
pub fn _scan(g: &Game) -> Val {
    let bt: Val = g.battles.values().into_iter().filter(TB::en_attente).map(|b| b.at("id")).collect();
    bt.extend(&crate::engine::navale::en_attente_ids(g)); // batailles navales (SPEC-EMPIRE, module 2)
    bt.sort();
    dict! {"bt" => bt, "ev" => g.pending_ev.iter().map(|x| x.at("id")).collect::<Val>()}
}

/// Python : `_candidates(g, old, cur)`.
/// old, cur : des _scan. Rend une liste de dict.
// game/turns.py, lignes 485 à 501
pub fn _candidates(g: &mut Game, old: &Val, cur: &Val) -> Val {
    let out = list![];
    for pid in cur.at("ev").iter() {
        let x = g.pending_ev.iter().find(|e| e.at("id") == pid).unwrap_or(Val::None);
        if x.truthy() && !old.at("ev").has(&pid) {
            let (xx, xy) = if x.get("town").is_some() {
                let (a, b) = g.node_xy(x.ati("town"));
                (Val::from(a), Val::from(b))
            } else {
                (Val::None, Val::None)
            };
            out.push(dict! {"kind" => "decision", "text" => format!("Une décision vous attend : {}.", x.at("title")),
                            "x" => xx, "y" => xy, "sel" => "event", "ev" => &pid});
        }
    }
    for bid in cur.at("bt").iter() {
        let bt = g.battles.get(&bid).or_else(|| g.navales.get(&bid)); // (SPEC-EMPIRE, module 2 : une bataille navale)
        if !bt.truthy() || old.at("bt").has(&bid) {
            continue;
        }
        let owners: Vec<Val> = bt.at("sides").iter().map(|s| s.at("owner")).collect();
        let kind = if bt.getb("ambush") { "Embuscade" } else if bt.at("node").is_some() { "Assaut" } else { "Bataille" };
        let lieu = g.place_name(bt.atf("x"), bt.atf("y"));
        let txt = if bt.get("mode") == "poursuite" {
            format!("Victoire {lieu} : poursuivre l'ennemi, ou tenir le terrain ?")
        } else {
            format!("{kind} {lieu} : {} attaque {}.", g.fname(owners[0].s()), g.fname(owners[1].s()))
        };
        out.push(dict! {"kind" => "bataille", "text" => txt, "x" => bt.at("x"), "y" => bt.at("y"), "sel" => list!["battle", &bid]});
    }
    out
}

/// « près de Bazas », ou « à Bazas » quand on y est (place_name dit alors « de Bazas »).
/// Python : `_where(g, x, y)`.
// game/turns.py, lignes 504 à 507
pub fn _where(g: &mut Game, x: f64, y: f64) -> String {
    let w = g.place_name(x, y);
    if w.starts_with("près") {
        return w;
    }
    let n = g.nearest_node(x, y, None, 1000000000.0);
    format!("à {}", g.geo.nodes.at(&n).at("name"))
}

// ================================================================== récapitulatif du mois

/// Python : `_new_acc(g)`.
// game/turns.py, lignes 512 à 516
pub fn _new_acc(g: &Game) -> Val {
    let f = g.factions.at(&g.player);
    dict! {
        "t0" => py::round_n(g.t, 3), "date0" => g.date_str(&Val::None), "seq" => g.seq,
        "own" => g.owned_nodes(&g.player).iter().map(|n| n.at("id")).collect::<Val>(),
        "inc" => Val::dict_from(R::RESOURCES().iter().map(|r| (r, Val::from(0.0))).collect()),
        "res0" => Val::dict_from(f.at("res").items().into_iter().map(|(r, v)| (r, _round_v(&v, 1))).collect()),
        "battles" => list![], "built" => list![], "techs" => list![], "facts" => list![], "levied" => 0, "stops" => 0
    }
}

/// Python : `_item(e)`.
/// e : une ligne du journal.
// game/turns.py, lignes 519 à 520
pub fn _item(e: &Val) -> Val {
    dict! {"text" => e.at("text"), "x" => e.get("x"), "y" => e.get("y")}
}

/// Python : `_accumulate(g, dt)`.
// game/turns.py, lignes 523 à 556
pub fn _accumulate(g: &mut Game, dt: f64) {
    let acc = g.tour.at("acc");
    let f = g.factions.at(&g.player);
    let inc = acc.at("inc");
    for r in inc.keys() {
        inc.inc(&r, &f.at("income").get_or(&r, 0.0) * dt);
    }
    if g.seq <= acc.ati("seq") {
        return;
    }
    // seules les dernières lignes sont nouvelles (le journal est dans l'ordre) : on ne relit pas tout
    let evs = g.events.vec();
    let s0 = acc.ati("seq");
    let mut i = evs.len();
    while i > 0 && evs[i - 1].ati("seq") > s0 {
        i -= 1;
    }
    for e in &evs[i..] {
        if e.ati("seq") <= s0 {
            continue;
        }
        let (k, txt) = (e.ats("kind"), e.ats("text"));
        let (lst, it) = if k == "battle_end" {
            let it = _item(e);
            it.set("win", e.get("win"));
            (acc.at("battles"), it)
        } else if k == "eco" && _BUILT(&txt) {
            (acc.at("built"), _item(e))
        } else if k == "armee" && txt.starts_with("Régiment levé") {
            acc.inc("levied", 1);
            continue;
        } else if k == "tech" && txt.starts_with("Découverte") {
            (acc.at("techs"), _item(e))
        } else if e.getb("important")
            && (["capitulation", "epoque", "revolte", "fin", "siege", "rail"].contains(&k.as_str())
                || (k == "diplo" && _DIPLO(&txt))
                || (k == "evenement" && !txt.contains("Une décision vous attend")))
        {
            (acc.at("facts"), _item(e))
        } else {
            continue;
        };
        if (lst.len() as i64) < MAX_ITEMS {
            lst.push(it);
        }
    }
    acc.set("seq", g.seq);
}

/// Téléphone : armées ennemies vues, pas encore chez vous, dont la route entre sur vos terres d'ici au prochain tour.
/// Python : `incoming(g, p)`.
/// Rend une liste d'armées.
// game/turns.py, lignes 559 à 578
pub fn incoming(g: &Game, p: &str) -> Val {
    if g.mod_(p, "alert", 0.0) == 0.0 {
        return list![];
    }
    let seen = g.visible_armies(p).0;
    let out = list![];
    for a in g.armies.values() {
        let o = a.ats("owner");
        if o == p || !g.factions.has(&o) || !seen.has(a.at("id")) || !g.at_war(&o, p) || g.army_men(&a) < FOE_MIN_MEN as f64 {
            continue;
        }
        if let Some(here) = g.geo.node_of_cell(a.atf("x"), a.atf("y")) {
            if g.nodes.at(here).at_is("owner", &p) {
                continue; // (déjà sur vos terres : le bilan le dit autrement)
            }
        }
        let path = a.at("path");
        for (k, leg) in path.iter().enumerate() {
            let nd = if leg.at_is("kind", "road") {
                Some(leg.ati("to"))
            } else {
                let (x, y) = leg.at("pts").at(-1).xy();
                g.geo.node_of_cell(x, y)
            };
            if let Some(nd) = nd {
                if g.nodes.at(nd).at_is("owner", &p) {
                    if eta(g, &a, &path.slice(None, Some(k as i64 + 1))).unwrap_or(0) <= 1 {
                        out.push(&a);
                    }
                    break;
                }
            }
        }
    }
    out
}

/// Python : `_recap(g)`.
/// Rend le dict du bilan, ou None.
/// Piège : `now - before` sont des sets d'entiers, mais triés par nom aussitôt (places).
// game/turns.py, lignes 581 à 610
pub fn _recap(g: &mut Game) -> Val {
    let acc = g.tour.get("acc");
    if !acc.truthy() {
        return Val::None;
    }
    let p = g.player.clone();
    let f = g.factions.at(&p);
    let before = acc.at("own").to_set();
    let now: Val = Val::set_from(g.owned_nodes(&p).iter().map(|n| n.at("id")).collect());
    let places = |g: &Game, ids: Vec<Val>| -> Val {
        let ids = py::sorted_by_key(ids, |i| g.geo.nodes.at(i).at("name"));
        ids.into_iter()
            .take(MAX_ITEMS as usize)
            .map(|i| {
                let n = g.geo.nodes.at(&i);
                dict! {"id" => &i, "name" => n.at("name"), "x" => n.at("x"), "y" => n.at("y")}
            })
            .collect()
    };
    let seen = g.visible_armies(&p).0;
    let foes = list![]; // armées ennemies (visibles) sur vos terres au début de votre tour
    for a in g.armies.values() {
        let o = a.ats("owner");
        if o == p || !g.factions.has(&o) || !seen.has(a.at("id")) || !g.at_war(&o, &p) || g.army_men(&a) < FOE_MIN_MEN as f64 {
            continue;
        }
        let nd = g.geo.node_of_cell(a.atf("x"), a.atf("y"));
        if nd.is_some_and(|nd| g.nodes.at(nd).at_is("owner", &p)) && (foes.len() as i64) < MAX_ITEMS {
            let w = _where(g, a.atf("x"), a.atf("y"));
            let text = format!("Armée ennemie sur vos terres ({}, {} hommes), {}.", g.fname(&o), py::int(g.army_men(&a)), w);
            foes.push(dict! {"id" => a.at("id"), "x" => a.at("x"), "y" => a.at("y"), "text" => text});
        }
    }
    let room = MAX_ITEMS - foes.len() as i64;
    for a in incoming(g, &p).iter().take(if room > 0 { room as usize } else { 0 }) {
        let text = format!(
            "Le téléphone annonce une armée ennemie en route vers vos terres ({}, {} hommes) : elle arrivera au prochain tour.",
            g.fname(a.at("owner").s()),
            py::int(g.army_men(&a))
        );
        foes.push(dict! {"id" => a.at("id"), "x" => a.at("x"), "y" => a.at("y"), "text" => text});
    }
    let d = g.date(&Val::from(g.t - 1.0)); // le mois qui s'achève
    // (now - before, before - now : des sets d'entiers, aussitôt triés par nom)
    let gained = places(g, now.iter().filter(|i| !before.has(i)).collect());
    let lost = places(g, before.iter().filter(|i| !now.has(i)).collect());
    let res0 = acc.at("res0");
    dict! {
        "id" => format!("{}-{}-{}", g.seed, acc.at("t0"), py::repr_f(py::round_n(g.t, 3))),
        "title" => format!("Bilan {} {}", R::de(R::MONTHS().at(d.month - 1).s()), d.year),
        "period" => format!("du {} au {}", acc.at("date0"), g.date_str(&Val::None)),
        "battles" => acc.at("battles"), "built" => acc.at("built"), "techs" => acc.at("techs"), "facts" => acc.at("facts"),
        "foes" => foes, "levied" => acc.at("levied"), "gained" => gained, "lost" => lost,
        "inc" => Val::dict_from(acc.at("inc").items().into_iter().map(|(r, v)| (r, _round_v(&v, 1))).collect()),
        "res" => Val::dict_from(R::RESOURCES().iter().map(|r| {
            let v = &f.at("res").at(&r) - &res0.get_or(&r, 0);
            (r, _round_v(&v, 1))
        }).collect()),
        "stops" => acc.at("stops")
    }
}

// ================================================================== vue

/// Python : `view(g)`.
// game/turns.py, lignes 614 à 624
pub fn view(g: &Game) -> Val {
    let tr = &g.tour;
    let ph = phase(g);
    let on = tr.atb("on");
    let out = dict! {"on" => tr.at("on"), "phase" => ph, "recap" => tr.at("recap"),
                     "march" => if on { Some(march_days(g)) } else { None }};
    if !on {
        return out;
    }
    let end = if tr.at("end").is_some() { tr.atf("end") } else { month_end(g, &Val::None, 1) };
    let n = month_days(g, end) as f64;
    let v = (g.t - (end - n)) / n;
    let v = if v < 1.0 { v } else { 1.0 };
    out.update(&dict! {"end" => g.date_str(&Val::from(end)), "prog" => py::round_n(if v > 0.0 { v } else { 0.0 }, 4),
                       "stop" => if ph == "arret" { tr.at("stop") } else { Val::None }});
    out
}
