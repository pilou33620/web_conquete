//! Porte game/tactics/battle.py, lignes 525 à 1097 : zones et bords ; terrain : aides ; unités : aides ; journal et effets.
//! Conventions : l'en-tête de battle/mod.rs.

use super::*;

/// `max(a, b)` de Python : a, sauf si b est plus grand (le type du gagnant est gardé : la zone part au client).
/// (Aide hors du socle.)
fn vmax(a: Val, b: Val) -> Val {
    if b > a { b } else { a }
}

/// `min(a, b)` de Python : a, sauf si b est plus petit. (Aide hors du socle.)
fn vmin(a: Val, b: Val) -> Val {
    if b < a { b } else { a }
}

/// La classe de marche d'une classe (passable, path_cost) : celle de COST, sinon 'cav', 'art' ou 'inf'.
/// (Aide hors du socle : l'expression que le Python répète dans les deux.)
fn mc_of(cls: &str) -> &str {
    if COST().has(cls) {
        cls
    } else if cls == "cavalerie" || cls == "general" {
        "cav"
    } else if cls == "artillerie" {
        "art"
    } else {
        "inf"
    }
}

impl TacticalBattle {
    // ================================================================== zones et bords
    /// Python (battle.py, l. 526-568) : `def _zones(self)`
    /// Pose self.edges, self.zones, self.ai_zones. `max('ONES', key=…)` : le premier gagne (`py::max_by_key`), la
    /// clé est un tuple (part de terre, e == e0). `getattr(self.map, 'plan', None)` → `self.map.plan`.
    pub fn _zones(&mut self) {
        let a = self.spec.get_or("att_angle", std::f64::consts::PI).f();
        let (ca, sa) = (a.cos(), a.sin());
        let mut e0 = if ca.abs() * H as f64 >= sa.abs() * W as f64 * 0.66 {
            if ca > 0.0 { "E" } else { "O" }
        } else if sa > 0.0 {
            "S"
        } else {
            "N"
        };
        // un bord noyé (estuaire, côte : la carte de campagne est grossière) : l'assaillant arrive par le plus sec
        if self._dry(&Self::_edge_band(e0, &Val::from(600))) < 0.4 {
            let e00 = e0;
            e0 = py::max_by_key(["O", "N", "E", "S"], |e| (self._dry(&Self::_edge_band(e, &Val::from(600))), *e == e00)).unwrap();
        }
        let opp = |e: &str| match e {
            "E" => "O",
            "O" => "E",
            "N" => "S",
            _ => "N",
        };
        self.edges = list![e0, opp(e0)];
        // chaque camp se déploie librement dans sa moitié de la carte, sauf une bande neutre de 2 × DEPLOY_GAP au
        // milieu ; devant une place, l'assaillant reste à DEPLOY_WALL de l'enceinte et le défenseur tient la place et
        // ses abords (DEPLOY_DEF au-delà de l'enceinte)
        // l'IA (et le placement de départ des troupes du joueur) garde des zones plus serrées, à bonne distance l'une
        // de l'autre (ai_zones, comprises dans les zones) : l'ennemi ne commence pas à 400 m de vos lignes
        let pl = self.map.place.clone();
        let (z, za) = (list![], list![]);
        if pl.truthy() && pl.getb("battle") {
            let (px, py_, r) = (pl.at("x"), pl.at("y"), pl.at("r"));
            let d = match e0 {
                "O" => px.clone(),
                "E" => W - &px,
                "N" => py_.clone(),
                _ => H - &py_,
            } - &r;
            // (une place sur son plan, carte de version 4, peut s'approcher du bord : la bande de l'assaillant reste
            // alors à 150 m de l'enceinte au moins, sur 200 m au moins)
            let b0 = if self.map.plan.truthy() { vmax(Val::from(200), vmin(Val::from(500), &d - 150)) } else { Val::from(500) };
            z.push(Self::_edge_band(e0, &vmax(b0.clone(), &d - DEPLOY_WALL)));
            za.push(Self::_edge_band(e0, &vmax(b0, vmin(Val::from(1400), &d - DEPLOY_WALL))));
            for (k, lst) in [(DEPLOY_DEF, &z), (AI_DEPLOY_DEF, &za)] {
                let r = &pl.at("r") + k;
                lst.push(list![
                    vmax(Val::from(0), &pl.at("x") - &r),
                    vmax(Val::from(0), &pl.at("y") - &r),
                    vmin(Val::from(W), &pl.at("x") + &r),
                    vmin(Val::from(H), &pl.at("y") + &r)
                ]);
            }
        } else {
            let span = if e0 == "O" || e0 == "E" { W } else { H };
            let half = span as f64 / 2.0 - DEPLOY_GAP;
            z.push(Self::_edge_band(e0, &Val::from(half)));
            z.push(Self::_edge_band(opp(e0), &Val::from(half)));
            za.push(Self::_edge_band(e0, &Val::from(AI_DEPLOY_ATT)));
            // le défenseur : le devant de sa zone, sur AI_DEPLOY_DEF_FRAC de sa profondeur
            let d1 = z.at(1);
            let back = half * (1.0 - AI_DEPLOY_DEF_FRAC);
            let si = |c: bool| if c { Val::from(back) } else { Val::from(0) };
            za.push(list![
                &d1.at(0) + &si(e0 == "E"),
                &d1.at(1) + &si(e0 == "S"),
                &d1.at(2) - &si(e0 == "O"),
                &d1.at(3) - &si(e0 == "N")
            ]);
        }
        self.zones = z;
        self.ai_zones = za;
    }

    /// Part de terre (sans eau) dans le rectangle box.
    ///
    /// Python (battle.py, l. 570-574) : `def _dry(self, box)`
    /// bx (`box` en Python, mot réservé en Rust) : liste [x0, y0, x1, y1].
    pub fn _dry(&self, bx: &Val) -> f64 {
        let fl = |v: Val| py::int(py::floordiv_f(v.f(), CELL as f64));
        let (j0, j1) = (fl(bx.at(1)), ROWS.min(fl(bx.at(3))));
        let (i0, i1) = (fl(bx.at(0)), COLS.min(fl(bx.at(2))));
        let mut n = 0i64;
        let mut sec = 0i64;
        for j in j0..j1 {
            for i in i0..i1 {
                n += 1;
                sec += (self.map.t[(j * COLS + i) as usize] as i64 != T_EAU) as i64;
            }
        }
        sec as f64 / 1.max(n) as f64
    }

    /// Python (battle.py, l. 576-584) : `def _edge_band(e, depth)`
    /// Méthode statique : `Self::_edge_band(e, &depth)`. e : 'O', 'E', 'N' ou 'S' ; depth : profondeur (m), en
    /// `Val` pour garder l'int ou le float du Python (la zone part au client). Rend la liste [x0, y0, x1, y1].
    pub fn _edge_band(e: &str, depth: &Val) -> Val {
        match e {
            "O" => list![0, 100, depth, H - 100],
            "E" => list![W - depth, 100, W, H - 100],
            "N" => list![150, 0, W - 150, depth],
            _ => list![150, H - depth, W - 150, H],
        }
    }

    /// Python (battle.py, l. 586-587) : `def zone(self, side)`
    /// Rend une liste NEUVE [x0, y0, x1, y1].
    pub fn zone(&self, side: i64) -> Val {
        self.zones.at(side).to_list()
    }

    /// Zone où l'IA déploie et d'où elle juge l'ennemi (plus serrée que celle du joueur).
    ///
    /// Python (battle.py, l. 589-591) : `def ai_zone(self, side)`
    /// Rend une liste NEUVE [x0, y0, x1, y1].
    pub fn ai_zone(&self, side: i64) -> Val {
        self.ai_zones.at(side).to_list()
    }

    /// Python (battle.py, l. 593-594) : `def edge(self, side)`
    /// Rend 'O', 'E', 'N' ou 'S'.
    pub fn edge(&self, side: i64) -> String {
        self.edges.at(side).string()
    }

    /// Python (battle.py, l. 596-597) : `def front_dir(self, side)`
    /// Angle (rad) vers l'ennemi depuis le bord du camp.
    pub fn front_dir(&self, side: i64) -> f64 {
        match self.edges.at(side).s() {
            "O" => 0.0,
            "E" => std::f64::consts::PI,
            "N" => std::f64::consts::PI / 2.0,
            "S" => -std::f64::consts::PI / 2.0,
            e => panic!("KeyError: {e:?}"),
        }
    }

    /// Python (battle.py, l. 599-607) : `def edge_point(self, side, x, y)`
    pub fn edge_point(&self, side: i64, x: f64, y: f64) -> (f64, f64) {
        match self.edges.at(side).s() {
            "O" => (-30.0, y),
            "E" => (W as f64 + 30.0, y),
            "N" => (x, -30.0),
            _ => (x, H as f64 + 30.0),
        }
    }

    /// Python (battle.py, l. 609-611) : `def off_map(self, side, x, y)`
    pub fn off_map(&self, side: i64, x: f64, y: f64) -> bool {
        let e = self.edges.at(side);
        (e == "O" && x < 15.0) || (e == "E" && x > (W - 15) as f64) || (e == "N" && y < 15.0) || (e == "S" && y > (H - 15) as f64)
    }

    /// Python (battle.py, l. 613-617) : `def objective(self)`
    /// Rend le tuple (x, y) du cœur de la place (`self.map.heart`, tel quel) ou None : `b.objective().xy()`.
    pub fn objective(&self) -> Val {
        let pl = &self.map.place;
        if pl.truthy() && pl.getb("battle") && self.map.heart.truthy() {
            return self.map.heart.to_tuple();
        }
        Val::None
    }

    /// Les cases bâties de la place (dans son rayon et un peu au-delà : les faubourgs), sans les fermes du champ.
    ///
    /// Python (battle.py, l. 619-626) : `def cases_ville(self)`
    /// Rend les numéros de case, croissants.
    pub fn cases_ville(&self) -> Vec<i64> {
        let pl = &self.map.place;
        if !pl.truthy() || !pl.getb("battle") {
            return vec![];
        }
        let (r2, px, py_) = (py::pow(pl.atf("r") * 1.25, 2.0), pl.atf("x"), pl.atf("y"));
        let cf = TR::CELL as f64;
        (0..N)
            .filter(|&c| {
                self.map.t[c as usize] as i64 == T_BATI
                    && py::pow(((c % COLS) as f64 + 0.5) * cf - px, 2.0) + py::pow(((c / COLS) as f64 + 0.5) * cf - py_, 2.0) <= r2
            })
            .collect()
    }

    /// Part de la place détruite : une ruine ou une maison en feu compte entière, une maison touchée pour un quart.
    ///
    /// Python (battle.py, l. 628-631) : `def degats_ville(self)`
    pub fn degats_ville(&self) -> f64 {
        let cs = self.cases_ville();
        if cs.is_empty() {
            return 0.0;
        }
        py::sum(cs.iter().map(|&c| [0.0, 0.25, 1.0, 1.0][self.bati[c as usize] as usize])) / cs.len() as f64
    }

    /// Python (battle.py, l. 633-635) : `def place_info(self)`
    /// Rend un dict NEUF {x, y, r, fort} ou None.
    pub fn place_info(&self) -> Val {
        let pl = &self.map.place;
        if pl.truthy() && pl.getb("battle") {
            dict! {"x" => pl.at("x"), "y" => pl.at("y"), "r" => pl.at("r"), "fort" => pl.get_or("fort", 0)}
        } else {
            Val::None
        }
    }

    // ================================================================== terrain : aides
    /// Python (battle.py, l. 638-649) : `def cell(x, y)`
    /// Méthode statique : `Self::cell(x, y)` (hors de battle : `TacticalBattle::cell(x, y)`). Numéro de la case
    /// du point (j * COLS + i), ramené dans la carte. `int(x // CELL)` → `py::floordiv_f` (x peut être négatif).
    pub fn cell(x: f64, y: f64) -> i64 {
        let cf = CELL as f64;
        let (mut i, mut j) = (py::int(py::floordiv_f(x, cf)), py::int(py::floordiv_f(y, cf)));
        if i < 0 {
            i = 0;
        } else if i >= COLS {
            i = COLS - 1;
        }
        if j < 0 {
            j = 0;
        } else if j >= ROWS {
            j = ROWS - 1;
        }
        j * COLS + i
    }

    /// Python (battle.py, l. 651-652) : `def terrain_at(self, x, y)`
    /// Rend le type T_* de la case.
    pub fn terrain_at(&self, x: f64, y: f64) -> i64 {
        self.map.t[Self::cell(x, y) as usize] as i64
    }

    /// Python (battle.py, l. 654-655) : `def is_wood(self, x, y)`
    pub fn is_wood(&self, x: f64, y: f64) -> bool {
        WOODS.contains(&(self.map.t[Self::cell(x, y) as usize] as i64))
    }

    /// Python (battle.py, l. 657-658) : `def height_at(self, x, y)`
    /// Altitude (m) : l'octet de `self.map.h`.
    pub fn height_at(&self, x: f64, y: f64) -> i64 {
        self.map.h[Self::cell(x, y) as usize] as i64
    }

    /// Python (battle.py, l. 660-663) : `def cover_at(self, x, y)`
    pub fn cover_at(&self, x: f64, y: f64) -> f64 {
        let c = Self::cell(x, y) as usize;
        let tc = self.map.t[c] as i64;
        let a = if tc == T_BATI { BATI_COVER[self.bati[c] as usize] } else { COVER[tc as usize] };
        let b = FCOVER[self.map.f[c] as usize];
        if b > a { b } else { a }
    }

    /// Cases dont le centre est à moins de r m de (x, y).
    ///
    /// Python (battle.py, l. 665-670) : `def cells_near(self, x, y, r)`
    /// Rend les numéros de case, ligne par ligne (j puis i croissants).
    pub fn cells_near(&self, x: f64, y: f64, r: f64) -> Vec<i64> {
        let cf = CELL as f64;
        let fl = |v: f64| py::int(py::floordiv_f(v, cf));
        let (i0, i1) = (0.max(fl(x - r)), (COLS - 1).min(fl(x + r)));
        let (j0, j1) = (0.max(fl(y - r)), (ROWS - 1).min(fl(y + r)));
        let mut out = vec![];
        for j in j0..=j1 {
            for i in i0..=i1 {
                if py::pow((i as f64 + 0.5) * cf - x, 2.0) + py::pow((j as f64 + 0.5) * cf - y, 2.0) <= r * r {
                    out.push(j * COLS + i);
                }
            }
        }
        out
    }

    /// Élément linéaire de la case : 0 aucun, 1 clôture, 2 haie, 3 muret (terrain.FEAT_NAMES).
    ///
    /// Python (battle.py, l. 672-674) : `def feature_at(self, x, y)`
    pub fn feature_at(&self, x: f64, y: f64) -> i64 {
        self.map.f[Self::cell(x, y) as usize] as i64
    }

    /// Coût de marche de chaque case pour cette classe et ce camp (None : infranchissable). Mis en cache.
    ///
    /// Python (battle.py, l. 676-706) : `def costs(self, mc, side)`
    /// mc : 'inf', 'light', 'cav' ou 'art' (move_class) ; side : 0 ou 1. Rend la table partagée (`Rc`) : une case
    /// par numéro, `None` infranchissable ; elle ne change plus une fois faite (`cost[c] or 1.5` →
    /// `cost[c].unwrap_or(1.5)` : un coût n'est jamais 0). `for c in self.barr_prev` : les clés du dict.
    pub fn costs(&mut self, mc: &str, side: i64) -> Couts {
        let key = (mc.to_string(), side);
        if let Some(arr) = self._cost_cache.get(&key) {
            return arr.clone();
        }
        let mut tab: Vec<Option<f64>> = COST().at(mc).iter().map(|v| if v.is_none() { None } else { Some(v.f()) }).collect();
        let mut mud = 1.0;
        if ["pluie", "orage", "tempete"].contains(&self.weather.as_str()) {
            mud = 1.3;
        } else if self.weather == "neige" {
            mud = 1.4;
        }
        let pl = &self.map.place;
        if side == 0 && pl.truthy() && pl.getb("battle") {
            tab[T_PORTE as usize] = None; // portes fermées à l'assaillant
            if (mc == "inf" || mc == "light") && !self.map.t.contains(&(T_BRECHE as u8)) {
                tab[T_MUR as usize] = Some(14.0); // pas de brèche : l'escalade, à l'échelle
            }
        }
        for k in OFFROAD {
            if let Some(v) = tab[k as usize] {
                tab[k as usize] = Some(v * mud);
            }
        }
        let (t, f) = (&self.map.t, &self.map.f);
        let fk = FCOST_K().atf(mc);
        let mut arr: Vec<Option<f64>> = (0..N as usize).map(|c| tab[t[c] as usize]).collect();
        for c in 0..N as usize {
            if f[c] != 0 {
                if let Some(v) = arr[c] {
                    arr[c] = Some(v + FCOST[f[c] as usize] * fk);
                }
            }
        }
        if mc == "cav" || mc == "art" {
            for c in self.barr_prev.keys() {
                // (barricades dressées pendant la bataille : ni chevaux, ni canons)
                arr[c.i() as usize] = None;
            }
        }
        let arr: Couts = Rc::new(arr);
        self._cost_cache.insert(key, arr.clone());
        arr
    }

    /// Prépare les tables de coût de marche des classes présentes (hors de la boucle tactique).
    ///
    /// Python (battle.py, l. 708-711) : `def warm(self)`
    pub fn warm(&mut self) {
        for u in self.units.iter() {
            self.costs(move_class(&u), u.ati("side"));
        }
    }

    /// Python (battle.py, l. 713-717) : `def passable(self, x, y, cls='inf', side=0)`
    /// cls : classe de marche ('inf', 'light', 'cav', 'art') ou classe d'unité ('cavalerie', 'general',
    /// 'artillerie', autre : 'inf') ; défauts : cls = 'inf', side = 0.
    pub fn passable(&mut self, x: f64, y: f64, cls: &str, side: i64) -> bool {
        if !(0.0 <= x && x < W as f64 && 0.0 <= y && y < H as f64) {
            return false;
        }
        let mc = mc_of(cls);
        self.costs(mc, side)[Self::cell(x, y) as usize].is_some()
    }

    /// Python (battle.py, l. 719-720) : `def _passable_u(self, u, x, y)`
    pub fn _passable_u(&mut self, u: &Val, x: f64, y: f64) -> bool {
        self.costs(move_class(u), u.ati("side"))[Self::cell(x, y) as usize].is_some()
    }

    /// Case franchissable la plus proche (hors_feu : et pas dans une maison en feu).
    ///
    /// Python (battle.py, l. 722-744) : `def nearest_passable(self, u_or_cls, side, x, y, maxr=12, hors_feu=False)`
    /// u_or_cls : une unité (dict : `is_dict()`) ou une classe de marche (texte) ; défauts : maxr = 12,
    /// hors_feu = false. Rend (x, y) tels quels si la case est franchissable, sinon le centre d'une case.
    pub fn nearest_passable(&mut self, u_or_cls: &Val, side: i64, x: f64, y: f64, maxr: i64, hors_feu: bool) -> (f64, f64) {
        let mc = if u_or_cls.is_dict() { move_class(u_or_cls).to_string() } else { u_or_cls.string() };
        let mut cost = self.costs(&mc, side);
        if hors_feu {
            let bt = &self.bati;
            cost = Rc::new(cost.iter().enumerate().map(|(c, &v)| if bt[c] == 2 { None } else { v }).collect());
        }
        let c0 = Self::cell(x, y);
        if cost[c0 as usize].is_some() {
            return (x, y);
        }
        let (ci, cj) = (c0 % COLS, c0 / COLS);
        let cf = CELL as f64;
        for r in 1..=maxr {
            let mut best: Option<(i64, i64, i64)> = None;
            for dj in -r..=r {
                let dis: Vec<i64> = if dj.abs() != r { vec![-r, r] } else { (-r..=r).collect() };
                for di in dis {
                    let (i, j) = (ci + di, cj + dj);
                    if 0 <= i && i < COLS && 0 <= j && j < ROWS && cost[(j * COLS + i) as usize].is_some() {
                        let d = di * di + dj * dj;
                        if best.is_none_or(|b| d < b.0) {
                            best = Some((d, i, j));
                        }
                    }
                }
            }
            if let Some((_, i, j)) = best {
                return ((i as f64 + 0.5) * cf, (j as f64 + 0.5) * cf);
            }
        }
        (x, y)
    }

    /// Ligne de vue entre deux points, la même dans les deux sens : eye1 et eye2 sont les hauteurs de ce qui regarde
    /// ou est vu à chaque bout (fantassin 2,5 m, canons 3, cavaliers et état-major 3,5 : HEIGHT). Bois, bâti, murs et
    /// haies la bouchent peu à peu quand le regard passe sous leur faîte (une haie ne cache rien à qui la domine) ; les
    /// crêtes la coupent. Les deux cases au bord de chaque bout ne comptent pas : une troupe en lisière, ou postée
    /// juste derrière un mur, une haie, les premières maisons, voit dehors et y est vue.
    ///
    /// Python (battle.py, l. 746-787) : `def los(self, x1, y1, x2, y2, eye1=EYE, eye2=EYE)`
    /// Défauts : eye1 = eye2 = EYE. Le cache : clé (c1, c2, eye1.to_bits(), eye2.to_bits()).
    pub fn los(&mut self, x1: f64, y1: f64, x2: f64, y2: f64, eye1: f64, eye2: f64) -> bool {
        let (mut c1, mut c2) = (Self::cell(x1, y1), Self::cell(x2, y2));
        let (mut eye1, mut eye2) = (eye1, eye2);
        if c2 < c1 {
            (c1, c2, eye1, eye2) = (c2, c1, eye2, eye1);
        }
        let key = (c1, c2, eye1.to_bits(), eye2.to_bits());
        if let Some(&r) = self._los_cache.get(&key) {
            return r;
        }
        let (t, h, f, bt) = (&self.map.t, &self.map.h, &self.map.f, &self.bati);
        let (i1, j1, i2, j2) = (c1 % COLS, c1 / COLS, c2 % COLS, c2 / COLS);
        let n = (i2 - i1).abs().max((j2 - j1).abs());
        let mut ok = true;
        if n > 2 {
            let z1 = h[c1 as usize] as f64 + eye1;
            let dz = (h[c2 as usize] as f64 + eye2 - z1) / n as f64;
            let mut op = 0i64;
            let (di, dj) = ((i2 - i1) as f64 / n as f64, (j2 - j1) as f64 / n as f64);
            for s in 1..n {
                let sf = s as f64;
                let c = (py::int(j1 as f64 + dj * sf + 0.5) * COLS + py::int(i1 as f64 + di * sf + 0.5)) as usize;
                let clear = z1 + dz * sf - h[c] as f64;
                if clear < -0.5 {
                    ok = false;
                    break;
                }
                if 2 < s && s < n - 2 {
                    let tc = t[c] as usize;
                    if OPACITY[tc] != 0 && clear < TOP[tc] as f64 {
                        op += if bt[c] != 3 { OPACITY[tc] } else { RUINE_OPAC };
                    }
                    let fc = f[c] as usize;
                    if fc != 0 && FOPAC[fc] != 0 && clear < FTOP[fc] {
                        op += FOPAC[fc];
                    }
                    if op >= 100 {
                        ok = false;
                        break;
                    }
                }
            }
        }
        if self._los_cache.len() > 60000 {
            self._los_cache.clear();
        }
        self._los_cache.insert(key, ok);
        ok
    }

    /// Ligne de vue entre deux unités (chacune à sa hauteur).
    ///
    /// Python (battle.py, l. 789-791) : `def los_units(self, a, b)`
    pub fn los_units(&mut self, a: &Val, b: &Val) -> bool {
        let hh = HEIGHT();
        let (ea, eb) = (hh.get_or(a.at("cls"), EYE).f(), hh.get_or(b.at("cls"), EYE).f());
        self.los(a.atf("x"), a.atf("y"), b.atf("x"), b.atf("y"), ea, eb)
    }

    /// Python (battle.py, l. 793-801) : `def _line_ok(self, cost, x1, y1, x2, y2, maxc)`
    /// cost : table de costs (`&cost` d'un `Couts`) ; maxc : coût au plus de chaque case traversée.
    pub fn _line_ok(&self, cost: &[Option<f64>], x1: f64, y1: f64, x2: f64, y2: f64, maxc: f64) -> bool {
        let l = py::hypot(x2 - x1, y2 - y1);
        let n = 1.max(py::int(l / 10.0));
        for s in 1..=n {
            let k = s as f64 / n as f64;
            match cost[Self::cell(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k) as usize] {
                Some(cc) if !(cc > maxc) => {}
                _ => return false,
            }
        }
        true
    }

    /// A* pondéré sur la grille (8 voisins), avec pénalité de montée. Renvoie la liste des cases ou None.
    ///
    /// Python (battle.py, l. 803-850) : `def _astar(self, cost, s, g, cap=9000)`
    /// s, g : cases de départ et d'arrivée ; cap : défaut 9000. Tas : `py::heapq` sur des (f64, i64), mêmes
    /// poussées dans le même ordre ; `gs` et `came` ne sont jamais parcourus (un HashMap suffit).
    pub fn _astar(&self, cost: &[Option<f64>], s: i64, g: i64, cap: i64) -> Option<Vec<i64>> {
        if cost[g as usize].is_none() {
            return None;
        }
        let h = &self.map.h;
        let (gi, gj) = (g % COLS, g / COLS);
        let cmin = 0.7;
        const D2: f64 = 1.4142;
        let mut openh: Vec<(f64, i64)> = vec![(0.0, s)];
        let mut gs: HashMap<i64, f64> = HashMap::from([(s, 0.0)]);
        let mut came: HashMap<i64, i64> = HashMap::new();
        let mut seen = 0;
        while let Some((_, c)) = py::heapq::heappop(&mut openh) {
            if c == g {
                break;
            }
            seen += 1;
            if seen > cap {
                return None;
            }
            let gc = gs[&c];
            let (i, j) = (c % COLS, c / COLS);
            let hc = h[c as usize] as i64;
            for (di, dj, m) in [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0), (1, 1, D2), (1, -1, D2), (-1, 1, D2), (-1, -1, D2)] {
                let (ni, nj) = (i + di, j + dj);
                if ni < 0 || nj < 0 || ni >= COLS || nj >= ROWS {
                    continue;
                }
                let nc = nj * COLS + ni;
                let Some(cc) = cost[nc as usize] else { continue };
                if m > 1.0 && (cost[(j * COLS + ni) as usize].is_none() || cost[(nj * COLS + i) as usize].is_none()) {
                    continue; // pas de coin coupé entre deux cases infranchissables
                }
                let dh = h[nc as usize] as i64 - hc;
                let ng = gc + cc * m + if dh > 0 { dh as f64 * 0.08 } else { 0.0 };
                if ng < *gs.get(&nc).unwrap_or(&1e18) {
                    gs.insert(nc, ng);
                    came.insert(nc, c);
                    let (dx, dy) = ((ni - gi).abs(), (nj - gj).abs());
                    let hh = (dx.max(dy) as f64 + 0.4142 * dx.min(dy) as f64) * cmin * 1.25;
                    py::heapq::heappush(&mut openh, (ng + hh, nc));
                }
            }
        }
        if g != s && !came.contains_key(&g) {
            return None;
        }
        let mut path = vec![g];
        while *path.last().unwrap() != s {
            path.push(came[path.last().unwrap()]);
        }
        path.reverse();
        Some(path)
    }

    /// Chemin de l'unité jusqu'à (gx, gy) : en ligne droite si le terrain s'y prête, sinon A* (mis en cache).
    ///
    /// Python (battle.py, l. 852-878) : `def plan_path(self, u, gx, gy)`
    /// Rend une liste NEUVE de tuples (x, y) (elle devient `u.path`) ; vide si rien ne mène au but. Le cache
    /// `_path_cache` garde des `Vec<(f64, f64)>` sous la clé (mc, side, s, g).
    pub fn plan_path(&mut self, u: &Val, gx: f64, gy: f64) -> Val {
        let mc = move_class(u);
        let side = u.ati("side");
        let cost = self.costs(mc, side);
        let (gx, gy) = self.nearest_passable(u, side, gx, gy, 12, false);
        let (ux, uy) = (u.atf("x"), u.atf("y"));
        let (s, g) = (Self::cell(ux, uy), Self::cell(gx, gy));
        let cs = cost[s as usize].unwrap_or(1.0);
        let lim = if mc != "art" { 2.0 } else { 1.6 };
        let tup_list = |pts: &[(f64, f64)]| -> Val { pts.iter().map(|&(x, y)| tup![x, y]).collect() };
        if self._line_ok(&cost, ux, uy, gx, gy, if cs > lim { cs } else { lim }) {
            return tup_list(&[(gx, gy)]);
        }
        let key = (mc.to_string(), side, s, g);
        let mut pts = self._path_cache.get(&key).cloned();
        if pts.is_none() && self._astar_left <= 0 {
            return tup_list(&[(gx, gy)]); // trop de recherches ce pas-ci : en ligne droite, on recalculera si ça bloque
        }
        if pts.is_none() {
            self._astar_left -= 1;
            let p = match self._astar(&cost, s, g, 9000) {
                None => {
                    if self._line_ok(&cost, ux, uy, gx, gy, 99.0) {
                        vec![(gx, gy)]
                    } else {
                        vec![]
                    }
                }
                Some(cells) => self._smooth(&cost, cells.iter().map(|&c| TR::center_of(c as usize)).collect()),
            };
            if self._path_cache.len() > 200 {
                self._path_cache.clear();
            }
            self._path_cache.insert(key, p.clone());
            pts = Some(p);
        }
        let mut pts = pts.unwrap();
        if let Some(der) = pts.last_mut() {
            *der = (gx, gy);
        }
        tup_list(&pts)
    }

    /// Python (battle.py, l. 880-899) : `def _smooth(self, cost, pts)`
    /// pts : centres des cases du chemin d'A*. Rend le chemin allégé (sans son premier point).
    pub fn _smooth(&self, cost: &[Option<f64>], pts: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
        if pts.len() <= 2 {
            return if pts.len() > 1 { pts[1..].to_vec() } else { pts };
        }
        let cs: Vec<f64> = pts.iter().map(|&(x, y)| cost[Self::cell(x, y) as usize].unwrap_or(1.0)).collect();
        let mut out = vec![];
        let mut i = 0;
        while i < pts.len() - 1 {
            let mut k = i + 1;
            let mut mc = if cs[k] > cs[i] { cs[k] } else { cs[i] };
            let mut j = k + 1;
            while j < pts.len() && j - i < 40 {
                let m2 = if cs[j] > mc { cs[j] } else { mc };
                if self._line_ok(cost, pts[i].0, pts[i].1, pts[j].0, pts[j].1, m2 + 0.01) {
                    (k, mc) = (j, m2);
                    j += 1;
                } else {
                    break;
                }
            }
            out.push(pts[k]);
            i = k;
        }
        out
    }

    /// Temps de marche estimé (s, à 1 m/s × coût du terrain) de (x1, y1) à (x2, y2), ou None si impossible.
    ///
    /// Python (battle.py, l. 901-918) : `def path_cost(self, x1, y1, x2, y2, cls='inf', side=0)`
    /// cls : comme passable ; défauts : cls = 'inf', side = 0. Rend un flottant ou None. `sum(…)` → `py::sum`.
    pub fn path_cost(&mut self, x1: f64, y1: f64, x2: f64, y2: f64, cls: &str, side: i64) -> Val {
        let mc = mc_of(cls);
        let cost = self.costs(mc, side);
        let (s, g) = (Self::cell(x1, y1), Self::cell(x2, y2));
        if cost[g as usize].is_none() {
            return Val::None;
        }
        if self._line_ok(&cost, x1, y1, x2, y2, 99.0) {
            let l = py::hypot(x2 - x1, y2 - y1);
            let n = 1.max(py::int(l / 20.0));
            let nf = n as f64;
            let tot = py::sum((1..=n).map(|k| {
                let kf = k as f64;
                cost[Self::cell(x1 + (x2 - x1) * kf / nf, y1 + (y2 - y1) * kf / nf) as usize]
                    .expect("TypeError: unsupported operand type(s) for +: 'float' and 'NoneType'")
            }));
            return Val::from(tot * l / nf);
        }
        let Some(cells) = self._astar(&cost, s, g, 9000) else { return Val::None };
        let mut tot = 0.0;
        for w in cells.windows(2) {
            let (a, b) = (w[0], w[1]);
            let diag = a % COLS != b % COLS && a / COLS != b / COLS;
            tot += cost[b as usize].unwrap() * (if diag { 1.4142 } else { 1.0 }) * CELL as f64;
        }
        Val::from(tot)
    }

    /// Meilleure case à moins de radius de (x, y) : 'cover', 'height' ou 'wood_edge' (lisière face à facing).
    ///
    /// Python (battle.py, l. 920-950) : `def best_spot(self, x, y, radius, kind='cover', side=0, facing=None, cls='inf')`
    /// kind : 'cover' (défaut ; toute autre valeur aussi), 'height' ou 'wood_edge' ; side : défaut 0 ; facing :
    /// angle (rad) ou None (défaut) ; cls : comme passable (défaut 'inf'). Rend (x, y) tels quels si rien ne vaut
    /// mieux, sinon le centre d'une case.
    pub fn best_spot(&mut self, x: f64, y: f64, radius: f64, kind: &str, side: i64, facing: &Val, cls: &str) -> (f64, f64) {
        let (mut best, mut bv) = ((x, y), -1e9);
        let cf = CELL as f64;
        let r = py::int(py::floordiv_f(radius, cf));
        let (ci, cj) = (py::int(py::floordiv_f(x, cf)), py::int(py::floordiv_f(y, cf)));
        let step = if r <= 10 { 1 } else { 2 };
        for dj in (-r..=r).step_by(step) {
            for di in (-r..=r).step_by(step) {
                let (i, j) = (ci + di, cj + dj);
                if !(0 <= i && i < COLS && 0 <= j && j < ROWS) || di * di + dj * dj > r * r {
                    continue;
                }
                let c = (j * COLS + i) as usize;
                let (px, py_) = ((i as f64 + 0.5) * cf, (j as f64 + 0.5) * cf);
                if !self.passable(px, py_, cls, side) {
                    continue;
                }
                let d = ((di * di + dj * dj) as f64).sqrt() / 1.max(r) as f64;
                let hc = self.map.h[c] as f64;
                let v = if kind == "height" {
                    hc - 4.0 * d
                } else if kind == "wood_edge" {
                    if !WOODS.contains(&(self.map.t[c] as i64)) || facing.is_none() {
                        continue;
                    }
                    // en lisière : la case suivante vers l'ennemi est dégagée
                    let fa = facing.f();
                    let (fx, fy) = (px + fa.cos() * cf * 1.5, py_ + fa.sin() * cf * 1.5);
                    if [T_BOIS, T_FORET_T, T_BATI, T_MUR, T_EAU].contains(&self.terrain_at(fx, fy)) {
                        continue;
                    }
                    1.0 + hc / 40.0 - d
                } else {
                    COVER[self.map.t[c] as usize] * 2.0 + hc / 80.0 - d * 0.5
                };
                if v > bv {
                    (best, bv) = ((px, py_), v);
                }
            }
        }
        best
    }

    // ================================================================== unités : aides
    /// Python (battle.py, l. 953-954) : `def unit(self, uid)`
    /// uid : id (texte) ou None. Rend l'unité ou None.
    pub fn unit(&self, uid: &Val) -> Val {
        self.by_id.get(uid)
    }

    /// Python (battle.py, l. 956-957) : `def units_of(self, side)`
    /// Rend une liste NEUVE d'unités (dans l'ordre de self.units).
    pub fn units_of(&self, side: i64) -> Val {
        self.units.iter().filter(|u| u.ati("side") == side && U::alive(u)).collect()
    }

    /// Python (battle.py, l. 959-960) : `def ai_units(self, side)`
    /// Rend une liste NEUVE d'unités.
    pub fn ai_units(&self, side: i64) -> Val {
        self.units.iter().filter(|u| u.ati("side") == side && U::alive(u) && u.at("ctrl") == "ia").collect()
    }

    /// Python (battle.py, l. 962-964) : `def visible_enemies(self, side)`
    /// Rend une liste NEUVE d'unités (dans l'ordre de self.units).
    pub fn visible_enemies(&self, side: i64) -> Val {
        let seen = self.seen_by.at(side);
        self.units.iter().filter(|u| u.ati("side") != side && U::alive(u) && seen.has(u.at("id"))).collect()
    }

    /// Python (battle.py, l. 966-967) : `def ranges(self, u)`
    /// units::ranges(u).
    pub fn ranges(&self, u: &Val) -> (i64, i64, Val) {
        U::ranges(u)
    }

    /// Python (battle.py, l. 969-971) : `def dist(a, b)`
    /// Méthode statique : `Self::dist(&a, &b)`. a, b : unités. `math.hypot` → `py::hypot`.
    pub fn dist(a: &Val, b: &Val) -> f64 {
        py::hypot(a.atf("x") - b.atf("x"), a.atf("y") - b.atf("y"))
    }

    /// Python (battle.py, l. 973-975) : `def bearing(a, b)`
    /// Méthode statique : `Self::bearing(&a, &b)`. Angle (rad) de a vers b.
    pub fn bearing(a: &Val, b: &Val) -> f64 {
        (b.atf("y") - a.atf("y")).atan2(b.atf("x") - a.atf("x"))
    }

    /// Python (battle.py, l. 977-979) : `def threat(self, side, x, y, radius=600)`
    /// radius : défaut 600. Hommes (`py::sum`).
    pub fn threat(&self, side: i64, x: f64, y: f64, radius: f64) -> f64 {
        let r2 = radius * radius;
        py::sum(
            self.visible_enemies(side)
                .iter()
                .filter(|u| py::pow(u.atf("x") - x, 2.0) + py::pow(u.atf("y") - y, 2.0) <= r2 && U::valid(u))
                .map(|u| u.atf("men")),
        )
    }

    /// Python (battle.py, l. 981-982) : `def strength(self, side)`
    pub fn strength(&self, side: i64) -> f64 {
        py::sum(self.units.iter().filter(|u| u.ati("side") == side && U::valid(u)).map(|u| u.atf("men")))
    }

    /// Python (battle.py, l. 984-985) : `def seen_strength(self, side)`
    pub fn seen_strength(&self, side: i64) -> f64 {
        py::sum(self.visible_enemies(side).iter().filter(|u| U::valid(u)).map(|u| u.atf("men")))
    }

    /// Python (battle.py, l. 987-988) : `def time_left(self)`
    pub fn time_left(&self) -> f64 {
        let v = self.dusk - self.clock;
        if v > 0.0 { v } else { 0.0 }
    }

    /// États-majors présents et trait du général de chaque camp (recalculés à chaque pas).
    ///
    /// Python (battle.py, l. 990-996) : `def _refresh_gens(self)`
    /// Pose self._gens (liste d'unités) et self._traits (liste [trait ou None, trait ou None]).
    pub fn _refresh_gens(&mut self) {
        self._gens = self.units.iter().filter(|g| g.at("cls") == "general" && U::alive(g)).collect();
        self._traits = list![Val::None, Val::None];
        for g in self._gens.iter() {
            let side = g.ati("side");
            if g.atb("gen") && self._traits.at(side).is_none() {
                self._traits.set(side, g.at("gen").get("trait"));
            }
        }
    }

    /// Python (battle.py, l. 998-1006) : `def general_near(self, u, r=400)`
    /// r : défaut 400. Rend l'unité d'état-major ou None. `hasattr(self, '_gens')` → `self._gens.is_some()` ;
    /// `g is not u` → `!g.is(u)`.
    pub fn general_near(&mut self, u: &Val, r: f64) -> Val {
        if self._gens.is_none() {
            self._refresh_gens();
        }
        for g in self._gens.iter() {
            if g.ati("side") == u.ati("side") && !g.is(u) && U::alive(&g) {
                let rr = r + if g.at("gen").or(Val::dict()).get("trait") == "inspirant" { 200.0 } else { 0.0 };
                if py::pow(g.atf("x") - u.atf("x"), 2.0) + py::pow(g.atf("y") - u.atf("y"), 2.0) <= rr * rr {
                    return g;
                }
            }
        }
        Val::None
    }

    /// Technologies de combat du camp (stats.TECH_MODS → valeur, venues de la campagne ; {} sans elles).
    ///
    /// Python (battle.py, l. 1008-1010) : `def tech(self, side)`
    /// Rend le dict de la spec (le même objet), ou un dict vide.
    pub fn tech(&self, side: i64) -> Val {
        self.spec.get("tech").or_else(|| tup![Val::dict(), Val::dict()]).at(side)
    }

    /// Technologies de combat de cette unité : celles de son régiment s'il n'a pas tout appris (SPEC-ARBRE.md,
    /// bridge._umd), sinon celles de son camp.
    ///
    /// Python (battle.py, l. 1012-1016) : `def tech_of(self, u)`
    /// Rend un dict (stats::TECH_MODS → valeur).
    pub fn tech_of(&self, u: &Val) -> Val {
        let m = self.spec.get("umd").or(Val::dict()).get(u.at("id"));
        if m.is_none() { self.tech(u.ati("side")) } else { m }
    }

    /// Retranchements, mélinite… de cette unité (spec[k] par camp, ou ceux de son régiment).
    ///
    /// Python (battle.py, l. 1018-1021) : `def ufx(self, u, k)`
    /// k : 'entrench' ou 'shell'. Le Python rend l'int 0 ou un float : ici un f64 (`if not k` → `k == 0.0`).
    pub fn ufx(&self, u: &Val, k: &str) -> f64 {
        let m = self.spec.get("umd").or(Val::dict()).get(u.at("id"));
        if m.is_none() { self.spec.get_or(k, list![0, 0]).at(u.ati("side")).f() } else { m.get_or(k, 0.0).f() }
    }

    /// Python (battle.py, l. 1023-1026) : `def trait(self, side)`
    /// `trait` est un mot réservé en Rust : `b.r#trait(side)`. Rend le trait du général du camp (texte) ou None :
    /// `self.r#trait(side) == "eclaireur"`.
    pub fn r#trait(&mut self, side: i64) -> Val {
        if self._traits.is_none() {
            self._refresh_gens();
        }
        self._traits.at(side)
    }

    /// Rayon (m) dans lequel cet état-major rallie les fuyards (un peu plus pour un général inspirant).
    ///
    /// Python (battle.py, l. 1028-1030) : `def rally_radius(self, g)`
    /// g : unité d'état-major.
    pub fn rally_radius(&self, g: &Val) -> f64 {
        RALLY_R + if g.at("gen").or(Val::dict()).get("trait") == "inspirant" { RALLY_INSP } else { 0.0 }
    }

    /// L'état-major ami qui peut rallier cette troupe (à moins de rally_radius), ou None.
    ///
    /// Python (battle.py, l. 1032-1041) : `def rally_general(self, u)`
    /// Rend l'unité d'état-major ou None.
    pub fn rally_general(&mut self, u: &Val) -> Val {
        if self._gens.is_none() {
            self._refresh_gens();
        }
        for g in self._gens.iter() {
            if g.ati("side") == u.ati("side") && !g.is(u) && U::alive(&g) {
                let r = self.rally_radius(&g);
                if py::pow(g.atf("x") - u.atf("x"), 2.0) + py::pow(g.atf("y") - u.atf("y"), 2.0) <= r * r {
                    return g;
                }
            }
        }
        Val::None
    }

    /// Le camp a-t-il encore un état-major sur le terrain (ni blessé ni absent) ?
    ///
    /// Python (battle.py, l. 1043-1047) : `def has_general(self, side)`
    pub fn has_general(&mut self, side: i64) -> bool {
        if self._gens.is_none() {
            self._refresh_gens();
        }
        self._gens.iter().any(|g| g.ati("side") == side && U::alive(&g))
    }

    /// Le point est-il dans la place (enceinte ou bourg) dont on se dispute la possession ?
    ///
    /// Python (battle.py, l. 1049-1055) : `def in_place(self, x, y, margin=30.0)`
    /// margin : défaut 30.0.
    pub fn in_place(&self, x: f64, y: f64, margin: f64) -> bool {
        let pl = &self.map.place;
        if !pl.truthy() || !pl.getb("battle") {
            return false;
        }
        let r = pl.atf("r") + margin;
        py::pow(x - pl.atf("x"), 2.0) + py::pow(y - pl.atf("y"), 2.0) <= r * r
    }

    /// Une troupe en déroute peut-elle se reprendre ici et maintenant ? Renvoie (moral regagné par seconde, qui la
    /// rallie : 'general', 'place', 'loin', ou la raison du refus : 'ennemi', 'general_loin', 'seuls').
    /// order : l'ordre « Rallier » (les officiers s'y mettent tous : il suffit que l'ennemi soit à plus de 150 m).
    ///
    /// Python (battle.py, l. 1057-1076) : `def _rally_k(self, u, foe=None, order=False)`
    /// foe : distance (m) de l'ennemi le plus proche, ou None (défaut : `self._nearest_foe_dist(u, true)`) ;
    /// order : défaut false.
    pub fn _rally_k(&mut self, u: &Val, foe: &Val, order: bool) -> (f64, &'static str) {
        let foe = if foe.is_none() { self._nearest_foe_dist(u, true) } else { foe.f() };
        let (ux, uy) = (u.atf("x"), u.atf("y"));
        if self.in_place(ux, uy, 30.0) || (u.ati("side") == 1 && self.objective().is_some()) {
            // dans une place (et partout pour ses défenseurs, chez eux), les officiers rallient leurs hommes au calme
            // (plus près de l'ennemi à l'abri des maisons)
            let calm = if order || self.map.t[Self::cell(ux, uy) as usize] as i64 == T_BATI { RALLY_CALM_BATI } else { RALLY_CALM };
            return if foe > calm { (RALLY_REC_PLACE, "place") } else { (0.0, "ennemi") };
        }
        if foe <= if order { RALLY_CALM_BATI } else { RALLY_CALM } {
            return (0.0, "ennemi");
        }
        if self.rally_general(u).is_some() {
            return (RALLY_REC, "general");
        }
        if self.has_general(u.ati("side")) {
            return (0.0, "general_loin");
        }
        if foe > RALLY_ALONE {
            return (RALLY_REC_ALONE, "loin");
        }
        (0.0, "seuls")
    }

    // ================================================================== journal et effets
    /// Python (battle.py, l. 1079-1090) : `def emit(self, k, x, y, x2=None, y2=None, n=None, src=None)`
    /// Un effet pour le client, rangé dans self.fx : dict {k, x, y, t, s} + x2, y2, n, u s'ils sont donnés.
    /// x2, y2 : nombres ou None (défaut) ; n : nombre ou None (défaut ; `round(n, 1)` : un int reste un int) ;
    /// src : id de l'unité (`u.at("id")`) ou None (défaut). Appel type :
    /// `self.emit("charge", x, y, &Val::from(tx), &Val::from(ty), &Val::None, &u.at("id"))`.
    pub fn emit(&mut self, k: &str, x: f64, y: f64, x2: &Val, y2: &Val, n: &Val, src: &Val) {
        self.seq += 1;
        let e = dict! {"k" => k, "x" => py::round(x), "y" => py::round(y), "t" => py::round(self.clock), "s" => self.seq};
        if x2.is_some() {
            e.set("x2", py::round(x2.f()));
            e.set("y2", py::round(y2.f()));
        }
        if n.is_some() {
            e.set("n", if n.is_int() { n.clone() } else { Val::from(py::round_n(n.f(), 1)) });
        }
        if src.is_some() {
            e.set("u", src);
        }
        self.fx.push(e);
        if self.fx.len() > 500 {
            self.fx.replace_all(self.fx.slice(Some(150), None).vec());
        }
    }

    /// side : camp qui voit ce message (None : les deux) ; about : camp de l'unité dont on parle.
    ///
    /// Python (battle.py, l. 1092-1097) : `def log(self, text, side=None, about=None)`
    /// side, about : 0, 1 ou None (défauts : None). Range le tuple (seq, side, text, about) dans self.logs.
    pub fn log(&mut self, text: &str, side: &Val, about: &Val) {
        self.seq += 1;
        self.logs.push(tup![self.seq, side, text, about]);
        if self.logs.len() > 300 {
            self.logs.replace_all(self.logs.slice(Some(100), None).vec());
        }
    }
}
