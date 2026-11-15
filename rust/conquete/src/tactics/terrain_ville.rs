//! À porter : game/tactics/terrain_ville.py (PORTAGE.md).
//!
//! En attendant, seulement ce que terrain.rs appelle (signatures posées par le portage de terrain.py, corps à
//! écrire) : terrain.generate y passe dès qu'une place est sur le champ (spec['place'], ou un lieu à moins de 1,3 km).
#![allow(unused_variables)]

use crate::py::{Random, Val};
use crate::geo::GeoMap;
use crate::tactics::terrain::{BattleMap, Pt};
use std::collections::{BTreeSet, HashMap};

/// `Lieu` : le plan d'une place posé sur la carte. Ici, les seuls attributs que terrain.rs lit (le portage ajoutera
/// les autres : V, O, nid, Mk, ilots, enceinte, cours, r_mur…).
pub struct Lieu {
    /// échelle de la carte
    pub k: f64,
    /// centre de la place, en mètres
    pub pos: Pt,
    pub r_eau: f64,
    pub r_calme: f64,
    pub r_ville: f64,
    /// les noms des rivières du plan (un set de textes)
    pub rivieres: Val,
}

/// `preparer(geo, spec, pl, cx, cy)`.
pub fn preparer(geo: &GeoMap, spec: &Val, pl: &Val, cx: f64, cy: f64) -> Lieu {
    todo!("à porter : game/tactics/terrain_ville.py")
}

/// `routes(L, geo, nid)` : {indice de l'arête : points}.
pub fn routes(L: &Lieu, geo: &GeoMap, nid: &Val) -> HashMap<usize, Vec<Pt>> {
    todo!("à porter : game/tactics/terrain_ville.py")
}

/// `ecarter(pts, C, Rp)` (rend les mêmes points, à l'identique, quand le tracé passe assez loin).
pub fn ecarter(pts: &[Pt], C: Pt, Rp: f64) -> Vec<Pt> {
    todo!("à porter : game/tactics/terrain_ville.py")
}

/// `ville(m, pl, L, rng, spec, t, road_cells)` (t est m.t).
pub fn ville(m: &mut BattleMap, pl: &Val, L: &Lieu, rng: &mut Random, spec: &Val, road_cells: &BTreeSet<usize>) {
    todo!("à porter : game/tactics/terrain_ville.py")
}
