//! FIGÉ : le générateur de cartes d'avant SPEC-CARTES.md (version 1), gardé tel quel pour les batailles en cours des
//! anciennes sauvegardes. Une sauvegarde n'enregistre que la description d'une bataille (sa graine) : sa carte est
//! refabriquée au chargement, et doit être la même qu'au début de la bataille. Ne pas modifier ce fichier ; le générateur
//! d'aujourd'hui est terrain.rs (version 2), qui renvoie ici les batailles sans « carte » dans leur description.
//! Le portage de game/tactics/terrain_v1.py.
//!
//! Carte d'une bataille tactique : 3 000 × 2 000 m, grille de 20 m (150 × 100 cases).
//!
//! Construite à partir des cases de campagne autour de la bataille (terrain, rivières, routes, places proches),
//! puis enrichie de bruit procédural déterministe (graine) : bosquets, haies, champs en lanières, vignes en rangs,
//! fermes, chemins, ruisseaux, mares, relief. Une place forte ou une ville occupe le centre quand la bataille s'y livre,
//! avec ses rues, son enceinte, ses portes, la brèche du siège et ses barricades.
//!
//! Coordonnées en mètres : x vers l'est (0 à 3 000), y vers le sud (0 à 2 000), comme la carte de campagne.
//! Case (i, j) : centre en ((i + 0,5) × 20, (j + 0,5) × 20), indice c = j × 150 + i.
//!
//! En Rust : ce que terrain_v1.py tenait en copie conforme de terrain.py (constantes, bruit, tracés, ponts, barricades,
//! moulin) est repris de terrain.rs sous le même nom (`pub use`) au lieu d'être recopié ; les références
//! (tests/references/terrain.json) tiennent les cartes de la version 1 : y toucher dans terrain.rs se verrait. Seul ce
//! qui diffère est écrit ici. La carte est le même struct (`BattleMap`, marqué `v1`), son to_client est celui d'ici.

use crate::geo::{GeoMap, T_COLLINES, T_DUNES, T_EAU as G_EAU, T_FORET, T_HAUTE, T_LANDE, T_MARAIS, T_MONTAGNE, T_OCEAN, T_PLAINE, T_VIGNE};
use crate::py::{self, Random, Val};
use crate::tactics::terrain::{b64, cherche, dans, noms, pmax, pmin, pts_de, pts_ronds, pts_val, pts_val_traverse, r2_pts, Pt};
use crate::{dict, list, tup};
use std::collections::BTreeSet;
use std::f64::consts::PI;

// (identiques dans terrain.py et terrain_v1.py)
pub use crate::tactics::terrain::{
    _add_bridge, _barricades, _clip_poly, _densify, _force_bridge, _hash, _hedge_lines, _line_cells, _mill, _poly_cells, _poly_near_field, _random_crossing, _redoubts,
    _region_name, _seg_dist, _stamp, bfs, blur, cell_of, center_of, noise, AMP, BOCAGE, CELL, COLS, CROPS, DEPT_CROPS, FARMS, FEAT_NAMES, FENCE, F_CLOTURE, F_HAIE, F_MURET,
    F_NONE, H, N, RIVER_W, ROWS, STONY, W, WOOD,
};
// Types de case (ordre du contrat) ; BARRICADE est un ajout (ouvrages de fortune : muret franchissable lentement)
pub use crate::tactics::terrain::{
    T_BARRICADE, T_BATI, T_BOIS, T_BRECHE, T_CHAMP, T_CHEMIN, T_EAU, T_FORET_T, T_GUE, T_LANDE_T, T_MARAIS_T, T_MUR, T_PORTE, T_PRE, T_ROCHE, T_ROUTE, T_SABLE, T_VIGNE_T,
};
pub const TYPE_NAMES: [&str; 18] =
    ["PRE", "CHAMP", "VIGNE", "LANDE", "BOIS", "FORET", "MARAIS", "EAU", "GUE", "ROUTE", "CHEMIN", "BATI", "MUR", "BRECHE", "PORTE", "SABLE", "ROCHE", "BARRICADE"];
pub const TYPE_LABEL: [&str; 18] = [
    "Prairie", "Champs", "Vignes", "Lande", "Bois", "Forêt", "Marais", "Eau", "Gué", "Route", "Chemin", "Maisons", "Rempart", "Brèche", "Porte", "Sable", "Rochers",
    "Barricade",
];

const NU: usize = N as usize;
const CU: usize = COLS as usize;
const RU: usize = ROWS as usize;
const WF: f64 = W as f64;
const HF: f64 = H as f64;
const CELLF: f64 = CELL as f64;

/// Carte générée : t (types), h (altitudes), et les objets dessinés par le client. Le même struct que celui de
/// terrain.rs, marqué `v1` : town, bastions, demi_lunes, batis, kinds, plan et garder, que la classe de terrain_v1.py
/// n'a pas, restent vides.
pub type BattleMap = crate::tactics::terrain::BattleMap;

/// `BattleMap.to_client(spec)` de terrain_v1.py (appelé par `BattleMap::to_client` pour une carte `v1`).
pub fn to_client(m: &BattleMap, spec: &Val) -> Val {
    dict! {
        "W" => W, "H" => H, "cell" => CELL, "cols" => COLS, "rows" => ROWS,
        "t" => b64(&m.t), "h" => b64(&m.h),
        "roads" => Val::list(m.roads.iter().map(|r| r2_pts(&r.at("pts"))).collect()),
        "road_kinds" => Val::list(m.roads.iter().map(|r| r.at("kind")).collect()),
        "rivers" => Val::list(m.rivers.iter().map(|r| dict!{"w" => r.at("w"), "pts" => r2_pts(&r.at("pts")), "kind" => r.at("kind"), "name" => r.get("name")}).collect()),
        "buildings" => &m.buildings, "walls" => &m.walls, "place" => &m.place,
        "hedges" => Val::list(m.hedges.iter().map(|hd| r2_pts(&hd)).collect()), "bridges" => &m.bridges,
        "f" => b64(&m.f), "feature_names" => noms(&FEAT_NAMES),
        "fences" => Val::list(m.fences.iter().map(|f| dict!{"kind" => f.at(0), "pts" => r2_pts(&f.at(1))}).collect()),
        "heart" => if m.heart.truthy() { m.heart.to_list() } else { Val::None },
        "seed" => spec.at("seed"), "season" => spec.at("season"), "weather" => spec.at("weather"), "year" => spec.get("year"),
        "marks" => spec.get_or("marks", list![list![], list![]]),
        "camp" => dict!{"x" => spec.at("cx"), "y" => spec.at("cy")}, "region" => &m.region,
        "types" => noms(&TYPE_NAMES), "labels" => noms(&TYPE_LABEL),
    }
}

// ====================================================================== tracés
/// Méandres : décalage perpendiculaire lisse le long d'un tracé densifié.
pub fn _meander(pts: Vec<Pt>, rng: &mut Random, amp: f64, wave: f64) -> Vec<Pt> {
    crate::tactics::terrain::_meander(pts, rng, amp, wave, None)
}

// ====================================================================== génération
/// Carte de la bataille décrite par spec (voir bridge.make_spec) ; déterministe pour une graine donnée.
pub fn generate(geo: &GeoMap, spec: &Val) -> BattleMap {
    let seed = py::int_v(&spec.at("seed")) & 0x7FFFFFFF;
    let mut rng = Random::new(seed);
    let mut m = BattleMap::new();
    m.v1 = true;
    let (cx, cy) = (spec.at("cx").f(), spec.at("cy").f());

    let to_m = |xk: f64, yk: f64| -> Pt { ((xk - cx) * 1000.0 + WF / 2.0, (yk - cy) * 1000.0 + HF / 2.0) };

    // ---------------------------------------------------------- terrain de campagne sous chaque case
    let (jx, jy) = (noise(&mut rng, 16.0, 2, 0.5), noise(&mut rng, 16.0, 2, 0.5));
    let (gt, gW, gH) = (&geo.terrain[..], geo.W, geo.H);
    let mut biome = vec![0u8; NU];
    for j in 0..RU {
        let yk0 = cy + ((j as f64 + 0.5) * CELLF - HF / 2.0) / 1000.0;
        let base = j * CU;
        for i in 0..CU {
            let c = base + i;
            let X = cx + ((i as f64 + 0.5) * CELLF - WF / 2.0) / 1000.0 + (jx[c] - 0.5) * 0.9;
            let Y = yk0 + (jy[c] - 0.5) * 0.9;
            let (ii, jj) = (py::int(X), py::int(Y));
            biome[c] = if 0 <= ii && ii < gW && 0 <= jj && jj < gH { gt[(jj * gW + ii) as usize] } else { T_OCEAN as u8 };
        }
    }
    m.biome = Some(biome.clone());
    let mut hist: Vec<(u8, i64)> = vec![]; // (dans l'ordre de première rencontre, comme le dict de Python)
    for &b in &biome {
        match hist.iter_mut().find(|p| p.0 == b) {
            Some(p) => p.1 += 1,
            None => hist.push((b, 1)),
        }
    }
    let land: Vec<(u8, i64)> = hist.iter().copied().filter(|p| !dans(p.0, &[T_OCEAN, G_EAU])).collect();
    let main = py::max_by_key(land, |p| p.1).map_or(T_PLAINE, |p| p.0 as i64);
    let dept = geo.dept_at(cx, cy).unwrap_or_default().to_string();
    m.region = _region_name(geo, cx, cy, main, &dept);

    // ---------------------------------------------------------- relief
    let amp = blur(&biome.iter().map(|&b| cherche(&AMP, b as i64).unwrap_or(8) as f64).collect::<Vec<f64>>(), 7);
    let nh = noise(&mut rng, 34.0, 3, 0.45);
    let mut hf = vec![0.0; NU];
    for c in 0..NU {
        let a = amp[c];
        let mut v = nh[c];
        if a > 30.0 {
            // montagne : crêtes marquées (passage progressif depuis les collines)
            let k = pmin(1.0, (a - 30.0) / 30.0);
            v = v * (1.0 - k) + (1.0 - (2.0 * v - 1.0).abs() * 0.8) * k;
        }
        hf[c] = 3.0 + a * v;
    }

    // ---------------------------------------------------------- eau : rivières de campagne, lacs, océan
    for c in 0..NU {
        if dans(biome[c], &[T_OCEAN, G_EAU]) {
            m.t[c] = T_EAU as u8;
        }
    }
    for r in geo.src.at("rivers").iter() {
        let pts: Vec<Pt> = r
            .at("pts")
            .iter()
            .map(|p| {
                let (lon, lat) = p.xy();
                let (x, y) = geo.xy(lat, lon);
                to_m(x, y)
            })
            .collect();
        // segments qui approchent du champ de bataille
        let near: Vec<usize> = (0..pts.len()).filter(|&q| -2500.0 <= pts[q].0 && pts[q].0 <= WF + 2500.0 && -2500.0 <= pts[q].1 && pts[q].1 <= HF + 2500.0).collect();
        if near.is_empty() {
            continue;
        }
        let (k0, k1) = (near[0].saturating_sub(1), (near[near.len() - 1] + 2).min(pts.len()));
        let sub = &pts[k0..k1];
        if sub.len() < 2 || !_poly_near_field(sub) {
            continue;
        }
        let (name, rank) = (r.at("name"), r.at("rank"));
        let w = cherche(&RIVER_W, rank.i()).unwrap_or(22) as f64 * (if name == "Adour" || name == "Lot" || name == "Isle" { 0.75 } else { 1.0 });
        let dense = _densify(sub, 40.0);
        let dense = _meander(dense, &mut rng, 35.0 + w * 0.4, 520.0 + w * 2.0);
        for part in _clip_poly(&dense, 200.0) {
            m.rivers.push(dict! {"w" => py::round(w), "pts" => pts_val(&part), "kind" => if rank.i() > 1 { "riviere" } else { "fleuve" }, "name" => &name, "rank" => &rank});
            let t = &mut m.t;
            _stamp(&part, w / 2.0, &mut |c| t[c] = T_EAU as u8, 8.0);
        }
    }
    // ruisseaux procéduraux (gués sur toute leur longueur)
    if main != T_DUNES && rng.random() < (if m.rivers.is_empty() { 0.75 } else { 0.35 }) {
        for _ in 0..(if rng.random() < 0.7 { 1 } else { 2 }) {
            let pts = _random_crossing(&mut rng);
            let pts = _meander(_densify(&pts, 40.0), &mut rng, 45.0, 300.0);
            m.rivers.push(dict! {"w" => 8, "pts" => pts_val_traverse(&pts), "kind" => "ruisseau", "name" => Val::None, "rank" => 4});
            for c in _poly_cells(&pts) {
                if m.t[c] as i64 != T_EAU {
                    m.t[c] = T_GUE as u8;
                }
            }
        }
    }
    // vallées : le relief se creuse vers l'eau
    let wsrc: Vec<usize> = (0..NU).filter(|&c| dans(m.t[c], &[T_EAU, T_GUE])).collect();
    let dwat = if !wsrc.is_empty() { bfs(&wsrc, 14, None) } else { vec![255u8; NU] };
    for c in 0..NU {
        let d = dwat[c];
        if d < 14 {
            hf[c] *= 0.18 + 0.82 * py::pow(d as f64 / 14.0, 1.4);
        }
    }
    // gués des rivières (rang 2 et 3) : 1 à 3 passages peu profonds
    for r in m.rivers.iter() {
        if r.at("kind") != "riviere" {
            continue;
        }
        let nf = 1 + py::int(rng.random() * (if r.at("rank") == 3 { 3.0 } else { 2.0 }));
        let dense = _densify(&pts_de(&r.at("pts")), 20.0);
        let inside: Vec<Pt> = dense.into_iter().filter(|p| 60.0 < p.0 && p.0 < WF - 60.0 && 60.0 < p.1 && p.1 < HF - 60.0).collect();
        for _ in 0..nf {
            if inside.is_empty() {
                break;
            }
            let p = inside[rng.randrange(inside.len() as i64) as usize];
            let t = &mut m.t;
            _stamp(
                &[p, p],
                r.at("w").f() / 2.0 + 12.0,
                &mut |c| {
                    if t[c] as i64 == T_EAU {
                        t[c] = T_GUE as u8
                    }
                },
                8.0,
            );
            r.setdefault("fords", list![]).push(list![py::round(p.0), py::round(p.1)]);
        }
    }

    // ---------------------------------------------------------- couvert : bois, marais, parcelles
    let nw = noise(&mut rng, 13.0, 3, 0.55);
    let year = spec.get_or("year", 1790).i();
    let nwet = noise(&mut rng, 9.0, 2, 0.5);
    let crops_extra: &[(i64, i64)] = cherche(&DEPT_CROPS, dept.as_str()).unwrap_or(&[]);
    let BS = 8 + rng.randrange(4);
    let shifts: Vec<i64> = (0..ROWS / BS + 2).map(|_| rng.randrange(BS)).collect();
    let mut bocage = cherche(&BOCAGE, dept.as_str()).unwrap_or(0.1) * (if main == T_COLLINES || main == T_PLAINE { 1.4 } else { 0.6 });
    if main == T_LANDE {
        bocage *= 0.3;
    }
    let fence_p = cherche(&FENCE, main).unwrap_or(0.2);
    let wall_kind = if STONY.contains(&dept.as_str()) || [T_MONTAGNE, T_HAUTE, T_VIGNE].contains(&main) { F_MURET } else { F_CLOTURE };
    for j in 0..ROWS {
        let bj = j / BS;
        let sh = shifts[bj as usize];
        let base = (j * COLS) as usize;
        for i in 0..COLS {
            let c = base + i as usize;
            if dans(m.t[c], &[T_EAU, T_GUE]) {
                continue;
            }
            let b = biome[c] as i64;
            let mut wthr = cherche(&WOOD, b).unwrap_or(0.7);
            if b == T_LANDE && year < 1857 {
                wthr += 0.12; // avant la loi de 1857, la lande rase domine : les pins sont encore rares
            }
            if dwat[c] <= 2 && b != T_MARAIS {
                wthr += 0.05;
            }
            let v = nw[c];
            if v > wthr {
                let dense = (b == T_FORET || b == T_MONTAGNE) && v > wthr + 0.18;
                m.t[c] = (if dense { T_FORET_T } else { T_BOIS }) as u8;
                continue;
            }
            if b == T_MARAIS && nwet[c] > 0.45 || (b == T_LANDE && nwet[c] > 0.74) || (dwat[c] <= 3 && nwet[c] > 0.66 && (b == T_PLAINE || b == T_LANDE)) {
                m.t[c] = T_MARAIS_T as u8;
                continue;
            }
            if (b == T_MONTAGNE || b == T_HAUTE) && hf[c] > 0.86 * amp[c] + 3.0 {
                m.t[c] = T_ROCHE as u8;
                continue;
            }
            // parcelle : bloc décalé d'une rangée à l'autre, découpé en lanières
            let ii = i + sh;
            let bi = ii / BS;
            let horiz = _hash(bi, bj, seed) < 0.5;
            let off = if horiz { j % BS } else { ii % BS };
            let sw = 2 + py::int(_hash(bi, bj + 999, seed) * 3.0);
            let si = off / sw;
            let crops = cherche(&CROPS, b).unwrap_or_else(|| cherche(&CROPS, T_PLAINE).unwrap());
            let tot: i64 = crops.iter().chain(crops_extra).map(|p| p.1).sum();
            let mut x = _hash(bi * 7 + si, bj * 13 + 5, seed) * tot as f64;
            let mut ty = 0;
            for &(ty_, w) in crops.iter().chain(crops_extra) {
                ty = ty_;
                x -= w as f64;
                if x <= 0.0 {
                    break;
                }
            }
            m.t[c] = ty as u8;
            // haies au bord des blocs (bocage)
            if [T_CHAMP, T_PRE, T_VIGNE_T, T_LANDE_T].contains(&ty) && ((ii % BS) == 0 || (j % BS) == 0) && _hash(i, j, seed + 7) > 0.12 {
                // (des trouées, des barrières ouvertes)
                let hv = _hash(bi * 3 + (ii % BS == 0) as i64, bj * 5 + 11, seed);
                if hv < bocage && ty != T_VIGNE_T {
                    m.f[c] = F_HAIE as u8;
                } else if hv < bocage + fence_p {
                    m.f[c] = (if ty == T_VIGNE_T || _hash(bi, bj, seed + 3) < 0.7 {
                        wall_kind
                    } else if wall_kind == F_MURET {
                        F_CLOTURE
                    } else {
                        F_MURET
                    }) as u8;
                }
            }
        }
    }

    // mares
    if [T_PLAINE, T_LANDE, T_MARAIS, T_COLLINES].contains(&main) {
        for _ in 0..rng.randrange(4) {
            let c = rng.randrange(N) as usize;
            if dans(m.t[c], &[T_PRE, T_LANDE_T, T_CHAMP, T_MARAIS_T]) {
                m.t[c] = T_EAU as u8;
            }
        }
    }

    // ---------------------------------------------------------- routes de campagne (à moins de 2 km)
    let mut road_cells: BTreeSet<usize> = BTreeSet::new();
    let nodes = geo.nodes.clone();
    for e in geo.edges.iter() {
        if e.get("kind") == "water" || e.get("ferry").truthy() {
            continue;
        }
        let (A, B) = (nodes.at(&e.at("a")), nodes.at(&e.at("b")));
        if _seg_dist(cx, cy, A.at("x").f(), A.at("y").f(), B.at("x").f(), B.at("y").f()) > 2.0 {
            continue;
        }
        let (pa, pb) = (to_m(A.at("x").f(), A.at("y").f()), to_m(B.at("x").f(), B.at("y").f()));
        let dense = _densify(&[pa, pb], 50.0);
        let dense = _meander(dense, &mut rng, 18.0, 700.0);
        for part in _clip_poly(&dense, 100.0) {
            let kind = if e.get("royal").truthy() { "royale" } else { "route" };
            m.roads.push(dict! {"pts" => pts_val(&part), "kind" => kind});
            road_cells.extend(_poly_cells(&part));
        }
    }
    if m.roads.is_empty() {
        let pts = _meander(_densify(&_random_crossing(&mut rng), 50.0), &mut rng, 40.0, 500.0);
        m.roads.push(dict! {"pts" => pts_val_traverse(&pts), "kind" => "chemin"});
    }
    for r in m.roads.iter() {
        let cells = _poly_cells(&pts_de(&r.at("pts")));
        let sol = (if r.at("kind") != "chemin" { T_ROUTE } else { T_CHEMIN }) as u8;
        let mut wet_run: Vec<usize> = vec![];
        for &c in &cells {
            if dans(m.t[c], &[T_EAU, T_GUE]) {
                wet_run.push(c);
            } else if !wet_run.is_empty() {
                _add_bridge(&mut m, &wet_run);
                wet_run.clear();
            }
            m.t[c] = sol;
        }
        for &c in &wet_run {
            m.t[c] = sol;
        }
    }
    // un grand fleuve sans pont ni gué sur la carte : un pont de bateaux, pour que la bataille ait un passage
    for r in m.rivers.iter() {
        if r.at("kind") == "fleuve" && !r.get("fords").truthy() && !m.bridges.iter().any(|b| b.get("river") == r.at("name")) {
            _force_bridge(&mut m, &r, &mut rng);
        }
    }

    // ---------------------------------------------------------- place, ville ou village
    let mut pl = spec.get("place");
    if pl.is_none() {
        // bataille rangée près d'un lieu : son village apparaît sur la carte
        let mut best: Option<(f64, Val)> = None;
        for gn in nodes.iter() {
            let d = py::hypot(gn.at("x").f() - cx, gn.at("y").f() - cy);
            if d < 1.3 && best.as_ref().is_none_or(|b| d < b.0) {
                best = Some((d, gn));
            }
        }
        if let Some((_, gn)) = best {
            pl = dict! {"nid" => gn.at("id"), "name" => gn.at("name"), "type" => gn.at("type"), "fort" => 0, "dmg" => 0.0, "bar" => 0.0, "pop" => gn.at("pop0"),
            "x" => gn.at("x"), "y" => gn.at("y"), "battle" => false};
        }
    }
    if pl.truthy() {
        _town(&mut m, &pl, to_m(pl.at("x").f(), pl.at("y").f()), &mut rng, spec, &road_cells);
    }

    // ---------------------------------------------------------- fermes, moulin, chemins
    _farms(&mut m, &mut rng, cherche(&FARMS, main).unwrap_or(3), &hf, main);
    _mill(&mut m, &mut rng, &hf, main);

    // ---------------------------------------------------------- altitude finale
    for c in 0..NU {
        let mut v = hf[c];
        if m.t[c] as i64 == T_EAU {
            v = pmin(v, 2.0);
        }
        m.h[c] = if v < 0.0 {
            0
        } else if v > 80.0 {
            80
        } else {
            py::int(v) as u8
        };
    }
    // éléments linéaires : pas sur les routes, l'eau ni le bâti ; les chemins creux du bocage sont bordés de haies
    for c in 0..NU {
        if dans(m.t[c], &[T_ROUTE, T_CHEMIN, T_EAU, T_GUE, T_BATI, T_MUR, T_BRECHE, T_PORTE, T_BARRICADE, T_BOIS, T_FORET_T]) {
            m.f[c] = F_NONE as u8;
        }
    }
    if bocage > 0.12 {
        for c in CU..NU - CU {
            if m.t[c] as i64 == T_CHEMIN && _hash(c as i64, 17, seed) < bocage {
                for nc in [c - 1, c + 1, c - CU, c + CU] {
                    if dans(m.t[nc], &[T_CHAMP, T_PRE, T_LANDE_T]) {
                        m.f[nc] = F_HAIE as u8;
                    }
                }
            }
        }
    }
    for k in [F_CLOTURE, F_HAIE, F_MURET] {
        let cells: Vec<usize> = (0..NU).filter(|&c| m.f[c] as i64 == k).collect();
        for (a, b) in _hedge_lines(&cells) {
            m.fences.push(tup![FEAT_NAMES[k as usize], list![a, b]]);
        }
    }
    m.hedges = Val::list(m.fences.iter().filter(|f| f.at(0) == "haie").map(|f| f.at(1)).collect());
    let compte = crate::tactics::terrain::_compte;
    m.stats = dict! {"main" => main, "dept" => &dept, "hist" => compte(&m.t, &TYPE_NAMES, 0, false), "feat" => compte(&m.f, &FEAT_NAMES, 1, true)};
    m
}

// ---------------------------------------------------------------------- place
pub fn _town(m: &mut BattleMap, pl: &Val, pos: Pt, rng: &mut Random, spec: &Val, road_cells: &BTreeSet<usize>) {
    let (px, py_) = pos;
    let typ = pl.at("type");
    let pop = pmax(200.0, pl.get("pop").or(600).f());
    let R = if typ == "village" {
        70.0 + pmin(70.0, pop / 25.0)
    } else if typ == "fort" {
        95.0 + pmin(60.0, pop / 60.0)
    } else if typ == "ville" {
        150.0 + pmin(170.0, pop.sqrt() * 1.6)
    } else {
        260.0 + pmin(220.0, pop.sqrt() * 1.1)
    };
    m.town_r = R;
    m.place = dict! {"name" => pl.at("name"), "x" => py::round(px), "y" => py::round(py_), "type" => &typ, "r" => py::round(R), "fort" => pl.get_or("fort", 0),
    "battle" => pl.get("battle").truthy()};
    let rn = noise(rng, 6.0, 2, 0.5);
    // rues : les routes qui y mènent, et quelques rues de plus en étoile
    let mut streets: BTreeSet<usize> = road_cells
        .iter()
        .copied()
        .filter(|&c| {
            let (x, y) = center_of(c);
            py::hypot(x - px, y - py_) < R + 40.0
        })
        .collect();
    let n_extra = if typ == "village" {
        2
    } else if typ == "ville" || typ == "fort" {
        4
    } else {
        6
    };
    let a0 = rng.random() * PI;
    for k in 0..n_extra {
        let a = a0 + k as f64 * PI * 2.0 / n_extra as f64 + rng.uniform(-0.25, 0.25);
        let pts = [(px, py_), (px + a.cos() * R * 0.95, py_ + a.sin() * R * 0.95)];
        streets.extend(_poly_cells(&pts));
    }
    if typ != "village" {
        // boulevard intérieur
        let ring: Vec<Pt> = (0..25)
            .map(|i| {
                let a = i as f64 * PI / 12.0;
                (px + a.cos() * R * 0.55, py_ + a.sin() * R * 0.55)
            })
            .collect();
        streets.extend(_poly_cells(&ring));
    }
    let rc = py::int(py::floordiv_f(R, CELLF)) + 2;
    let (ci, cj) = (py::int(py::floordiv_f(px, CELLF)), py::int(py::floordiv_f(py_, CELLF)));
    let mut bati: Vec<usize> = vec![];
    for dj in -rc..rc + 1 {
        for di in -rc..rc + 1 {
            let (i, j) = (ci + di, cj + dj);
            if !(0 <= i && i < COLS && 0 <= j && j < ROWS) {
                continue;
            }
            let c = (j * COLS + i) as usize;
            if m.t[c] as i64 == T_EAU {
                continue;
            }
            let (x, y) = center_of(c);
            let d = py::hypot(x - px, y - py_) / R;
            if d > 1.05 {
                continue;
            }
            if streets.contains(&c) {
                m.t[c] = T_ROUTE as u8;
                continue;
            }
            let dens = 1.0 - d * d * 0.7 + (rn[c] - 0.5) * 0.6;
            if dens > 0.45 || d < 0.35 {
                m.t[c] = T_BATI as u8;
                bati.push(c);
            } else if dans(m.t[c], &[T_BOIS, T_FORET_T, T_MARAIS_T, T_LANDE_T, T_ROCHE, T_SABLE]) {
                m.t[c] = T_PRE as u8; // jardins et vergers
            }
        }
    }
    // place publique et église au centre
    let hc = cell_of(px, py_);
    if hc >= 0 {
        for c in [hc, hc + 1, hc - 1, hc + COLS, hc - COLS] {
            if 0 <= c && c < N {
                m.t[c as usize] = T_ROUTE as u8;
            }
        }
        let chc = (if (hc % COLS) < COLS - 2 { hc + 2 } else { hc - 2 }) as usize;
        m.t[chc] = T_BATI as u8;
        let (x, y) = center_of(chc);
        m.buildings.push(dict! {"x" => py::round(x), "y" => py::round(y), "w" => if typ != "village" { 26 } else { 18 }, "h" => 12, "a" => 0, "kind" => "eglise"});
        m.heart = tup![py::round(x), py::round(y)];
    }
    // maisons : un bâtiment par case de bâti, tourné vers la rue la plus proche
    let stride = if bati.len() < 500 { 1 } else { 2 };
    for &c in bati.iter().step_by(stride) {
        if m.t[c] as i64 != T_BATI {
            continue;
        }
        let (x, y) = center_of(c);
        let a = if _hash(c as i64, 3, 77) < 0.5 { 0.0 } else { PI / 2.0 };
        m.buildings.push(dict! {"x" => py::round(x + rng.uniform(-3.0, 3.0)), "y" => py::round(y + rng.uniform(-3.0, 3.0)),
        "w" => py::round(rng.uniform(11.0, 17.0)), "h" => py::round(rng.uniform(8.0, 12.0)), "a" => py::round_n(a, 2), "kind" => "maison"});
    }
    let bataille = pl.get("battle").truthy();
    let fort = if bataille { pl.get_or("fort", 0).i() } else { pl.get_or("fort", 0).i().min(1) };
    let att_a = spec.get_or("att_angle", 0.0).f(); // direction d'où vient l'assaillant, vue de la place
    if fort >= 1 {
        let rues: BTreeSet<usize> = road_cells.union(&streets).copied().collect();
        _walls(m, pl, pos, R, fort, rng, &rues, att_a);
    }
    let bar = if bataille { pl.get_or("bar", 0.0).f() } else { 0.0 };
    if bar > 0.05 {
        if fort <= 0 {
            _barricades(m, pos, R, bar, rng, att_a);
        } else {
            _redoubts(m, pos, R, bar, rng, att_a);
        }
    }
}

pub fn _walls(m: &mut BattleMap, pl: &Val, pos: Pt, R: f64, fort: i64, rng: &mut Random, streets: &BTreeSet<usize>, att_a: f64) {
    let (px, py_) = pos;
    let Rw = R + 25.0;
    let thick = CELL * (if fort == 1 { 1 } else { 2 }) + 2;
    let thickf = thick as f64;
    let nb: i64 = if fort <= 2 {
        0
    } else if fort == 3 {
        4
    } else {
        6
    };
    let bdepth: f64 = if nb == 0 {
        0.0
    } else if fort == 3 {
        40.0
    } else {
        70.0
    };
    let b0 = rng.random() * 6.283;
    let wob: Vec<f64> = (0..12).map(|_| rng.uniform(-0.06, 0.06)).collect();

    let radius = |a: f64| -> f64 {
        let k = py::mod_f(a, 6.283) / 6.283 * 12.0;
        let ki = py::int(k);
        let i0 = (ki % 12) as usize;
        let f = k - ki as f64;
        let mut r = Rw * (1.0 + wob[i0] * (1.0 - f) + wob[(i0 + 1) % 12] * f);
        if nb != 0 {
            let ph = py::mod_f(a - b0, 6.283 / nb as f64) / (6.283 / nb as f64);
            r += bdepth * pmax(0.0, 1.0 - (ph - 0.5).abs() * 4.0); // pointe du bastion
        }
        r
    };

    let mut wall_cells: Vec<usize> = vec![];
    let rc = py::int(py::floordiv_f(Rw + bdepth + 40.0, CELLF)) + 1;
    let (ci, cj) = (py::int(py::floordiv_f(px, CELLF)), py::int(py::floordiv_f(py_, CELLF)));
    for dj in -rc..rc + 1 {
        for di in -rc..rc + 1 {
            let (i, j) = (ci + di, cj + dj);
            if !(0 <= i && i < COLS && 0 <= j && j < ROWS) {
                continue;
            }
            let c = (j * COLS + i) as usize;
            let (x, y) = center_of(c);
            let d = py::hypot(x - px, y - py_);
            let rr = radius((y - py_).atan2(x - px));
            if rr <= d && d < rr + thickf {
                if m.t[c] as i64 == T_EAU {
                    continue;
                }
                wall_cells.push(c);
            } else if rr + thickf <= d && d < rr + thickf + 140.0 && dans(m.t[c], &[T_BOIS, T_FORET_T, T_VIGNE_T]) {
                m.t[c] = T_PRE as u8; // glacis dégagé devant les remparts
            }
        }
    }
    let mut gates: Vec<usize> = vec![];
    for &c in &wall_cells {
        m.t[c] = (if streets.contains(&c) { T_PORTE } else { T_MUR }) as u8;
        if streets.contains(&c) {
            gates.push(c);
        }
    }
    if gates.is_empty() {
        // au moins une porte, sur la route la plus proche
        let best = py::min_by_key(wall_cells.iter().copied(), |&c| {
            let (x, y) = center_of(c);
            (py::mod_f((y - py_).atan2(x - px) - att_a + 3.1416, 6.283) - 3.1416).abs()
        });
        if let Some(best) = best {
            m.t[best] = T_PORTE as u8;
        }
    }
    let mut kind = if fort == 1 {
        "mur"
    } else if fort <= 3 && nb == 0 {
        "rempart"
    } else {
        "bastion"
    };
    if fort == 3 {
        kind = "bastion";
    }
    let pts: Vec<Pt> = (0..73)
        .map(|k| {
            let a = k as f64 * 6.283 / 72.0;
            (px + a.cos() * (radius(a) + thickf / 2.0), py_ + a.sin() * (radius(a) + thickf / 2.0))
        })
        .collect();
    let wall = dict! {"pts" => pts_ronds(&pts), "kind" => kind, "breach" => list![], "thick" => thick};
    // brèches du siège, du côté de l'assaillant
    let bataille = pl.get("battle").truthy();
    let mut dmg = if bataille { pl.get_or("dmg", 0.0).f() } else { 0.0 };
    let dyn_ = if bataille { pl.get_or("dyn", 0).i() } else { 0 }; // la dynamite de l'assaillant : une brèche de plus
    if dmg >= 0.12 || dyn_ != 0 {
        let nbr = (if dmg >= 0.12 { 1 + py::int(dmg * 2.4) } else { 0 }) + dyn_;
        dmg = pmax(dmg, 0.12);
        for k in 0..(3 + dyn_).min(nbr) {
            let a = att_a + (k as f64 - (nbr - 1) as f64 / 2.0) * 0.55 + rng.uniform(-0.15, 0.15);
            let r0 = radius(a) + thickf / 2.0;
            let (bx, by) = (px + a.cos() * r0, py_ + a.sin() * r0);
            let br = 16.0 + dmg * 34.0;
            for &c in &wall_cells {
                let (x, y) = center_of(c);
                if m.t[c] as i64 == T_MUR && py::hypot(x - bx, y - by) <= br + 10.0 {
                    m.t[c] = T_BRECHE as u8;
                }
            }
            wall.at("breach").push(list![py::round(bx), py::round(by), py::round(br)]);
        }
    }
    m.walls.push(wall);
}

// ---------------------------------------------------------------------- fermes et moulins
pub fn _farms(m: &mut BattleMap, rng: &mut Random, n: i64, _hf: &[f64], main: i64) {
    let mut placed: Vec<Pt> = vec![];
    let mut tries = 0;
    while (placed.len() as i64) < n && tries < n * 30 {
        tries += 1;
        let (i, j) = (rng.randrange2(4, COLS - 6), rng.randrange2(4, ROWS - 6));
        let c = j * COLS + i;
        if !dans(m.t[c as usize], &[T_CHAMP, T_PRE, T_VIGNE_T, T_LANDE_T]) {
            continue;
        }
        let (x, y) = center_of(c as usize);
        if m.place.truthy() && py::hypot(x - m.place.at("x").f(), y - m.place.at("y").f()) < m.town_r + 280.0 {
            continue;
        }
        if placed.iter().any(|&(a, b)| py::hypot(x - a, y - b) < 380.0) {
            continue;
        }
        let (fw, fh) = (2 + rng.randrange(2), 2);
        let ok = (-1..fh + 1).all(|dj| (-1..fw + 1).all(|di| !dans(m.t[(c + dj * COLS + di) as usize], &[T_EAU, T_ROUTE, T_GUE])));
        if !ok {
            continue;
        }
        for dj in -1..fh + 1 {
            for di in -1..fw + 1 {
                let cc = (c + dj * COLS + di) as usize;
                let inside = 0 <= di && di < fw && 0 <= dj && dj < fh;
                m.t[cc] = (if inside && py::mod_i(di + dj, 3) != 2 {
                    T_BATI
                } else if m.t[cc] as i64 != T_CHEMIN {
                    T_PRE
                } else {
                    T_CHEMIN
                }) as u8;
            }
        }
        placed.push((x, y));
        let a = if rng.random() < 0.5 { 0.0 } else { 1.5708 };
        let big = main == T_VIGNE && rng.random() < 0.4; // château viticole
        m.buildings.push(dict! {"x" => py::round(x + (CELL * (fw - 1)) as f64 / 2.0), "y" => py::round(y + (CELL * (fh - 1)) as f64 / 2.0),
        "w" => py::round(rng.uniform(22.0, 30.0) * (if big { 1.4 } else { 1.0 })), "h" => py::round(rng.uniform(10.0, 14.0)),
        "a" => py::round_n(a, 2), "kind" => "ferme"});
        m.buildings.push(dict! {"x" => py::round(x + (CELL * fw) as f64 - 6.0), "y" => py::round(y + 4.0), "w" => 12, "h" => 8, "a" => py::round_n(1.5708 - a, 2), "kind" => "ferme"});
        _path_to_road(m, rng, x, y);
    }
}

/// Chemin de la ferme à la route (ou au chemin) la plus proche.
pub fn _path_to_road(m: &mut BattleMap, rng: &mut Random, x: f64, y: f64) {
    let mut best: Option<(f64, Val)> = None;
    for r in m.roads.iter() {
        for p in r.at("pts").iter().step_by(2) {
            let d = py::pow(p.at(0).f() - x, 2.0) + py::pow(p.at(1).f() - y, 2.0);
            if best.as_ref().is_none_or(|b| d < b.0) {
                best = Some((d, p));
            }
        }
    }
    let Some((d, but)) = best else { return };
    if d > 810000.0 || d < 1600.0 {
        return;
    }
    let pts = _meander(_densify(&[(x, y + CELLF * 1.5), but.xy()], 40.0), rng, 20.0, 300.0);
    let cells = _poly_cells(&pts);
    for &c in &cells {
        if dans(m.t[c], &[T_EAU, T_MUR, T_PORTE, T_BRECHE, T_BARRICADE]) {
            return;
        }
    }
    for &c in &cells {
        if m.t[c] as i64 == T_GUE {
            continue;
        }
        if !dans(m.t[c], &[T_ROUTE, T_BATI]) {
            m.t[c] = T_CHEMIN as u8;
        }
    }
    // (le dernier point du chemin est le point même de la route, `tuple(best[1])` : il garde ses entiers s'il en a)
    let v = pts_val(&pts);
    v.set(-1, but.to_tuple());
    m.roads.push(dict! {"pts" => v, "kind" => "chemin"});
}
