//! Porte game/tactics/stats.py.
//!
//! Valeurs chiffrées d'une troupe, à la manière d'Empire: Total War (fiche du régiment, en bataille et en campagne).
//!
//! Une seule source : elles se tirent des coefficients du moteur (units.TYPE, rules.ARMS, units.ranges, units.reload_time,
//! units.precision, battle.FORM_TIME, les technologies de l'armée) ; 40 = un régiment de ligne aguerri (xp 50) au fusil à
//! silex. Elles disent la vérité : deux fois plus en Mêlée, deux fois plus de pertes au corps à corps (tests/test_bataille.py,
//! ValeursChiffrees, le vérifie sur le moteur).
//! Chaque valeur : [base, expérience, général]. Moral, fatigue, distance, terrain, couvert et temps n'y entrent pas.

use crate::py::{self, Val};
use crate::rules as R;
use crate::tactics::battle as B; // (battle.rs lit aussi xp_k, ELAN, power_k, charge_k)
use crate::tactics::battle::TacticalBattle;
use crate::tactics::units as U;
use crate::{dict, list, py_const, tup};

pub const K: f64 = 40.0; // 40 = ligne aguerrie au fusil à silex
pub const K_CHOC: f64 = 15.0; // charge : 15 = une ligne à plein élan
py_const!(ELAN, dict!{"cavalerie" => 2.2, "inf" => 1.0}); // élan de la charge (battle._impact, mom)
// technologies de combat de l'armée (rules.TECH, comme engine.reg_power en résolution automatique) : bridge.make_spec
// les met dans spec['tech'][camp], battle.py les applique, la fiche les compte dans la base
py_const!(TECH_MODS, tup!["all_power", "inf_power", "art_power", "cav_power", "ligne_fire", "carre_fire", "colonne_charge",
    "cav_charge", "art_charge"]);
py_const!(ARM_POWER, dict!{"inf" => "inf_power", "artillerie" => "art_power", "cavalerie" => "cav_power"});

/// L'expérience au tir, à la mêlée et au feu de défense (battle._fire, _melee_k, _impact) : ×0,8 à ×1,2.
///
/// Python (stats.py, l. 25-27) : `def xp_k(xp)`
pub fn xp_k(xp: f64) -> f64 {
    0.8 + xp / 250.0
}

/// Toutes armes et arme de la troupe (état-major, système divisionnaire, poudreries, hussards…) : au tir, à la
/// mêlée, au choc.
///
/// Python (stats.py, l. 30-33) : `def power_k(md, cls)`
/// md : technologies de l'armée ou du régiment (dict TECH_MODS → valeur, {} sans elles : battle.tech_of) ;
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
/// mun → entier ; jus → entier. (Les unités d'essai : `U::Unit(&dict!{"type" => typ, "cls" => cls, "arm" => arm, "xp" => x})`.)
pub fn stats(typ: &str, arm: &Val, xp: f64, trait_: &Val, defender: bool, swift: f64, mods: &Val) -> Val {
    let types = U::TYPE();
    let t = types.get(typ).or_else(|| types.at("ligne"));
    let (melee, fire, speed, steady) = (t.atf("melee"), t.atf("fire"), t.atf("speed"), t.atf("steady"));
    let cls = U::cls_of(typ);
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
        out.set("rec", _v(|x| U::reload_time(&U::Unit(&dict! {"type" => typ, "cls" => &cls, "arm" => arm, "xp" => x})), xp, 1.0, &Val::None));
        let (e, m, g) = U::ranges(&dict! {"type" => typ, "arm" => arm});
        out.set("por", list![e, m, g]);
        out.set("mun", U::ammo0_of(&cls));
        if typ == "mitrailleuses" || cls != "artillerie" {
            // portée de justesse : la Précision (à bout portant) y tombe de moitié (units.precision, 1/(1+(d/D50)²))
            let p = U::precision(&U::Unit(&dict! {"type" => typ, "cls" => &cls, "arm" => arm}), 100.0);
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
        let carre = B::FORM_TIME().atf("carre");
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

/// Les valeurs d'une unité tactique dans sa bataille (trait du général vivant, ordre mixte de son camp).
///
/// Python (stats.py, l. 88-91) : `def of_unit(u, tb)`
/// u : unité ; tb : sa bataille (`tb.r#trait(side)`, `tb.tech(side)`, `tb.spec`).
pub fn of_unit(u: &Val, tb: &mut TacticalBattle) -> Val {
    let side = u.ati("side");
    let tr = tb.r#trait(side);
    let swift = tb.spec.get_or("fm_swift", list![0, 0]).at(side).f();
    let tech = tb.tech(side);
    stats(u.ats("type").as_str(), &u.at("arm"), u.atf("xp"), &tr, side == 1, swift, &tech)
}
