//! La fiche chiffrée d'un régiment (l'ancien game/tactics/stats.py, et ce qu'il lisait de game/tactics/units.py : le
//! champ de bataille tactique est supprimé, SPEC-BATAILLE.md ; la fiche reste envoyée à la page par views.rs).
//!
//! Valeurs chiffrées d'une troupe, à la manière d'Empire: Total War. 40 = un régiment de ligne aguerri (xp 50) au fusil
//! à silex. Chaque valeur : [base, expérience, général]. Moral, fatigue, distance, terrain, couvert et temps n'y entrent
//! pas.
//!
//! Chiffres de référence :
//! - dotation d'un plein de munitions : infanterie 60 cartouches par homme, artillerie 120 coups par pièce, cavalerie 20 ;
//! - portées (efficace / maximale / mitraille), dérivées du type et de la génération d'armes `arm` : ranges(reg) ;
//! - justesse du feu : precision(u, d), moitié à D50 ;
//! - vitesses au pas sur prairie (m/s) : infanterie 1,2, légère 1,4, cavalerie 2,5, artillerie attelée 1,5 ;
//! - cadence d'un feu soutenu : une salve par minute environ pour le fusil à silex, une volée toutes les 80 à 100 s pour
//!   les canons lisses.

use crate::engine::Game;
use crate::py::{self, Val};
use crate::rules as R;
use crate::{dict, list, py_const, tup};

// ================================================================== les troupes (units.py)

py_const!(AMMO0, dict!{"inf" => 60, "artillerie" => 120, "cavalerie" => 20});

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
    if u.at_is("type", "mitrailleuses") {
        return MIT_D50;
    }
    if u.at_is("cls", "inf") {
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

/// Python (units.py, l. 136-145) : `def reload_time(u)`
/// u : unité (lit type, cls, arm, xp, fat ; la fiche l'appelle sur un dict presque nu). Secondes de bataille.
pub fn reload_time(u: &Val) -> f64 {
    let arm = || u.ati("arm");
    let base = if u.at_is("type", "mitrailleuses") {
        MIT_RELOAD
    } else if u.at_is("cls", "artillerie") {
        ART_RELOAD[0.max(arm().min(ART_RELOAD.len() as i64 - 1)) as usize]
    } else if u.at_is("cls", "inf") {
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

// de 1760 à 1860, les régiments de cavalerie sont tour à tour dragons (habit vert : web/js/battle/formes.js, uniform),
// chasseurs à cheval et hussards
py_const!(CAV_NAMES, tup!["dragons", "ch. à cheval", "hussards"]);

/// Nom affiché : « 3e Ligne », « 1er dragons »…
///
/// Python (units.py, l. 308-318) : `def unit_name(g, owner, typ, idx)`
/// owner : code du camp (texte ; `owner in g.factions`) ; typ : type de troupe ; idx : rang (1, 2, …).
/// Lit `g.factions`, `g.unit_name(owner, typ)[1]` et `g.date().year` (engine).
pub fn unit_name(g: &Game, owner: &Val, typ: &str, idx: i64) -> String {
    let mut short = if g.factions.has(owner) {
        g.unit_name(owner.s(), typ).1
    } else {
        let units = R::UNITS();
        if units.has(typ) { units.at(typ).ats("short") } else { "Milice".to_string() }
    };
    if typ == "cavalerie" && (1760..1860).contains(&g.date(&Val::None).year) {
        let noms = CAV_NAMES();
        short = noms.at(py::mod_i(idx - 1, noms.len() as i64)).string();
    }
    format!("{idx}{} {short}", if idx == 1 { "er" } else { "e" })
}

// ================================================================== la fiche (stats.py)

pub const K: f64 = 40.0; // 40 = ligne aguerrie au fusil à silex
pub const K_CHOC: f64 = 15.0; // charge : 15 = une ligne à plein élan
py_const!(ELAN, dict!{"cavalerie" => 2.2, "inf" => 1.0}); // élan de la charge
// technologies de combat de l'armée (rules.TECH, comme engine.reg_power) : la fiche les compte dans la base
py_const!(TECH_MODS, tup!["all_power", "inf_power", "art_power", "cav_power", "ligne_fire", "carre_fire", "colonne_charge",
    "cav_charge", "art_charge"]);
py_const!(ARM_POWER, dict!{"inf" => "inf_power", "artillerie" => "art_power", "cavalerie" => "cav_power"});
pub const CARRE_T: f64 = 60.0; // secondes pour former le carré (l'ancien battle.FORM_TIME['carre'])

/// L'expérience au tir, à la mêlée et au feu de défense : ×0,8 à ×1,2.
///
/// Python (stats.py, l. 25-27) : `def xp_k(xp)`
pub fn xp_k(xp: f64) -> f64 {
    0.8 + xp / 250.0
}

/// Toutes armes et arme de la troupe (état-major, système divisionnaire, poudreries, hussards…) : au tir, à la
/// mêlée, au choc.
///
/// Python (stats.py, l. 30-33) : `def power_k(md, cls)`
/// md : technologies de l'armée ou du régiment (dict TECH_MODS → valeur, {} sans elles) ;
/// cls : classe de l'unité.
pub fn power_k(md: &Val, cls: &str) -> f64 {
    let arm = ARM_POWER();
    if arm.has(cls) { 1.0 + md.get_or("all_power", 0.0).f() + md.get_or(arm.at(cls), 0.0).f() } else { 1.0 }
}

/// Cuirassiers (la cavalerie) ou ordre mixte (l'infanterie en colonne) : l'élan de la charge.
///
/// Python (stats.py, l. 36-38) : `def charge_k(md, cls)`
/// md : comme power_k.
pub fn charge_k(md: &Val, cls: &str) -> f64 {
    1.0 + md.get_or(if cls == "cavalerie" { "cav_charge" } else { "colonne_charge" }, 0.0).f()
}

/// Python (stats.py, l. 41-44) : `def _v(f, xp, kg=1.0, nd=None)`
/// f : la valeur selon l'expérience (le Python l'appelle avec l'int 0 : `f(0.0)`) ; kg : facteur du général
/// (défaut 1.0) ; nd : None (défaut : `round(x)` rend des ENTIERS, `py::round`) ou 1 (`round(x, 1)` : des
/// flottants, `py::round_n`). Rend la liste [base, expérience, général].
pub fn _v(f: impl Fn(f64) -> f64, xp: f64, kg: f64, nd: &Val) -> Val {
    // arrondis sur les totaux : base + expérience + général retombent juste
    if nd.is_none() {
        let (b, t) = (py::round(f(0.0)), py::round(f(xp)));
        return list![b, t - b, py::round(f(xp) * kg) - t];
    }
    let nd = nd.i() as i32;
    let (b, t) = (py::round_n(f(0.0), nd), py::round_n(f(xp), nd));
    list![b, py::round_n(t - b, nd), py::round_n(py::round_n(f(xp) * kg, nd) - t, nd)]
}

/// Valeurs d'une troupe (régiment de campagne ou unité tactique) : dict clé → [base, expérience, général],
/// sauf por (portées en m), jus (demi-justesse D50, en m) et mun (dotation). mods : technologies de l'armée
/// (TECH_MODS), dans la base.
///
/// Python (stats.py, l. 47-85) : `def stats(typ, arm=0, xp=0.0, trait=None, defender=False, swift=0.0, mods=None)`
/// typ : type de troupe ; arm : génération d'armes, entier ou None (`arm or 0` ; défaut 0) ; xp : défaut 0.0 ;
/// trait_ : trait du général, texte ou None (défaut None) ; defender : défaut false ; swift : défaut 0.0 ;
/// mods : dict des technologies ou None (défaut None : {}).
/// Rend un dict : mel, chg, pre, rec, vit, dis, car → listes de _v ; por → liste [e, m, g ou None] ;
/// mun → entier ; jus → entier.
pub fn stats(typ: &str, arm: &Val, xp: f64, trait_: &Val, defender: bool, swift: f64, mods: &Val) -> Val {
    let types = TYPE();
    let t = types.get(typ).or_else(|| types.at("ligne"));
    let (melee, fire, speed, steady) = (t.atf("melee"), t.atf("fire"), t.atf("speed"), t.atf("steady"));
    let cls = cls_of(typ);
    let arm = arm.or(0).i();
    let md = mods.or(Val::dict());
    let pk = power_k(&md, &cls);
    let aud = trait_ == "audacieux";
    let out = dict! {"mel" => _v(|x| K * melee * xp_k(x) * pk, xp, if aud { 1.08 } else { 1.0 }, &Val::None)};
    let elan = ELAN();
    if elan.has(&cls) {
        let kg = (if aud { 1.12 } else { 1.0 }) * (if trait_ == "cavalier" && cls == "cavalerie" { 1.2 } else { 1.0 });
        // (l'expérience n'y fait rien ; l'infanterie charge en colonne)
        let e = elan.atf(&cls);
        out.set("chg", _v(|_x| K_CHOC * e * melee * pk * charge_k(&md, &cls), xp, kg, &Val::None));
    }
    let arms = R::ARMS();
    let mut fk = if typ == "mitrailleuses" {
        Some(1.0)
    } else if cls == "inf" {
        let l = arms.at("inf");
        Some(fire * l.at(arm.min(l.len() as i64 - 1)).atf(2).sqrt())
    } else if cls == "cavalerie" {
        Some(fire * 0.8f64.sqrt()) // ses carabines
    } else if cls == "artillerie" {
        let l = arms.at("artillerie");
        Some(l.at(arm.min(l.len() as i64 - 1)).atf(2))
    } else {
        None // état-major, chariot : ils ne tirent pas
    };
    let fk_vrai = |fk: Option<f64>| fk.is_some_and(|v| v != 0.0);
    if fk_vrai(fk) && cls == "inf" {
        fk = fk.map(|v| v * (1.0 + md.get_or("ligne_fire", 0.0).f())); // feu de rang, de peloton : en ligne, comme la base
    }
    if fk_vrai(fk) {
        let fk = fk.unwrap();
        let art = cls == "artillerie" && typ != "mitrailleuses" && trait_ == "artilleur";
        out.set("pre", _v(|x| K * fk * pk * xp_k(x), xp, if art { 1.25 } else { 1.0 }, &Val::None));
        out.set("rec", _v(|x| reload_time(&dict! {"type" => typ, "cls" => &cls, "arm" => arm, "xp" => x, "fat" => 0.0}), xp, 1.0, &Val::None));
        let (e, m, g) = ranges(&dict! {"type" => typ, "arm" => arm});
        out.set("por", list![e, m, g]);
        out.set("mun", ammo0_of(&cls));
        if typ == "mitrailleuses" || cls != "artillerie" {
            // portée de justesse : la Précision (à bout portant) y tombe de moitié (units.precision, 1/(1+(d/D50)²))
            let p = precision(&dict! {"type" => typ, "cls" => &cls, "arm" => arm}, 100.0);
            out.set("jus", py::round(100.0 / (1.0 / p - 1.0).sqrt()));
        }
    }
    out.set("vit", _v(|_x| speed, xp, if trait_ == "cavalier" && cls == "cavalerie" { 1.1 } else { 1.0 }, &Val::from(1)));
    let kd = if trait_ == "inspirant" {
        1.0 / 0.85
    } else if trait_ == "prudent" && defender {
        1.0 / 0.9
    } else {
        1.0
    };
    out.set("dis", _v(|_x| K * steady, xp, kd, &Val::None));
    if cls == "inf" {
        let carre = CARRE_T;
        out.set("car", _v(
            |x| {
                let a = 1.0 - 0.4 * x / 100.0 - swift;
                let v = carre * if a > 0.4 { a } else { 0.4 };
                if v > 10.0 { v } else { 10.0 }
            },
            xp,
            1.0,
            &Val::None,
        ));
    }
    out
}
