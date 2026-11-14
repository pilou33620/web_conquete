//! Conquête : le moteur du jeu (campagne, batailles) et son serveur — le portage de game/ et de server.py.
//! Les modules gardent le nom, les fonctions et l'ordre des fichiers Python qu'ils remplacent (PORTAGE.md).
#![allow(non_snake_case, non_upper_case_globals)] // les noms sont ceux du Python (R::UNITS(), geo.KX…)
#![allow(clippy::too_many_arguments, clippy::type_complexity, clippy::neg_cmp_op_on_partial_ord, clippy::len_without_is_empty)]

pub mod py;
