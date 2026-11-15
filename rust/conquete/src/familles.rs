//! Familles dirigeantes (SPEC-MERCENAIRES.md, « Familles et successions ») : la maison de chaque camp, son chef, ses
//! héritiers et ses mariages ; chaque année, naissances, morts et successions, et la crise quand il n'y a pas d'héritier.
//!
//!     f['maison'] = dict(nom, chef=dict(nom, ne, trait) | None (succession en cours), conjoint=None | dict(nom, de),
//!                        heritiers=[dict(nom, ne[, conjoint])], liens={camp: année du mariage})
//!
//! Porte game/familles.py (PORTAGE.md). SQUELETTE : les corps sont des `todo!()`. Une signature ne se change pas sans
//! le signaler. Le hasard des familles est le leur (`_rng` : `Random::new_str`), sauf `appliquer` (g.rng).
#![allow(unused_imports, unused_variables)] // squelette : à retirer quand les corps sont portés

use crate::diplomacy as D;
use crate::engine::Game;
use crate::events as EV;
use crate::py::{self, Random, Val};
use crate::rules as R;
use crate::{dict, list, py_const, tup};

/// Python : `_rng(g, code, quoi)`.
/// `random.Random(f"{g.seed}-{année}-{code}-{quoi}")` : `Random::new_str`.
// game/familles.py, lignes 13 à 15
pub fn _rng(g: &Game, code: &str, quoi: &str) -> Random {
    todo!()
}

/// Python : `_trait(rnd)`.
/// Une clé de R::MAISON_TRAITS() (`rnd.choice(list(…))`, dans l'ordre du dict).
// game/familles.py, lignes 18 à 19
pub fn _trait(rnd: &mut Random) -> String {
    todo!()
}

/// La maison d'un camp en début de partie, ou d'une ancienne sauvegarde au chargement.
/// Python : `nouvelle(g, code)`.
/// Rend le dict de la maison.
// game/familles.py, lignes 22 à 33
pub fn nouvelle(g: &Game, code: &str) -> Val {
    todo!()
}

/// Python : `titre(g)`.
// game/familles.py, lignes 36 à 38
pub fn titre(g: &Game) -> String {
    todo!()
}

/// Les maisons de a et b sont-elles unies par un mariage ?
/// Python : `lie(g, a, b)`.
// game/familles.py, lignes 41 à 43
pub fn lie(g: &Game, a: &str, b: &str) -> bool {
    todo!()
}

/// Qui la maison peut marier : le chef s'il est seul, sinon l'aîné des héritiers libres (None : personne).
/// Python : `epoux(g, code)`.
/// Rend la personne (le dict du chef ou d'un héritier : le même objet, que marier modifie), ou None.
// game/familles.py, lignes 46 à 54
pub fn epoux(g: &Game, code: &str) -> Val {
    todo!()
}

/// Raison pour laquelle a et b ne peuvent pas marier leurs maisons (None : ils le peuvent).
/// Python : `refus_mariage(g, a, b)`.
// game/familles.py, lignes 57 à 66
pub fn refus_mariage(g: &Game, a: &str, b: &str) -> Option<String> {
    todo!()
}

/// Mariage entre les maisons de a et b : chacun marie son chef seul ou son aîné libre à une fille de l'autre maison.
/// Python : `marier(g, a, b)`.
/// Piège : `p is m['chef']` est une identité (`Val::is`).
// game/familles.py, lignes 69 à 86
pub fn marier(g: &mut Game, a: &str, b: &str) {
    todo!()
}

/// a déclare la guerre à b (diplomacy.declare_war) : contre une maison alliée par mariage, son pays gronde.
/// Python : `guerre(g, a, b)`.
// game/familles.py, lignes 89 à 97
pub fn guerre(g: &mut Game, a: &str, b: &str) {
    todo!()
}

// ------------------------------------------------------------------ chaque année

/// En janvier (Game.monthly) : naissances, puis la mort du chef selon son âge.
/// Python : `annuel(g)`.
// game/familles.py, lignes 101 à 116
pub fn annuel(g: &mut Game) {
    todo!()
}

/// Le chef meurt : l'aîné des héritiers lui succède ; sans héritier, crise de succession.
/// Python : `mort(g, code, rnd)`.
/// rnd : le hasard de l'année du camp (_rng(g, code, 'vie')), passé par annuel.
// game/familles.py, lignes 119 à 138
pub fn mort(g: &mut Game, code: &str, rnd: &mut Random) {
    todo!()
}

/// Crise de succession : six mois de désordre, et un événement à choix (le cousin, le plus prudent, en dernier).
/// Python : `crise(g, code, chef, rnd)`.
/// chef : le dict du chef mort.
// game/familles.py, lignes 141 à 171
pub fn crise(g: &mut Game, code: &str, chef: &Val, rnd: &mut Random) {
    todo!()
}

/// Les effets d'un choix de crise de succession (events.apply) : le nouveau chef, la vassalité, le refus.
/// Python : `appliquer(g, code, fx)`.
// game/familles.py, lignes 174 à 191
pub fn appliquer(g: &mut Game, code: &str, fx: &Val) {
    todo!()
}

/// Les effets propres aux crises de succession, en clair (events.describe).
/// Python : `decrire(g, fx)`.
/// Rend une liste de textes (events.describe l'ajoute à la sienne).
// game/familles.py, lignes 194 à 203
pub fn decrire(g: &Game, fx: &Val) -> Val {
    todo!()
}

/// La maison pour la carte du camp (Diplomatie).
/// Python : `vue(g, code)`.
/// Rend un dict, ou None.
// game/familles.py, lignes 206 à 215
pub fn vue(g: &Game, code: &str) -> Val {
    todo!()
}
