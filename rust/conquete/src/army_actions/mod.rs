//! Actions d'une armée dans une place : fortification de fortune, quartiers, garde bourgeoise, réquisition ;
//! devant une place étrangère : traversée et droit de passage, ralliement négocié, contribution, blocus.
//!
//! L'état propre à une place est rangé dans n['aa'] (travaux, solidité des barricades, garde, négociation, délais) ;
//! celui d'une armée dans a['tr'] (traverser), a['hold'] (halte devant une place), a['qrt'] (quartiers), a['rg'] (rangs à compléter),
//! a['cl'] (sur des terres fermées : délai de grâce), a['ex'] (terres fermées dont son itinéraire la fait sortir),
//! a['dt'] (terres fermées que son itinéraire contourne) ; les droits de passage dans
//! faction['passage'] = {bénéficiaire: échéance}.
//!
//! Porte game/army_actions.py, lignes 1 à 120 : constantes, petits outils, migration. Le reste est découpé en parties,
//! dans l'ordre du Python, réexportées ici (`AA::fortify`, `AA::land_tick`…) :
//!
//!     defense.rs      lignes  121 à  858   défense des places, tic, fortification, quartiers, rangs, garde,
//!                                          réquisition, traverser et droit de passage, arrivée devant une place
//!     negociation.rs  lignes  859 à 1582   délai de grâce et passages, ralliement négocié, contribution, blocus,
//!                                          commandes, vues, IA
//!
//! Une signature ne se change pas sans le signaler (PORTAGE.md).
//! Dans tout le module : `a`, `b` = une armée (dict de g.armies) ; `n` = une place (dict de g.nodes) ; `gn` = son lieu
//! (dict de geo.nodes) ; `x` = n['aa'] ; `r` = un régiment ; `code` = le camp qui agit ; `o` = un autre camp (ou
//! R::NEUTRAL) ; `nid` = un numéro de place ; `ai` = l'IA de campagne (ai::AI), dont `ai.g` est le `g` passé à côté.
//! `(bool, String)` : (ok, message) d'une commande.
#![allow(unused_imports)]

use crate::engine::Game;
use crate::geo::TERRAIN;
use crate::py::{self, Val};
use crate::rules as R;
use crate::turns as TT;
use crate::{dict, list, py_const, pyset, tup};

mod defense;
mod negociation;
pub use defense::*;
pub use negociation::*;

// ------------------------------------------------------------------ fortification de fortune
py_const!(BAR_WORK, dict!{"village" => 4000, "fort" => 5000, "ville" => 6000, "capitale" => 9000});  // journées d'homme
py_const!(BAR_BOIS, dict!{"village" => 40, "fort" => 50, "ville" => 60, "capitale" => 90});
pub const BAR_SAPEUR: i64 = 5;  // un sapeur abat l'ouvrage de six fantassins
pub const BAR_DAYS: (f64, f64) = (2.0, 20.0); // durée des travaux, au plus court et au plus long
pub const BAR_LEVEL: f64 = 0.8;  // une place sans remparts barricadée vaut presque un mur d'enceinte (niveau 1)
pub const RED_LEVEL: f64 = 0.3;  // redoutes devant des remparts : petit bonus
pub const RED_WORK: f64 = 0.6;  // les redoutes demandent moins de travail
pub const BAR_WEAR: f64 = 1.0 / 90.0; // usure par jour : environ trois tours
pub const BAR_WET: f64 = 1.5;  // pluie, orage, neige, tempête
pub const BAR_WINTER: f64 = 1.3;
pub const BAR_SIEGE: f64 = 1.6;  // la brèche s'ouvre plus vite que dans des remparts
pub const BAR_GUN: f64 = 0.012;  // usure par jour et par batterie ennemie qui tire dessus
pub const BAR_REDO: f64 = 0.7;  // on peut relever un ouvrage usé sous ce seuil
pub const BAR_MIN: f64 = 0.25;  // en dessous, l'ouvrage n'arrête plus personne (plus de siège)

// ------------------------------------------------------------------ quartiers
pub const QRT_REPL: f64 = 0.01;  // renforts en plus par jour (part de l'effectif) : les quartiers sont surtout repos et ordre
pub const QRT_FOOD: f64 = 0.6;  // vivres consommés en plus (part de l'entretien)
pub const QRT_STAB: f64 = 0.12;  // ordre public visé en plus dans la place

// ------------------------------------------------------------------ compléter les rangs
pub const RNG_LOURD: f64 = 0.3;  // au-delà de 30 % de pertes, deux tours : une classe ne se lève ni ne s'instruit en un mois
pub const RNG_MIN: f64 = 0.02;  // en dessous, les rangs sont au complet
pub const RNG_REMONTE: f64 = 0.1;  // cavalerie et attelages : au-delà de 10 % de pertes, un tour de plus pour acheter et dresser les
// remontes (le goulot des armées : en 1813, la cavalerie française ne s'en est jamais remise)
pub const RNG_CADRE: f64 = 0.05;  // régiment anéanti : le dépôt envoie un cadre d'officiers et de sous-officiers autour duquel le relever
pub const MORTS_JOURS: i64 = 40;  // régiments anéantis qu'on peut encore relever : ceux de la bataille ou du mois précédents

// ------------------------------------------------------------------ garde bourgeoise
pub const GARDE_TOURS: i64 = 2;
pub const GARDE_CD: i64 = 6;  // délai entre deux levées dans la même place (tours)
pub const GARDE_MM: f64 = 0.6;  // milice en plus : part de la milice ordinaire…
pub const GARDE_POP: f64 = 0.012;  // … et des habitants
pub const GARDE_MAX: i64 = 900;
pub const GARDE_ARMES: f64 = 0.15;  // armes par homme armé
pub const GARDE_PROD: f64 = 0.9;  // production pendant que les bourgeois montent la garde

// ------------------------------------------------------------------ réquisition
pub const REQ_CD: i64 = 4;  // tours
pub const REQ_STAB: f64 = 0.25;
// (fixe, par habitant, plafond)
py_const!(REQ, dict!{
    "vivres" => tup![30, 0.012, 900],
    "recrues" => tup![10, 0.003, 300],
    "livres" => tup![0, 0.004, 400],
});

// ------------------------------------------------------------------ ralliement négocié
pub const NEG_TOURS: i64 = 1;  // réponse des notables : au tour suivant
pub const NEG_BASE: i64 = 40;
pub const NEG_POP: f64 = 0.02;
pub const NEG_MIL: f64 = 1.0;
pub const NEG_CD: i64 = 1;  // après un refus, les notables ne reçoivent plus pendant un tour

// ------------------------------------------------------------------ contribution
pub const CTB_CD: i64 = 3;  // tours
pub const CTB_MIN: f64 = 0.5;  // rapport de forces minimal pour se faire payer
py_const!(CTB, dict!{"livres" => tup![30, 0.01, 900], "vivres" => tup![20, 0.012, 600]});
pub const CTB_REL_ALL: i64 = 5;  // place indépendante : tous les départements s'en indignent…
pub const CTB_REL_HOME: i64 = 8;  // … surtout celui dont elle relève
pub const CTB_REL_OWNER: i64 = 15;  // place ennemie : son maître s'en souviendra
pub const CTB_STAB: f64 = 0.15;

// ------------------------------------------------------------------ blocus
py_const!(BLOC_FOOD, dict!{"village" => 18, "fort" => 30, "ville" => 25, "capitale" => 35});  // jours de réserves
pub const BLOC_DEPOT: i64 = 40;  // un magasin aux vivres tient bien plus longtemps
pub const BLOC_STARVE: i64 = 25;  // jours de famine avant la reddition
pub const BLOC_MIN: f64 = 0.5;  // rapport de forces pour investir la place

// ------------------------------------------------------------------ passage
pub const PASSAGE_TOURS: i64 = 12;  // droit de passage accordé (tours)
pub const INCIDENT_CD: i64 = 60;  // au-delà du délai de grâce : un incident par armée et par département, au plus tous les deux mois
pub const INCIDENT_REL: i64 = 10;
pub const NOTICE_CD: i64 = 60;

/// Python : `clamp(v, a, b)`.
// game/army_actions.py, lignes 86 à 87
pub fn clamp(v: f64, a: f64, b: f64) -> f64 {
    let m = if v < b { v } else { b };
    if m > a { m } else { a }
}

/// Python : `node_aa(n)`.
/// Rend n['aa'], ou un dict vide NEUF (qu'on ne range pas dans la place : l'écrire ne sert à rien).
// game/army_actions.py, lignes 90 à 91
pub fn node_aa(n: &Val) -> Val {
    n.get("aa").or(dict! {})
}

/// Python : `aa(n)`.
/// Rend n['aa'] (créé s'il manque).
// game/army_actions.py, lignes 94 à 95
pub fn aa(n: &Val) -> Val {
    n.setdefault("aa", dict! {})
}

/// Tours d'attente qui restent avant de pouvoir recommencer (0 : c'est possible).
/// Python : `cd_left(g, n, k)`.
// game/army_actions.py, lignes 98 à 100
pub fn cd_left(g: &Game, n: &Val, k: &str) -> i64 {
    TT::tours_left(g, node_aa(n).get_or("cd", dict! {}).get_or(k, -1).f())
}

/// Python : `set_cd(g, n, k, tours, code)`.
// game/army_actions.py, lignes 103 à 104
pub fn set_cd(g: &mut Game, n: &Val, k: &str, tours: i64, code: &str) {
    aa(n).setdefault("cd", dict! {}).set(k, TT::deadline(g, tours, &[code]));
}

/// Python : `place(g, nid)`.
// game/army_actions.py, lignes 107 à 108
pub fn place(g: &Game, nid: i64) -> String {
    g.geo.nodes.at(nid).ats("name")
}

/// Anciennes sauvegardes : ni travaux, ni droits de passage, ni quartiers.
/// Python : `migrate(g)`.
// game/army_actions.py, lignes 111 à 118
pub fn migrate(g: &mut Game) {
    for f in g.factions.values() {
        f.setdefault("passage", dict! {});
    }
    for a in g.armies.values() {
        for k in ["tr", "hold", "qrt", "rg"] {
            a.setdefault(k, false);
        }
        a.pop("trx"); // ancien passage forcé « quitte à provoquer un incident »
    }
}

// ------------------------------------------------------------------ aides du portage (absentes du socle)

/// `max(a, b)` de Python sur deux valeurs : le premier gagne en cas d'égalité, chacun garde son type (int / float).
pub(crate) fn vmax(a: impl Into<Val>, b: impl Into<Val>) -> Val {
    let (a, b) = (a.into(), b.into());
    if b > a { b } else { a }
}

/// `min(a, b)` de Python sur deux valeurs : le premier gagne en cas d'égalité.
pub(crate) fn vmin(a: impl Into<Val>, b: impl Into<Val>) -> Val {
    let (a, b) = (a.into(), b.into());
    if b < a { b } else { a }
}

/// Les arguments `x, y, who` de `g.log`.
pub(crate) fn lieu(xy: (f64, f64), who: impl Into<Val>) -> Val {
    dict! {"x" => xy.0, "y" => xy.1, "who" => who.into()}
}

/// Les arguments `x, y, who, important` de `g.log`.
pub(crate) fn lieu_imp(xy: (f64, f64), who: impl Into<Val>, important: bool) -> Val {
    dict! {"x" => xy.0, "y" => xy.1, "who" => who.into(), "important" => important}
}
