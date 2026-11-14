//! Ce que Python faisait tout seul et que le jeu laisse voir : ses valeurs (dict partagés, 1 contre 1.0), son
//! hasard, ses arrondis, son JSON, ses tas. Le moteur porté s'écrit avec ces pièces pour rendre, à la même
//! graine, la même carte, la même bataille et le même tour que le moteur Python. Règles du portage : PORTAGE.md.

mod hasard;
pub mod heapq;
pub mod json;
mod nombres;
mod texte;
mod val;

pub use hasard::*;
pub use nombres::*;
pub use texte::*;
pub use val::*;

#[cfg(test)]
mod essais;

/// Une constante de module de Python qui n'est pas un simple nombre ou un texte (dict, liste, tuple, set) :
/// `py_const!(UNITS, dict!{…});` puis `UNITS()` rend la valeur, construite une fois par fil (c'est le même
/// objet à chaque appel, comme la constante de Python).
#[macro_export]
macro_rules! py_const {
    ($(#[$m:meta])* $nom:ident, $init:expr) => {
        $(#[$m])*
        #[allow(non_snake_case)]
        pub fn $nom() -> $crate::py::Val {
            thread_local! { static V: $crate::py::Val = $init; }
            V.with(|v| v.clone())
        }
    };
}
