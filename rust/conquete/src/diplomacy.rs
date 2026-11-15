//! Diplomatie et commerce entre départements.
//!
//! Porte game/diplomacy.py (PORTAGE.md). SQUELETTE : les constantes sont portées ; les corps sont des `todo!()`. Une
//! signature ne se change pas sans le signaler. La partie s'appelle `game` ici, comme dans le Python.
#![allow(unused_imports, unused_variables)] // squelette : à retirer quand les corps sont portés

use crate::army_actions as AA;
use crate::engine::{Game, Paire};
use crate::familles as FM;
use crate::py::{self, Val};
use crate::rules as R;
use crate::turns as TT;
use crate::{dict, list, py_const, pyset, tup};
use indexmap::IndexSet;

py_const!(BASE_VALUE, {
    let d = dict! {"livres" => 1.0};
    d.update(&R::MARKET_BASE());
    d
}); // `dict(livres=1.0, **R.MARKET_BASE)`

/// Python : `lost_nodes(game, code)`.
// game/diplomacy.py, lignes 12 à 14
pub fn lost_nodes(game: &Game, code: &str) -> i64 {
    todo!()
}

/// Python : `borders(game, a, b)`.
/// Le cache est `game._frontieres` (quart de journée, set des paires (a, b) de propriétaires voisins) : chercher
/// avec `Paire(a, b)`.
// game/diplomacy.py, lignes 17 à 28
pub fn borders(game: &mut Game, a: &str, b: &str) -> bool {
    todo!()
}

/// Python : `value_of(game, code, res, qty)`.
// game/diplomacy.py, lignes 31 à 36
pub fn value_of(game: &Game, code: &str, res: &str, qty: f64) -> f64 {
    todo!()
}

// ------------------------------------------------------------------ effets

/// Raison pour laquelle a ne peut pas déclarer la guerre à b (None : il le peut).
/// Python : `war_refusal(game, a, b)`.
// game/diplomacy.py, lignes 40 à 51
pub fn war_refusal(game: &Game, a: &str, b: &str) -> Option<String> {
    todo!()
}

/// Python : `declare_war(game, a, b, quiet=False)`.
/// quiet : False par défaut (ne sert pas).
// game/diplomacy.py, lignes 54 à 94
pub fn declare_war(game: &mut Game, a: &str, b: &str, quiet: bool) -> (bool, String) {
    todo!()
}

/// Python : `make_peace(game, a, b)`.
// game/diplomacy.py, lignes 97 à 126
pub fn make_peace(game: &mut Game, a: &str, b: &str) {
    todo!()
}

/// Prisonniers originaires de b détenus par a.
/// Python : `held(game, a, b)`.
// game/diplomacy.py, lignes 129 à 131
pub fn held(game: &Game, a: &str, b: &str) -> i64 {
    todo!()
}

/// Généraux de b captifs de a (les plus gradés d'abord).
/// Python : `captifs(game, a, b)`.
/// Rend une liste de captifs dict(gen, de) (les mêmes objets que f['captifs'] : rendre_general les y retire).
// game/diplomacy.py, lignes 134 à 136
pub fn captifs(game: &Game, a: &str, b: &str) -> Val {
    todo!()
}

/// Python : `a_echanger(game, a, b)`.
// game/diplomacy.py, lignes 139 à 140
pub fn a_echanger(game: &Game, a: &str, b: &str) -> bool {
    todo!()
}

/// Le captif c de a rentre dans la réserve de son camp.
/// Python : `rendre_general(game, a, c)`.
// game/diplomacy.py, lignes 143 à 152
pub fn rendre_general(game: &mut Game, a: &str, c: &Val) {
    todo!()
}

/// Cartel d'échange : chacun rend les prisonniers de l'autre, homme pour homme, puis le surplus se rachète.
/// Python : `exchange_prisoners(game, a, b)`.
// game/diplomacy.py, lignes 155 à 201
pub fn exchange_prisoners(game: &mut Game, a: &str, b: &str) -> String {
    todo!()
}

/// Python : `make_alliance(game, a, b)`.
// game/diplomacy.py, lignes 204 à 208
pub fn make_alliance(game: &mut Game, a: &str, b: &str) {
    todo!()
}

/// Python : `make_vassal(game, v, over)`.
// game/diplomacy.py, lignes 211 à 230
pub fn make_vassal(game: &mut Game, v: &str, over: &str) {
    todo!()
}

// ------------------------------------------------------------------ évaluation par une IA

/// Python : `ai_evaluate(game, ai, frm, action, amount=0, give=None, get=None)`.
/// ai : le camp qui répond (un code, pas l'objet AI) ; amount : 0 par défaut ; give, get : None ou des
/// tuples (ressource, quantité). Piège : `amount / 12` est une division de flottants.
// game/diplomacy.py, lignes 234 à 309
pub fn ai_evaluate(game: &Game, ai: &str, frm: &str, action: &str, amount: i64, give: &Val, get: &Val) -> (bool, String) {
    todo!()
}

// ------------------------------------------------------------------ point d'entrée

/// Python : `act(game, frm, to, action, amount=0, give=None, get=None)`.
/// to, action, amount, give, get : tels que le navigateur les envoie (amount : 0 par défaut ; give, get : None
/// par défaut, ou des tuples / listes (ressource, quantité)). Rend (None, message) quand la proposition attend le joueur.
// game/diplomacy.py, lignes 313 à 386
pub fn act(game: &mut Game, frm: &str, to: &Val, action: &Val, amount: &Val, give: &Val, get: &Val) -> (Option<bool>, String) {
    todo!()
}

/// Python : `apply(game, frm, to, action, amount=0, give=None, get=None)`.
/// amount : 0 par défaut ; give, get : None par défaut.
// game/diplomacy.py, lignes 389 à 419
pub fn apply(game: &mut Game, frm: &str, to: &str, action: &str, amount: i64, give: &Val, get: &Val) {
    todo!()
}

/// Python : `answer(game, pid, accept)`.
/// pid : l'identifiant de la proposition, tel que le navigateur l'envoie.
// game/diplomacy.py, lignes 422 à 456
pub fn answer(game: &mut Game, pid: &Val, accept: bool) -> (bool, String) {
    todo!()
}
