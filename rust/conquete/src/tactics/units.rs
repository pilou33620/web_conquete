//! Porte game/tactics/units.py.
//!
//! Unités tactiques : une par régiment de campagne (et par compagnie de milice d'une place), plus l'état-major.
//!
//! Chiffres de référence (contrat, § 2 et § 4) :
//! - dotation d'un plein de munitions : infanterie 60 cartouches par homme, artillerie 120 coups par pièce
//!   (8 pièces par batterie), cavalerie 20 (pistolets, carabines) ;
//! - portées (efficace / maximale / mitraille), dérivées du type et de la génération d'armes `arm` : ranges(reg) ;
//! - justesse du feu : precision(u, d), moitié à D50 ; bout portant (precision ≥ BOUT_K) : bout_portant(u) ;
//! - profils d'arrêt de l'ordre « attaquer » du joueur (u.stop) : stop_dist(u, stop) ;
//! - vitesses au pas sur prairie (m/s de bataille) : infanterie 1,2, légère 1,4, cavalerie 2,5 (galop 7),
//!   artillerie attelée 1,5 ;
//! - cadence d'un feu soutenu : une salve par minute environ pour le fusil à silex, une volée toutes les 80 à 100 s pour
//!   les canons lisses (la dotation dure une heure de feu pour l'infanterie, deux heures et demie pour les canons) ;
//! - emprises au sol : ligne de 300 hommes ≈ 120 × 12 m, colonne ≈ 40 × 50, carré ≈ 45 × 45, tirailleurs ≈ 220 × 30,
//!   cavalerie en ligne ≈ 100 × 15, batterie en batterie ≈ 80 × 30 ; elles rétrécissent avec les pertes.
//!
//! En Rust, une unité (`Unit`, classe à `__slots__` en Python) est un dict `Val` dont les clés sont ses attributs
//! (SLOTS) : `u.x` → `u.atf("x")`, `u.state == 'deroute'` → `u.at("state") == "deroute"`, `u.men -= p` →
//! `u.dec("men", p)`. Un attribut jamais posé (`id`, `side`, `men`… d'une `Unit()` nue) est une clé absente.
//! Ses méthodes et propriétés sont les fonctions `alive`, `valid`, `size`, `to_dict`, `from_dict`, `view` de ce
//! module ; `Unit(&kw)` la construit. Types des attributs : voir le commentaire de `Unit`.

use crate::engine::Game;
use crate::py::{self, Val};
use crate::rules as R;
use crate::{dict, list, py_const, tup};

py_const!(AMMO0, dict!{"inf" => 60, "artillerie" => 120, "cavalerie" => 20});
pub const PIECES: i64 = 8; // pièces d'une batterie complète
pub const ART_MEN: i64 = 120; // servants d'une batterie complète

// portées (m) par génération d'armes (rules.ARMS)
pub const INF_RANGE: [(i64, i64); 8] = [(80, 150), (100, 200), (120, 230), (130, 250), (300, 600), (500, 1200), (550, 1300), (600, 1500)];
// justesse du feu en bataille (pas au tir à la cible) : elle baisse dès les premiers mètres, de moitié à D50 mètres
// (fumée, peur, hausse mal réglée, balle lente qui passe au-dessus des têtes), puis comme 1/d² : precision()
pub const INF_D50: [i64; 8] = [55, 70, 80, 85, 180, 360, 400, 450]; // par génération d'armes (rules.ARMS), comme INF_RANGE
pub const MIT_D50: i64 = 1000; // mitrailleuse : gerbe étroite, tout se perd si la hausse est fausse
pub const CAV_D50: i64 = 45; // mousquetons et pistolets des cavaliers
pub const ART_RANGE: [(i64, i64, i64); 7] =
    [(500, 900, 250), (600, 1000, 260), (700, 1100, 280), (800, 1200, 300), (1400, 2500, 330), (1800, 3000, 360), (2200, 3500, 400)];
pub const CAV_RANGE: (i64, i64) = (30, 60);
// batterie de mitrailleuses (Reffye, 1866 ; SPEC-TECH.md) : six pièces (les servants d'une batterie de huit, pièce pour
// pièce : pieces() vaut aussi pour elle), un feu roulant de 25 canons ; ni boulet, ni mitraille
pub const MIT_RANGE: (i64, i64) = (1200, 2000);
pub const MIT_RELOAD: i64 = 12; // une gerbe de 25 balles toutes les 12 s de bataille (les munitions fondent)
// rechargement entre deux salves (s de bataille) : cadence d'un feu soutenu en bataille (une salve par minute environ
// pour le fusil à silex, une volée par minute pour les canons lisses), pas celle de l'exercice ; le chargement par la
// culasse change tout
pub const INF_RELOAD: [i64; 8] = [70, 62, 60, 55, 55, 25, 22, 18];
pub const ART_RELOAD: [i64; 7] = [100, 95, 85, 80, 80, 65, 30];
pub const CAV_RELOAD: i64 = 30;

// caractère de chaque type de troupe
py_const!(TYPE, dict!{
    "ligne" => dict!{"melee" => 1.0, "fire" => 1.0, "speed" => 1.2, "steady" => 1.0},
    "legere" => dict!{"melee" => 0.85, "fire" => 1.05, "speed" => 1.4, "steady" => 0.95},
    "grenadiers" => dict!{"melee" => 1.5, "fire" => 1.05, "speed" => 1.2, "steady" => 1.3},
    "chasseurs" => dict!{"melee" => 0.95, "fire" => 1.1, "speed" => 1.45, "steady" => 1.05},
    "sapeurs" => dict!{"melee" => 0.6, "fire" => 0.6, "speed" => 1.15, "steady" => 0.9},
    "garde" => dict!{"melee" => 0.7, "fire" => 0.7, "speed" => 1.1, "steady" => 0.85},
    "milice" => dict!{"melee" => 0.6, "fire" => 0.6, "speed" => 1.1, "steady" => 0.8},
    "cavalerie" => dict!{"melee" => 1.6, "fire" => 0.4, "speed" => 2.5, "steady" => 1.1},
    "artillerie" => dict!{"melee" => 0.35, "fire" => 1.0, "speed" => 1.5, "steady" => 1.0},
    "mitrailleuses" => dict!{"melee" => 0.3, "fire" => 1.0, "speed" => 1.5, "steady" => 1.0},
    "general" => dict!{"melee" => 0.8, "fire" => 0.2, "speed" => 3.0, "steady" => 1.5},
    "chariot" => dict!{"melee" => 0.2, "fire" => 0.0, "speed" => 1.3, "steady" => 0.7},
});
pub const WAGON_RANGE: f64 = 150.0; // le chariot de munitions recomplète les régiments à moins de 150 m…
pub const WAGON_RATE: f64 = 0.04; // … de 4 % de leur dotation par minute…
pub const WAGON_LOAD: f64 = 50.0; // … et se vide de 50 % quand il recomplète toute l'armée (deux pleins par chariot)
py_const!(FORMS, dict!{"inf" => tup!["ligne", "colonne", "carre", "tirailleurs"], "cavalerie" => tup!["ligne", "colonne"],
    "artillerie" => tup!["attelee", "batterie"], "general" => tup!["colonne"], "chariot" => tup!["colonne"]});
// part des hommes qui tirent (maisons : par les fenêtres, ordre « Occuper les maisons » de battle.py, pas une formation)
py_const!(FRONT, dict!{"ligne" => 1.0, "tirailleurs" => 0.6, "colonne" => 0.25, "carre" => 0.25, "maisons" => 0.6});
py_const!(FORM_SPEED, dict!{"ligne" => 0.8, "colonne" => 1.1, "carre" => 0.4, "tirailleurs" => 1.0, "attelee" => 1.0, "batterie" => 0.0});
py_const!(FORM_LABEL, dict!{"ligne" => "Ligne", "colonne" => "Colonne", "carre" => "Carré", "tirailleurs" => "Tirailleurs",
    "attelee" => "Attelée", "batterie" => "En batterie", "maisons" => "Dans les maisons"});
py_const!(STATE_LABEL, dict!{"repos" => "Au repos", "marche" => "En marche", "feu" => "Feu", "recharge" => "Recharge",
    "charge" => "Charge", "melee" => "Mêlée", "deroute" => "Déroute", "ralliement" => "Ralliement", "hors" => "Hors de combat"});

/// Python (units.py, l. 74-79) : `def cls_of(typ)`
/// Rend 'inf', 'cavalerie', 'artillerie', 'general' ou 'chariot'.
pub fn cls_of(typ: &str) -> String {
    if typ == "general" || typ == "chariot" {
        return typ.to_string();
    }
    if typ == "milice" {
        return "inf".to_string();
    }
    let units = R::UNITS();
    if units.has(typ) { units.at(typ).ats("cls") } else { "inf".to_string() }
}

/// Portées d'un régiment (dict de campagne ou unité tactique) : (efficace, maximale, mitraille ou None), en mètres.
/// Dérivées du type et de la génération d'armes `arm` ; rien n'est stocké.
///
/// Python (units.py, l. 82-96) : `def ranges(reg)`
/// reg : régiment de campagne ou unité tactique, tous deux des dict en Rust : `reg.at("type")`,
/// `reg.get("arm").or(0)` suffisent aux deux. Rend (efficace, maximale, mitraille) : des entiers comme en Python
/// (ils partent tels quels au client : `range` de la vue, `por` de la fiche) ; le troisième est un `Val::Int`
/// ou `Val::None`.
pub fn ranges(reg: &Val) -> (i64, i64, Val) {
    let typ = reg.ats("type");
    let arm = reg.get("arm").or(0).i();
    let cls = cls_of(&typ);
    if typ == "mitrailleuses" {
        return (MIT_RANGE.0, MIT_RANGE.1, Val::None);
    }
    if cls == "artillerie" {
        let (e, m, g) = ART_RANGE[0.max(arm.min(ART_RANGE.len() as i64 - 1)) as usize];
        return (e, m, Val::from(g));
    }
    if cls == "cavalerie" || cls == "general" || cls == "chariot" {
        return (CAV_RANGE.0, CAV_RANGE.1, Val::None);
    }
    let (e, m) = INF_RANGE[0.max(arm.min(INF_RANGE.len() as i64 - 1)) as usize];
    (e, m, Val::None)
}

/// Distance où la justesse du feu tombe de moitié (m).
///
/// Python (units.py, l. 99-105) : `def d50(u)`
/// u : unité (lit type, cls, arm).
pub fn d50(u: &Val) -> i64 {
    if u.at("type") == "mitrailleuses" {
        return MIT_D50;
    }
    if u.at("cls") == "inf" {
        return INF_D50[0.max(u.ati("arm").min(INF_D50.len() as i64 - 1)) as usize];
    }
    CAV_D50
}

/// Part des coups qui portent à d mètres, rapportée au bout portant (1 à 0 m, moitié à D50).
///
/// Python (units.py, l. 108-110) : `def precision(u, d)`
/// u : unité ; d : distance (m). `(d / d50) ** 2` → `py::pow(…, 2.0)`.
pub fn precision(u: &Val, d: f64) -> f64 {
    1.0 / (1.0 + py::pow(d / d50(u) as f64, 2.0))
}

pub const BOUT_K: f64 = 0.6; // « bout portant » : là où precision() vaut encore 0,6 (65 m au fusil 1777) ; canons : la mitraille
// profils d'arrêt de l'ordre « attaquer » donné par le joueur (u.stop) : portée max, bonne portée, bout portant
py_const!(STOPS, tup!["max", "bonne", "bout"]);

/// Bout portant (m) : precision ≥ BOUT_K, jamais au-delà de la portée efficace ; la mitraille des canons.
///
/// Python (units.py, l. 118-123) : `def bout_portant(u)`
/// u : unité. Le Python rend un int (`g or 0`, ou `e`) ou un float ; ici toujours un f64 (il ne sert qu'à des
/// calculs et à des arrondis : fire_zones, stop_dist).
pub fn bout_portant(u: &Val) -> f64 {
    let (e, _mx, g) = ranges(u);
    if u.at("cls") == "artillerie" && u.at("type") != "mitrailleuses" {
        return g.or(0).f();
    }
    let b = d50(u) as f64 * (1.0 / BOUT_K - 1.0).sqrt();
    if b < e as f64 { b } else { e as f64 }
}

/// Où s'arrête une troupe qui attaque selon son profil : 'max' (95 % de la portée maximale : harcèlement de loin),
/// 'bonne' (90 % de la portée efficace : l'ouverture du feu des règlements), 'bout' (90 % du bout portant).
///
/// Python (units.py, l. 126-133) : `def stop_dist(u, stop)`
/// u : unité (`getattr(u, 'fire_mode', None)` → `u.get("fire_mode")`) ; stop : 'max', 'bonne' ou 'bout' (STOPS ;
/// toute autre valeur vaut 'bonne').
pub fn stop_dist(u: &Val, stop: &str) -> f64 {
    let (e, mx, _g) = ranges(u);
    let mut want = if stop == "max" {
        mx as f64 * 0.95
    } else if stop == "bout" {
        bout_portant(u) * 0.9
    } else {
        e as f64 * 0.9
    };
    if u.get("fire_mode") == "volley" {
        // (la salve ne part qu'à 85 % de la portée efficace : battle.VOLLEY_RANGE)
        let v = e as f64 * 0.8;
        if v < want {
            want = v;
        }
    }
    want
}

/// Python (units.py, l. 136-145) : `def reload_time(u)`
/// u : unité (lit type, cls, arm, xp, fat ; stats.rs l'appelle sur une `Unit` presque nue). Secondes de bataille.
pub fn reload_time(u: &Val) -> f64 {
    let arm = || u.ati("arm");
    let base = if u.at("type") == "mitrailleuses" {
        MIT_RELOAD
    } else if u.at("cls") == "artillerie" {
        ART_RELOAD[0.max(arm().min(ART_RELOAD.len() as i64 - 1)) as usize]
    } else if u.at("cls") == "inf" {
        INF_RELOAD[0.max(arm().min(INF_RELOAD.len() as i64 - 1)) as usize]
    } else {
        CAV_RELOAD
    };
    base as f64 * (1.1 - 0.25 * u.atf("xp") / 100.0) * (1.0 + 0.25 * u.atf("fat") / 100.0)
}

/// Python (units.py, l. 148-149) : `def ammo0_of(cls)`
pub fn ammo0_of(cls: &str) -> i64 {
    AMMO0().get_or(cls, 20).i()
}

/// Python (units.py, l. 152-153) : `def pieces(u)`
/// u : unité (lit men). Pièces encore servies : 1 à PIECES.
pub fn pieces(u: &Val) -> i64 {
    1.max(py::int((PIECES as f64 * u.atf("men") / ART_MEN as f64 - 0.2).ceil()))
}

/// (largeur, profondeur) en mètres de l'unité dans sa formation.
///
/// Python (units.py, l. 156-178) : `def footprint(u)`
/// u : unité (lit men, men_nom, form, cls). Le Python mêle int et float (`16, 16`, `(30, 60 * k)`) : ici des f64
/// (la vue passe par footprint_v, qui garde les types du Python : « 16 » et non « 16.0 »).
pub fn footprint(u: &Val) -> (f64, f64) {
    let (w, d) = footprint_v(u);
    (w.f(), d.f())
}

/// footprint avec les types du Python (16 et non 16.0) : la vue (`w`, `d`) les laisse voir. (Aide hors du socle.)
fn footprint_v(u: &Val) -> (Val, Val) {
    let men_nom = u.atf("men_nom");
    let k = u.atf("men") / if men_nom > 1.0 { men_nom } else { 1.0 };
    let k = if k > 0.25 { k } else { 0.25 };
    let f = u.at("form");
    let cls = u.at("cls");
    let fv = |a: f64, b: f64| (Val::from(a), Val::from(b));
    let iv = |a: i64, b: i64| (Val::from(a), Val::from(b));
    if cls == "artillerie" {
        let p = pieces(u) as f64 / PIECES as f64;
        return if f == "batterie" { (Val::from(80.0 * p + 10.0), Val::from(30)) } else { (Val::from(30), Val::from(30.0 + 40.0 * p)) };
    }
    if cls == "general" {
        return iv(16, 16);
    }
    if cls == "chariot" {
        return iv(12, 24);
    }
    if cls == "cavalerie" {
        return if f == "ligne" { (Val::from(100.0 * k), Val::from(15)) } else { (Val::from(30), Val::from(60.0 * k)) };
    }
    if f == "colonne" {
        return (Val::from(40), Val::from(50.0 * k));
    }
    if f == "maisons" {
        return iv(40, 40);
    }
    if f == "carre" {
        let s = 45.0 * k.sqrt();
        return fv(s, s);
    }
    if f == "tirailleurs" {
        return (Val::from(220.0 * k), Val::from(30));
    }
    (Val::from(120.0 * k), Val::from(12))
}

/// `round(v, nd)` de Python : un int reste un int, un float est arrondi (`py::round_n`). (Aide hors du socle.)
fn round_v(v: &Val, nd: i32) -> Val {
    if v.is_int() { v.clone() } else { Val::from(py::round_n(v.f(), nd)) }
}

py_const!(SLOTS, tup!["id", "side", "owner", "type", "cls", "light", "name", "men", "men0", "men_nom", "xp", "xp0", "morale",
    "morale0", "fat", "ammo", "ammo0", "arm", "x", "y", "dir", "form", "state", "order", "seen", "target",
    "path", "goal", "reload", "busy", "next_form", "fire_mode", "fired_t", "melee_with", "rally_t", "lost",
    "killed", "captured", "fought", "army", "src", "nid", "gen", "ctrl", "charge_v", "spotted_t", "stuck",
    "rout_seen", "hit_t", "wounded", "group", "gname", "halt", "shot", "prio", "still_t", "stop", "flag"]);

/// `Unit(**kw)` : une unité tactique, un dict dont les clés sont dans l'ordre de SLOTS (celui de `to_dict`) : pour
/// chaque attribut, la valeur de `kw` si elle y est, sinon le défaut de `__init__` s'il en a un, sinon la clé est
/// absente (`id`, `side`, `owner`, `type`, `cls`, `name`, `men`, `men0`, `xp`, `morale`, `ammo`, `ammo0`, `x`, `y`,
/// `form` n'ont pas de défaut). Une clé de `kw` hors de SLOTS : AttributeError, comme en Python.
///
/// kw : dict (`U::Unit(&dict!{"type" => typ, "cls" => cls, "arm" => arm})`). Les valeurs de kw sont rangées telles
/// quelles (le même objet : `path`, `order`, `gen` restent partagés avec l'appelant).
///
/// Types des attributs (ce qu'on y range ; `atf`, `ati`, `ats`, `atb` les lisent) :
/// - `id` : texte ('r12', 'g' + armée, 'w' + armée, 'm' + place, 'c…' canons du rempart) ; `side` : 0 ou 1 ;
///   `owner` : code du camp (texte) ; `type` : texte (rules.UNITS, 'milice', 'general', 'chariot') ; `cls` : 'inf',
///   'cavalerie', 'artillerie', 'general', 'chariot' ; `name`, `form`, `state`, `fire_mode`, `src`, `ctrl`, `shot`,
///   `stop` : textes ; `light`, `seen`, `rout_seen`, `wounded`, `halt`, `flag` : bool ;
/// - `men`, `men0`, `men_nom`, `xp`, `xp0`, `morale`, `morale0`, `fat`, `ammo`, `x`, `y`, `dir`, `reload`, `busy`,
///   `fired_t`, `still_t`, `rally_t`, `lost`, `killed`, `captured`, `fought`, `charge_v`, `spotted_t`, `hit_t` :
///   flottants ; `ammo0`, `arm`, `stuck` : entiers ;
/// - `order` : None ou dict {kind, …} ; `target`, `melee_with` : None ou l'id d'une unité ; `next_form`, `prio`,
///   `group`, `gname`, `army` : None ou texte ; `nid` : None ou l'id de la place ; `gen` : None ou dict
///   {name, trait, lvl, rank} ; `path` : liste de tuples (x, y) ; `goal` : None ou liste [x, y, dir ou None, run].
pub fn Unit(kw: &Val) -> Val {
    let defauts = dict! {
        "light" => false,
        "men_nom" => 300.0,
        "xp0" => 0.0,
        "morale0" => 80.0,
        "fat" => 0.0,
        "arm" => 0,
        "dir" => 0.0,
        "state" => "repos",
        "order" => Val::None,
        "seen" => false,
        "target" => Val::None,
        "path" => list![],
        "goal" => Val::None,
        "reload" => 0.0,
        "busy" => 0.0,
        "next_form" => Val::None,
        "fire_mode" => "free",
        "fired_t" => -999.0,
        "still_t" => 0.0,      // dernier instant où elle a bougé (retranchements)
        "melee_with" => Val::None,
        "rally_t" => 0.0,
        "lost" => 0.0,
        "killed" => 0.0,
        "captured" => 0.0,
        "fought" => 0.0,
        "army" => Val::None,
        "src" => "reg",
        "nid" => Val::None,
        "gen" => Val::None,
        "ctrl" => "ia",
        "charge_v" => 0.0,
        "spotted_t" => -999.0,
        "stuck" => 0,
        "rout_seen" => false,
        "hit_t" => -999.0,
        "wounded" => false,
        "group" => Val::None,
        "gname" => Val::None,
        "halt" => false,       // en déroute : les fuyards se sont arrêtés pour se reformer (près du général, au calme)
        "shot" => "auto",      // artillerie : projectile ordonné ('auto', 'boulet', 'mitraille')
        "prio" => Val::None,   // artillerie : cible de prédilection ('artillerie' : contre-batterie)
        "stop" => "bonne",     // profil d'arrêt de l'ordre « attaquer » du joueur (STOPS, stop_dist)
        "flag" => true,        // le drapeau du régiment (infanterie) : pris par l'ennemi, il manque au ralliement
    };
    let slots = SLOTS();
    for k in kw.iter() {
        if !slots.has(&k) {
            panic!("AttributeError: 'Unit' object has no attribute {}", k.repr())
        }
    }
    let u = Val::dict();
    for k in slots.iter() {
        if kw.has(&k) {
            u.set(&k, kw.at(&k))
        } else if defauts.has(&k) {
            u.set(&k, defauts.at(&k))
        }
    }
    u
}

// ------------------------------------------------------------------ état
/// Python (units.py, l. 239-241) : `def alive(self)`
/// Propriété `u.alive` → `U::alive(&u)`.
pub fn alive(u: &Val) -> bool {
    u.at("state") != "hors" && u.atf("men") >= 1.0
}

/// En état de combattre (ni en déroute, ni hors de combat) ; l'état-major ne compte pas.
///
/// Python (units.py, l. 243-246) : `def valid(self)`
/// Propriété `u.valid` → `U::valid(&u)`.
pub fn valid(u: &Val) -> bool {
    let (state, cls) = (u.at("state"), u.at("cls"));
    state != "hors" && state != "deroute" && u.atf("men") >= 1.0 && cls != "general" && cls != "chariot"
}

/// Python (units.py, l. 248-249) : `def size(self)`
/// `u.size()` → `U::size(&u)` : footprint(u).
pub fn size(u: &Val) -> (f64, f64) {
    footprint(u)
}

/// Python (units.py, l. 251-254) : `def to_dict(self)`
/// `u.to_dict()` → `U::to_dict(&u)`. Rend un dict NEUF des clés de SLOTS, dans l'ordre de SLOTS (un attribut
/// jamais posé : AttributeError en Python, KeyError ici), `path` en listes [x, y] arrondies au dixième ; les
/// autres valeurs sont les mêmes objets que ceux de l'unité (order, goal, gen).
pub fn to_dict(u: &Val) -> Val {
    let d = Val::dict();
    for k in SLOTS().iter() {
        d.set(&k, u.at(&k));
    }
    d.set("path", u.at("path").iter().map(|p| list![round_v(&p.at(0), 1), round_v(&p.at(1), 1)]).collect::<Val>());
    d
}

/// Python (units.py, l. 256-265) : `def from_dict(cls, d)`
/// `Unit.from_dict(d)` → `U::from_dict(&d)`. d : dict d'une sauvegarde. Rend une unité neuve (`Unit(&dict!{})`
/// puis les clés de SLOTS présentes dans d ; `path` en tuples, `goal` recopié en liste).
pub fn from_dict(d: &Val) -> Val {
    let u = Unit(&dict! {});
    for k in SLOTS().iter() {
        if d.has(&k) {
            u.set(&k, d.at(&k));
        }
    }
    u.set("path", d.get("path").or(list![]).iter().map(|p| p.to_tuple()).collect::<Val>());
    if u.at("goal").is_some() {
        u.set("goal", u.at("goal").to_list());
    }
    u
}

/// Ce que le client reçoit de cette unité (contrat, § 6).
///
/// Python (units.py, l. 267-300) : `def view(self, mine, seen_by_foe)`
/// `u.view(mine, seen)` → `U::view(&u, mine, seen)`. mine : l'unité est à qui regarde (ou pas de camp) ;
/// seen_by_foe : l'ennemi la voit (`u.seen`). Rend un dict pour le client ; `range` : [e, m] + [g] si g (entiers).
pub fn view(u: &Val, mine: bool, seen_by_foe: bool) -> Val {
    let (w, d) = footprint_v(u);
    let (e, m, g) = ranges(u);
    let range = list![e, m];
    if g.truthy() {
        range.push(&g);
    }
    let out = dict! {
        "id" => u.at("id"), "side" => u.at("side"), "type" => u.at("type"), "cls" => u.at("cls"), "name" => u.at("name"),
        "men" => py::round(u.atf("men")), "men0" => py::round(u.atf("men0")), "x" => round_v(&u.at("x"), 1),
        "y" => round_v(&u.at("y"), 1), "dir" => round_v(&u.at("dir"), 3), "form" => u.at("form"), "state" => u.at("state"),
        "morale" => py::round(u.atf("morale")), "fat" => py::round(u.atf("fat")), "xp" => py::round(u.atf("xp")),
        "ammo" => round_v(&u.at("ammo"), 1), "ammo0" => u.at("ammo0"), "arm" => u.at("arm"), "range" => range,
        "w" => round_v(&w, 1), "d" => round_v(&d, 1), "owner" => u.at("owner"), "group" => u.at("group"),
        "gname" => u.at("gname"),
    };
    let art = u.at("cls") == "artillerie";
    if art {
        out.set("pieces", pieces(u));
    }
    if mine {
        out.set("seen", seen_by_foe);
        out.set("fire", u.at("fire_mode"));
        out.set("stop", u.at("stop"));
        if art {
            out.set("shot", u.at("shot"));
            out.set("prio", u.at("prio"));
        }
        if u.atb("target") {
            out.set("target", u.at("target"));
        }
        if u.atb("order") {
            out.set("order", u.at("order").get("kind"));
        }
        if u.atf("busy") > 0.0 {
            out.set("busy", py::round(u.atf("busy")));
        }
        let path = u.at("path");
        if path.truthy() {
            let pts: Val = path.slice(None, Some(12)).iter().map(|p| list![py::round(p.at(0).f()), py::round(p.at(1).f())]).collect();
            out.set("path", pts);
        }
        if u.at("state") == "deroute" {
            out.set("halt", u.atb("halt")); // (les fuyards se sont arrêtés : on les rallie)
        }
    }
    if u.atb("gen") {
        out.set("gen", u.at("gen"));
    }
    if !u.atb("flag") {
        out.set("flag", false); // (drapeau pris : le client ne dessine plus le porte-drapeau)
    }
    out
}

// de 1760 à 1860, les régiments de cavalerie sont tour à tour dragons (habit vert : web/js/battle/formes.js, uniform),
// chasseurs à cheval et hussards
py_const!(CAV_NAMES, tup!["dragons", "ch. à cheval", "hussards"]);

/// Nom affiché : « 3e Ligne », « 1er dragons », « Milice d'Agen »…
///
/// Python (units.py, l. 308-318) : `def unit_name(g, owner, typ, idx)`
/// g : la partie, ou None (aucun appelant du jeu ne passe None ; le Python le permet) ; owner : code du camp
/// (texte ; `owner in g.factions`) ; typ : type de troupe ; idx : rang (1, 2, …).
/// Lit `g.factions`, `g.unit_name(owner, typ)[1]` et `g.date().year` (engine).
pub fn unit_name(g: Option<&Game>, owner: &Val, typ: &str, idx: i64) -> String {
    if typ == "general" {
        return "État-major".to_string();
    }
    let mut short = match g {
        Some(g) if g.factions.has(owner) => g.unit_name(owner.s(), typ).1,
        _ => {
            let units = R::UNITS();
            if units.has(typ) { units.at(typ).ats("short") } else { "Milice".to_string() }
        }
    };
    if let Some(g) = g {
        if typ == "cavalerie" && (1760..1860).contains(&g.date(&Val::None).year) {
            let noms = CAV_NAMES();
            short = noms.at(py::mod_i(idx - 1, noms.len() as i64)).string();
        }
    }
    format!("{idx}{} {short}", if idx == 1 { "er" } else { "e" })
}

/// Unité tactique tirée d'un régiment de campagne (munitions et fatigue reprises de la campagne).
///
/// Python (units.py, l. 321-332) : `def from_reg(reg, side, owner, name, army=None, src='reg', nid=None, ctrl='ia')`
/// reg : régiment de campagne (dict : id, type, n, xp, morale, fat, ammo, arm) ; owner : code du camp ; army : id
/// de l'armée ou None (défaut None) ; src : 'reg' (défaut), 'garnison', 'rempart' ; nid : place ou None (défaut
/// None) ; ctrl : 'ia' (défaut) ou 'joueur'. Rend l'unité (`Unit(&dict!{…})`, x = y = 0.0).
pub fn from_reg(reg: &Val, side: i64, owner: &Val, name: &str, army: &Val, src: &str, nid: &Val, ctrl: &str) -> Val {
    let typ = reg.ats("type");
    let cls = cls_of(&typ);
    let a0 = ammo0_of(&cls);
    let units = R::UNITS();
    let nom = if units.has(&typ) { py::float_v(&units.at(&typ).at("men")) } else { 300.0 };
    let light = units.get_or(&typ, Val::dict()).get("light").truthy();
    let form = if cls == "artillerie" { "attelee" } else if light { "tirailleurs" } else { "ligne" };
    let n = py::float_v(&reg.at("n"));
    let xp = py::float_v(&reg.get_or("xp", 0));
    let morale = py::float_v(&reg.get_or("morale", 70));
    Unit(&dict! {"id" => reg.at("id"), "side" => side, "owner" => owner, "type" => &typ, "cls" => &cls, "light" => light,
        "name" => name, "men" => n, "men0" => n, "men_nom" => nom, "xp" => xp, "xp0" => xp, "morale" => morale,
        "morale0" => morale, "fat" => py::float_v(&reg.get_or("fat", 0.0)),
        "ammo" => (a0 * reg.get_or("ammo", 100.0)) / 100.0, "ammo0" => a0, "arm" => py::int_v(&reg.get("arm").or(0)),
        "x" => 0.0, "y" => 0.0, "form" => form, "army" => army, "src" => src, "nid" => nid, "ctrl" => ctrl})
}

/// Python (units.py, l. 335-339) : `def milice(uid, side, owner, men, morale, arm, name, nid, ctrl='ia')`
/// uid : id de l'unité (texte 'm…') ; arm : génération d'armes de l'infanterie du camp ; ctrl : 'ia' par défaut.
/// Rend l'unité.
pub fn milice(uid: &Val, side: i64, owner: &Val, men: f64, morale: f64, arm: i64, name: &str, nid: &Val, ctrl: &str) -> Val {
    let a0 = AMMO0().ati("inf");
    Unit(&dict! {"id" => uid, "side" => side, "owner" => owner, "type" => "milice", "cls" => "inf", "name" => name,
        "men" => men, "men0" => men, "men_nom" => 300.0, "xp" => 10.0, "xp0" => 10.0, "morale" => morale,
        "morale0" => morale, "ammo" => a0 as f64, "ammo0" => a0, "arm" => arm, "form" => "ligne", "src" => "milice",
        "nid" => nid, "ctrl" => ctrl})
}

/// Python (units.py, l. 342-347) : `def general(uid, side, owner, gen, army, ctrl='ia')`
/// gen : le général de campagne (dict : name, trait, lvl) ; army : id de son armée ; ctrl : 'ia' par défaut.
/// Rend l'unité d'état-major (son `gen` : dict {name, trait, lvl, rank}, rank tiré de R::GENERAL_RANKS()).
pub fn general(uid: &Val, side: i64, owner: &Val, gen: &Val, army: &Val, ctrl: &str) -> Val {
    let ranks = R::GENERAL_RANKS();
    let lvl = gen.get_or("lvl", 1);
    let i = 0.max((ranks.len() as i64 - 1).min(lvl.i() - 1));
    Unit(&dict! {"id" => uid, "side" => side, "owner" => owner, "type" => "general", "cls" => "general",
        "name" => format!("État-major {}", gen.get_or("name", "")).trim().to_string(),
        "men" => 30.0, "men0" => 30.0, "men_nom" => 30.0, "xp" => 50.0, "xp0" => 50.0, "morale" => 90.0, "morale0" => 90.0,
        "ammo" => 20.0, "ammo0" => 20, "arm" => 0, "form" => "colonne", "src" => "general", "army" => army, "ctrl" => ctrl,
        "gen" => dict! {"name" => gen.get("name"), "trait" => gen.get("trait"), "lvl" => &lvl, "rank" => ranks.at(i)}})
}

/// Chariot de munitions d'une armée : recomplète les régiments proches ; se capture ou se détruit.
/// ammo : chargement restant, en % (100 = plein).
///
/// Python (units.py, l. 350-355) : `def wagon(uid, side, owner, army, name, ctrl='ia')`
/// ctrl : 'ia' par défaut. Rend l'unité.
pub fn wagon(uid: &Val, side: i64, owner: &Val, army: &Val, name: &str, ctrl: &str) -> Val {
    Unit(&dict! {"id" => uid, "side" => side, "owner" => owner, "type" => "chariot", "cls" => "chariot", "name" => name,
        "men" => 20.0, "men0" => 20.0, "men_nom" => 20.0, "xp" => 0.0, "xp0" => 0.0, "morale" => 60.0, "morale0" => 60.0,
        "ammo" => 100.0, "ammo0" => 100, "arm" => 0, "form" => "colonne", "src" => "chariot", "army" => army, "ctrl" => ctrl})
}

#[cfg(test)]
mod essais {
    use super::*;

    #[test]
    fn unit_defauts_et_ordre() {
        let chemin = list![];
        let u = Unit(&dict! {"cls" => "inf", "type" => "ligne", "arm" => 2, "path" => &chemin});
        // l'ordre de SLOTS, pas celui de kw ; les défauts de __init__ ; pas de clé sans valeur
        assert_eq!(u.keys()[..3], [Val::from("type"), Val::from("cls"), Val::from("light")]);
        assert_eq!(u.len(), 43 + 2);
        assert!(u.at("arm") == 2 && u.at("stop") == "bonne" && u.at("fired_t") == -999.0 && u.atb("flag"));
        assert!(!u.has("id") && u.at("order").is_none());
        assert!(u.at("path").is(&chemin));
        assert!(!Unit(&dict! {}).at("path").is(&Unit(&dict! {}).at("path")));
    }
}
