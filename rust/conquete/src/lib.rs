//! Conquête : le moteur du jeu (campagne, batailles) et son serveur — le portage de game/ et de server.py.
//! Les modules gardent le nom, les fonctions et l'ordre des fichiers Python qu'ils remplacent (PORTAGE.md).
#![allow(non_snake_case, non_upper_case_globals)] // les noms sont ceux du Python (R::UNITS(), geo.KX…)
#![allow(clippy::too_many_arguments, clippy::type_complexity, clippy::neg_cmp_op_on_partial_ord, clippy::len_without_is_empty)]

pub mod py;

pub mod ai;
pub mod army_actions;
pub mod battle_log;
pub mod cities;
pub mod crue;
pub mod diplomacy;
pub mod engine;
pub mod events;
pub mod familles;
pub mod fiche;
pub mod geo;
pub mod places;
pub mod rails;
pub mod rules;
pub mod serveur;

pub mod turns;
pub mod views;
pub mod waterways;
