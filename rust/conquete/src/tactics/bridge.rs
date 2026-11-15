//! Porte game/tactics/bridge.py (en entier) : le raccord entre la campagne (`g`, engine::Game) et les batailles
//! tactiques.
//!
//! Conventions (en plus de PORTAGE.md) :
//! - `g: &mut Game` (`&Game` pour une lecture pure qui n'appelle aucun autre module avec la partie) ; `bt` : une
//!   bataille de campagne (dict de g.battles) ; `tb` : une bataille tactique (`TacticalBattle`).
//! - En Python, g.tactical, g.tac_done et g.tac_preview sont des dict {bid: tb} d'une bataille au plus ; en Rust, des
//!   `Option<Box<TacticalBattle>>` (engine::Game). Une fonction qui fait agir la bataille en cours avec la partie la
//!   sort de son champ (`let tb = g.tactical.take()`) et l'y remet (PORTAGE.md) ; `finish` la reçoit en propre et la
//!   range dans g.tac_done.
//! - `zlib.crc32` n'est pas dans le socle : `crc32` (privée, ci-dessous).
//!
//! Raccord entre la campagne et les batailles tactiques.
//!
//! - choix du mode d'une bataille du joueur (attente / manuel / ordres / auto) et réglage `settings['battles']` ;
//! - création d'une TacticalBattle depuis une bataille de campagne (`bt`), boucle tactique (tick), report du résultat
//!   sur les régiments puis `engine.end_battle` ;
//! - « Commander la bataille » (manuel) : le joueur mène chaque régiment ; « Finir automatiquement » la joue en accéléré
//!   par tick (budget de calcul ACCEL_BUDGET par appel), reprise du commandement (`resume`), et resolve_now pour la jouer
//!   d'un coup (essais, bancs) ;
//! - munitions (`ammo`, 0–100 %) et fatigue (`fat`, 0–100) persistantes des régiments en campagne ;
//! - « Donner mes ordres » (orders.py) : la bataille créée sans commandement, le joueur choisit ses ordres sur le champ
//!   de bataille (ses troupes s'y redéploient à chaque choix), puis ses officiers la livrent sous ses yeux, vue de dessus,
//!   à l'allure REPLAY_RATE (une trentaine de secondes), en s'arrêtant au moment décisif s'il l'a demandé ;
//! - sauvegarde, chargement et migration ; vues pour /api/state, /api/tactic et /api/tactic_map ; commandes `tac`.
//!
//! Les crochets dans engine.py, views.py et server.py ne font qu'appeler ces fonctions.

use crate::army_actions as AA;
use crate::engine::Game;
use crate::py::{self, Val};
use crate::rules as R;
use crate::tactics::ai as AI;
use crate::tactics::battle::{valid_piet, TacticalBattle, ACCEL_FX, ACCEL_LEVEL};
use crate::tactics::orders as OR;
use crate::tactics::stats as ST;
use crate::tactics::terrain as TR;
use crate::tactics::terrain::{CELL, COLS, ROWS};
use crate::tactics::units as U;
use crate::turns as TT;
use crate::{dict, list, py_const, pyset, tup};
use std::collections::HashMap;

py_const!(SETTINGS, tup!["demander", "auto", "auto_petites"]);
pub const SMALL_MEN: i64 = 600; // escarmouche : moins de 600 hommes en tout…
pub const MILICE_COMPANY: i64 = 400; // la milice d'une place se bat par compagnies de 400 hommes au plus

// munitions consommées par jour de bataille automatique (% de la dotation), selon la phase et l'arme
py_const!(AUTO_AMMO, dict!{"canonnade" => dict!{"artillerie" => 80, "inf" => 10, "cavalerie" => 0},
    "fusillade" => dict!{"artillerie" => 50, "inf" => 70, "cavalerie" => 15},
    "charge" => dict!{"artillerie" => 30, "inf" => 40, "cavalerie" => 25}});
pub const AUTO_FAT: i64 = 40; // fatigue par jour de bataille automatique
// « Finir automatiquement » : une bataille accélérée avance par pas DT ordinaires tant que dure ce budget de calcul, à
// chaque appel de tick (toutes les 0,1 s, sous le verrou du serveur : les requêtes attendent au plus autant)
pub const ACCEL_BUDGET: f64 = 0.045;
// « Donner mes ordres » : secondes de bataille par seconde réelle (une escarmouche de 2 h défile en 18 s, une bataille
// de 6 h en 40 s) ; au-delà de REPLAY_LONG secondes à l'écran, deux fois plus vite (quatre au-delà de REPLAY_LONGER), ou
// à la vitesse choisie (×2, ×4)
pub const REPLAY_RATE: f64 = 400.0;
pub const REPLAY_LONG: f64 = 25.0;
pub const REPLAY_LONGER: f64 = 40.0;
// le bandeau du film raconte les grands gestes, pas l'intendance
py_const!(DULL, tup!["s'abrite", "ne voit rien", "change d'emplacement", "recomplète", "relève", "premier contact"]);

/// `zlib.crc32(b)` : le CRC-32 IEEE (polynôme réfléchi 0xEDB88320), bit à bit.
fn crc32(b: &[u8]) -> u32 {
    let mut c = !0u32;
    for &x in b {
        c ^= x as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { (c >> 1) ^ 0xEDB8_8320 } else { c >> 1 };
        }
    }
    !c
}

/// La graine de la bataille (make_spec) : `(zlib.crc32(bid.encode()) ^ (g.seed * 2654435761)) & 0x7FFFFFFF`. Le produit
/// dépasse 64 bits pour une grande graine : seuls les 31 bits bas restent, `wrapping_mul` les donne exacts.
fn graine(bid: &str, seed: i64) -> i64 {
    (crc32(bid.as_bytes()) as i64 ^ seed.wrapping_mul(2654435761)) & 0x7FFF_FFFF
}

/// `max(a, b)` de Python : a, sauf si b est plus grand (le premier gagne).
fn max2(a: f64, b: f64) -> f64 {
    if b > a {
        b
    } else {
        a
    }
}
/// `min(a, b)` de Python : a, sauf si b est plus petit.
fn min2(a: f64, b: f64) -> f64 {
    if b < a {
        b
    } else {
        a
    }
}

// ================================================================== état de la partie

/// Champs propres aux batailles tactiques (nouvelle partie ou ancienne sauvegarde).
///
/// Python (bridge.py, l. 53-65) : `def ensure(g)`
/// En Rust, tactical, tac_done et tac_preview existent toujours (des `Option<Box<TacticalBattle>>` : en Python des
/// dict d'une bataille au plus, `{bid: tb}`) ; reste settings (None ou pas un dict → {}) et settings['battles'].
pub fn ensure(g: &mut Game) {
    if !g.settings.is_dict() {
        g.settings = dict! {};
    }
    if !SETTINGS().has(&g.settings.get("battles")) {
        g.settings.set("battles", "demander");
    }
}

/// Python (bridge.py, l. 68-69) : `def waiting(g)`
pub fn waiting(g: &Game) -> bool {
    g.battles.values().iter().any(|bt| bt.get("mode") == "attente")
}

/// La campagne est figée : bataille tactique en cours, ou bataille en attente du choix du joueur.
///
/// Python (bridge.py, l. 72-74) : `def frozen(g)`
/// `bool(getattr(g, 'tactical', None))` → `g.tactical.is_some()`.
pub fn frozen(g: &Game) -> bool {
    g.tactical.is_some() || waiting(g)
}

/// Python (bridge.py, l. 77-84) : `def involves_player(g, bt)`
/// bt : bataille de campagne (dict de g.battles : id, x, y, node, sides…).
pub fn involves_player(g: &Game, bt: &Val) -> bool {
    let p = &g.player;
    for s in bt.at("sides").iter() {
        if s.at("owner") == *p {
            return true;
        }
        if s.at("armies").iter().any(|aid| g.armies.get_or(&aid, dict! {}).get("owner") == *p) {
            return true;
        }
    }
    false
}

/// Python (bridge.py, l. 87-95) : `def small_battle(g, bt)`
pub fn small_battle(g: &Game, bt: &Val) -> bool {
    let men = py::sum_v(bt.at("sides").iter().map(|s| s.at("men0")));
    if men < SMALL_MEN {
        return true;
    }
    let d = bt.at("sides").at(1);
    let nd = d.at("node");
    if nd.is_some() && !d.atb("armies") && g.geo.nodes.at(&nd).at("type") == "village" && !g.nodes.at(&nd).atb("garrison") {
        return true; // contre la seule milice d'un village
    }
    false
}

/// Appelé par engine.start_battle : la bataille du joueur attend son choix, les autres se jouent seules.
///
/// Python (bridge.py, l. 98-108) : `def on_battle_start(g, bt)`
/// `g.player not in getattr(g, 'ais', {})` → `!g.ais.contains_key(&g.player)`.
pub fn on_battle_start(g: &mut Game, bt: &Val) {
    ensure(g);
    let mut mode = "auto";
    if involves_player(g, bt) && !g.ais.contains_key(&g.player) && !g.over.truthy() {
        let st = g.settings.at("battles");
        if st == "demander" || (st == "auto_petites" && !small_battle(g, bt)) {
            mode = "attente";
        }
    }
    bt.set("mode", mode);
    if mode == "attente" {
        g.speed_idx = 0;
    }
}

/// Python (bridge.py, l. 111-112) : `def is_auto(bt)`
pub fn is_auto(bt: &Val) -> bool {
    bt.get_or("mode", "auto") == "auto"
}

// ================================================================== munitions et fatigue en campagne

/// Effet modéré de la fatigue et des munitions sur la puissance d'un régiment (bataille automatique).
///
/// Python (bridge.py, l. 116-122) : `def reg_k(r, cls=None)`
/// r : régiment (dict) ; cls : texte ou None (défaut : la classe de R::UNITS()).
pub fn reg_k(r: &Val, cls: &Val) -> f64 {
    let mut k = 1.0 - 0.15 * r.get_or("fat", 0.0).f() / 100.0;
    let cls = cls.or_else(|| R::UNITS().get_or(&r.at("type"), dict! {}).get_or("cls", "inf"));
    if cls == "inf" || cls == "artillerie" {
        k *= 0.75 + 0.25 * r.get_or("ammo", 100.0).f() / 100.0;
    }
    k
}

/// La fatigue ralentit la marche (au plus −25 %).
///
/// Python (bridge.py, l. 125-132) : `def march_k(a)`
/// a : armée. Sommes → `py::sum` (r['n'] : flottants) ; `or 1.0`.
pub fn march_k(a: &Val) -> f64 {
    let regs = a.at("regs");
    if !regs.truthy() {
        return 1.0;
    }
    let mut men = py::sum(regs.iter().map(|r| r.atf("n")));
    if men == 0.0 {
        men = 1.0;
    }
    let fat = py::sum(regs.iter().map(|r| r.get_or("fat", 0.0).f() * r.atf("n"))) / men;
    1.0 - 0.25 * fat / 100.0
}

/// Munitions et fatigue d'une armée sur dt jours (pas de la campagne, ou jours de marche du tour du joueur).
///
/// Python (bridge.py, l. 135-161) : `def army_tick(g, a, dt, hot)`
/// a : armée ; dt : jours ; hot : dict zone → bool (canicule), fait par campaign_tick. `g.zone_of(x, y)` rend un texte.
/// `g.geo.node_of_cell(x, y)` rend `Option<i64>`. d est un entier, `d *= 1.5` en fait un flottant.
pub fn army_tick(g: &mut Game, a: &Val, dt: f64, hot: &Val) {
    if a.at("state") == "battle" {
        return;
    }
    let code = a.ats("owner");
    let st = a.at("state");
    let mut d: f64;
    if (st == "move" || st == "retreat") && !g.paused(a) {
        let off = a.get("mode") == "champs" || !a.getb("onroad");
        d = if st == "retreat" { 12.0 } else if off { 10.0 } else { 4.0 };
        if hot.get(g.zone_of(a.atf("x"), a.atf("y"))).truthy() {
            d *= 1.5;
        }
    } else if a.getb("qrt") {
        d = -25.0;
    } else {
        d = -15.0;
    }
    let nd = g.geo.node_of_cell(a.atf("x"), a.atf("y"));
    let home = nd.is_some_and(|nd| g.friendly(&code, g.nodes.at(nd).at("owner").s()));
    let refill = if home || a.get("depot").is_some() || a.getb("boat") {
        10.0
    } else if a.get_or("supply", 1.0) >= 0.35 {
        3.0
    } else {
        0.0 // en territoire ennemi, coupé du ravitaillement
    };
    for r in a.at("regs").iter() {
        r.set("fat", min2(100.0, max2(0.0, r.get_or("fat", 0.0).f() + d * dt)));
        if refill != 0.0 {
            r.set("ammo", min2(100.0, r.get_or("ammo", 100.0).f() + refill * dt));
        }
    }
}

/// Recomplètement des munitions et fatigue des régiments, par pas de campagne (dt en jours).
///
/// Python (bridge.py, l. 164-174) : `def campaign_tick(g, dt)`
pub fn campaign_tick(g: &mut Game, dt: f64) {
    let hot = Val::dict_from(g.weather.items().into_iter().map(|(z, w)| (z, Val::from(w.at("kind") == "canicule"))).collect());
    for a in g.armies.values() {
        army_tick(g, &a, dt, &hot);
    }
    for n in g.nodes.iter() {
        if n.atb("garrison") && !n.atb("siege") {
            for r in n.at("garrison").iter() {
                if r.get_or("ammo", 100.0) < 100 || r.get_or("fat", 0.0) > 0 {
                    r.set("ammo", min2(100.0, r.get_or("ammo", 100.0).f() + 10.0 * dt));
                    r.set("fat", max2(0.0, r.get_or("fat", 0.0).f() - 20.0 * dt));
                }
            }
        }
    }
}

/// Une bataille automatique use aussi les munitions et fatigue les hommes.
///
/// Python (bridge.py, l. 177-188) : `def auto_battle_tick(g, bt, dt)`
/// `g.side_units(bt, si)` : liste de tuples (code, régiment, armée).
pub fn auto_battle_tick(g: &mut Game, bt: &Val, dt: f64) {
    let rates = AUTO_AMMO().get_or(&bt.get_or("phase", "fusillade"), AUTO_AMMO().at("fusillade"));
    for si in 0..2 {
        let regs: Val = g.side_units(bt, si).iter().map(|x| x.at(1)).collect();
        let nd = bt.at("sides").at(si).at("node");
        if nd.is_some() {
            regs.extend(&g.nodes.at(&nd).at("garrison"));
        }
        for r in regs.iter() {
            let cls = R::UNITS().get_or(&r.at("type"), dict! {}).get_or("cls", "inf");
            r.set("ammo", max2(0.0, r.get_or("ammo", 100.0).f() - rates.get_or(&cls, 0).f() * dt));
            r.set("fat", min2(100.0, r.get_or("fat", 0.0).f() + AUTO_FAT as f64 * dt));
        }
    }
}

// ================================================================== création d'une bataille tactique

/// Direction (vue du centre de la bataille) d'où vient l'assaillant.
///
/// Python (bridge.py, l. 192-205) : `def _att_angle(g, bt)`
/// `zlib.crc32` n'est pas dans le socle : fonction privée de ce module (CRC-32 IEEE, comme zlib) ;
/// `% 628` sur un entier positif.
pub fn _att_angle(g: &Game, bt: &Val) -> f64 {
    let att: Vec<Val> = bt.at("sides").at(0).at("armies").iter().filter(|aid| g.armies.has(aid)).map(|aid| g.armies.at(&aid)).collect();
    let (bx, by) = (bt.atf("x"), bt.atf("y"));
    for a in &att {
        let (dx, dy) = (a.atf("x") - bx, a.atf("y") - by);
        if dx * dx + dy * dy > 0.04 {
            return dy.atan2(dx);
        }
    }
    if let Some(a) = att.first() {
        let owner = a.at("owner");
        let cap = if g.factions.has(&owner) { g.capital_of(owner.s()) } else { Val::None };
        if cap.is_some() {
            let (cx, cy) = g.node_xy(cap.i());
            if py::pow(cx - bx, 2.0) + py::pow(cy - by, 2.0) > 0.01 {
                return (cy - by).atan2(cx - bx);
            }
        }
    }
    (crc32(bt.at("id").s().as_bytes()) % 628) as f64 / 100.0
}

/// Python (bridge.py, l. 208-249) : `def make_spec(g, bt)`
/// Rend le dict spec de TacticalBattle (voir battle::TacticalBattle::spec). `g.place_name` est `&mut self` (engine).
/// `g.mod(o, k)` → `g.mod_(o, k, 0.0)` ; `int(…)` → `py::int` ; `g.date().year` → `g.date(&Val::None).year`.
/// seed : `(crc32 ^ (g.seed * 2654435761)) & 0x7FFFFFFF` : le produit dépasse 63 bits pour une grande graine
/// (calculer en i128, ou `wrapping_mul` : seuls les 31 bits bas restent). `min((hypot, id) for gn …)` : à distance égale,
/// le plus petit id. `{k: … for k in ST.TECH_MODS if g.mod(o, k)}` : dans l'ordre de TECH_MODS.
pub fn make_spec(g: &mut Game, bt: &Val) -> Val {
    let (bx, by) = (bt.atf("x"), bt.atf("y"));
    let zone = g.zone_of(bx, by);
    let owners: Val = bt.at("sides").iter().map(|s| s.at("owner")).collect();
    let mut me = Val::None;
    for (si, s) in bt.at("sides").iter().enumerate() {
        if s.at("owner") == g.player || s.at("armies").iter().any(|aid| g.armies.get_or(&aid, dict! {}).get("owner") == g.player) {
            me = Val::from(si);
        }
    }
    let mut place = Val::None;
    let node = bt.at("node");
    if node.is_some() {
        let n = g.nodes.at(&node);
        let gn = g.geo.nodes.at(&node);
        let att = bt.at("sides").at(0).at("owner"); // (la dynamite de l'assaillant : une brèche de plus, tactics/terrain.py)
        let deg = n.get_or("deg", 0.0);
        place = dict! {"nid" => &node, "name" => gn.at("name"), "type" => gn.at("type"), "fort" => n.at("fort"), "dmg" => AA::breach(&n),
            "dyn" => if g.factions.has(&att) { py::int(g.mod_(att.s(), "breach", 0.0)) } else { 0 },
            "bar" => n.get("aa").or(dict!{}).get_or("bar", 0.0), "pop" => py::int_v(&n.get_or("pop", gn.at("pop0"))),
            "x" => gn.at("x"), "y" => gn.at("y"), "battle" => true, "d" => n.get_or("dev", 0),
            "deg" => if deg.is_float() { Val::from(py::round_n(deg.f(), 3)) } else { deg }};
    }
    let mut lieu = Val::None; // (bataille rangée tout près d'un lieu : son état, pour dessiner la ville de son plan, terrain_ville)
    if place.is_none() {
        let (d, nid) = py::min_by_key(g.geo.nodes.iter().map(|gn| (py::hypot(gn.atf("x") - bx, gn.atf("y") - by), gn.ati("id"))), |p| *p).unwrap();
        if d < 1.3 {
            let n = g.nodes.at(nid);
            lieu = dict! {"nid" => nid, "f" => n.at("fort"), "pop" => py::int_v(&n.get_or("pop", g.geo.nodes.at(nid).at("pop0"))),
                "d" => n.get_or("dev", 0)};
        }
    }
    let techs: Vec<Val> = owners.iter().map(|o| if g.factions.has(&o) { g.factions.at(&o).at("techs") } else { list![] }).collect();
    let gname = g.place_name(bx, by);
    let kind = if bt.atb("ambush") {
        "Embuscade"
    } else if node.is_some() {
        "Assaut"
    } else {
        "Bataille"
    };
    let bid = bt.at("id");
    let seed = graine(bid.s(), g.seed);
    let par_camp = |f: &dyn Fn(&str) -> Val, autre: Val| -> Val {
        owners.iter().map(|o| if g.factions.has(&o) { f(o.s()) } else { autre.clone() }).collect()
    };
    let gr = &*g;
    let tech = par_camp(
        &|o| Val::dict_from(ST::TECH_MODS().iter().filter(|k| gr.mod_(o, k.s(), 0.0) != 0.0).map(|k| (k.clone(), Val::from(gr.mod_(o, k.s(), 0.0)))).collect()),
        dict! {},
    );
    let spec = dict! {"bid" => &bid, "seed" => seed,
        "cx" => bt.at("x"), "cy" => bt.at("y"), "season" => g.season(), "weather" => g.weather.at(zone).at("kind"), "year" => g.date(&Val::None).year,
        "place" => place, "att_angle" => _att_angle(g, bt), "owners" => &owners,
        "names" => owners.iter().map(|o| Val::from(g.fname(o.s()))).collect::<Val>(),
        "colors" => owners.iter().map(|o| if R::FACTIONS().has(&o) { R::FACTIONS().at(&o).at("color") } else { Val::from(R::NEUTRAL_COLOR) }).collect::<Val>(),
        "me" => me, "difficulty" => &g.difficulty, "title" => format!("{kind} {gname}"), "place_name" => &gname, "date" => g.date_str(&Val::None),
        "fm_swift" => par_camp(&|o| Val::from(min2(0.5, gr.mod_(o, "fm_swift", 0.0))), Val::from(0.0)),
        "art_cheval" => techs.iter().map(|t| Val::from(t.has("art_cheval"))).collect::<Val>(),
        "marks" => techs.iter().map(R::marks).collect::<Val>(),
        // technologies de combat (feu de rang, ordre mixte, cuirassiers… : stats.TECH_MODS), appliquées par battle.py
        "tech" => tech,
        // SPEC-TECH.md : ballon (portée de vue du général), retranchements, obus à la mélinite
        "balloon" => par_camp(&|o| Val::from(gr.mod_(o, "balloon", 0.0)), Val::from(0)),
        "entrench" => par_camp(&|o| Val::from(gr.mod_(o, "entrench", 0.0)), Val::from(0.0)),
        "shell" => par_camp(&|o| Val::from(gr.mod_(o, "shell", 0.0)), Val::from(0.0)), "ambush" => bt.at("ambush"), "surprise" => bt.at("surprise"),
        // SPEC-ARBRE.md : les régiments qui n'ont pas tout appris (manœuvres, armes) ont leurs propres effets
        "umd" => _umd(g, bt),
        "plans" => list![_side_plan(g, bt, 0), _side_plan(g, bt, 1)], "lieu" => lieu,
        "carte" => TR::VERSION}; // (version du générateur de la carte : une sauvegarde la refabrique à l'identique)
    spec
}

/// Effets de technologie des régiments en retard sur leur camp (engine.reg_lag) : id → effets, comme spec['tech']
/// plus entrench et shell.
///
/// Python (bridge.py, l. 252-265) : `def _umd(g, bt)`
/// Rend le dict id du régiment → effets. `g.reg_lag(o, r)` rend une valeur (vraie ou non) ; `(*ST.TECH_MODS,
/// 'entrench', 'shell')` : cet ordre.
pub fn _umd(g: &Game, bt: &Val) -> Val {
    let out = dict! {};
    let keys = ST::TECH_MODS().to_list();
    keys.extend(&tup!["entrench", "shell"]);
    for (si, side) in bt.at("sides").iter().enumerate() {
        let regs: Vec<(Val, Val, Val)> = g.side_units(bt, si as i64).iter().map(|x| x.triple()).collect();
        let mut regs = regs;
        if side.at("node").is_some() {
            let n = g.nodes.at(&side.at("node"));
            regs.extend(n.at("garrison").iter().map(|r| (n.at("owner"), r, Val::None)));
        }
        for (o, r, a) in regs {
            // (talents du général : SPEC-GENERAUX.md)
            if g.reg_lag(o.s(), &r).truthy() || a.or(dict! {}).get("gen").or(dict! {}).get("talents").truthy() {
                let md = g.reg_mods(o.s(), &r, &a);
                out.set(r.at("id"), Val::dict_from(keys.iter().filter(|k| md.get(k).truthy()).map(|k| (k.clone(), md.at(&k))).collect()));
            }
        }
    }
    out
}

/// Plan de bataille de campagne (rules.PLANS) de la plus grosse armée du camp : l'IA de combat le reprend.
///
/// Python (bridge.py, l. 268-275) : `def _side_plan(g, bt, si)`
/// Rend a['pl'] de la plus grosse armée (premier en cas d'égalité : `>` strict), ou None.
pub fn _side_plan(g: &Game, bt: &Val, si: i64) -> Val {
    let mut best = Val::None;
    for aid in bt.at("sides").at(si).at("armies").iter() {
        let a = g.armies.get(&aid);
        if a.truthy() && (best.is_none() || g.army_men(&a) > g.army_men(&best)) {
            best = a;
        }
    }
    if best.truthy() {
        best.get("pl")
    } else {
        Val::None
    }
}

/// Python (bridge.py, l. 278-339) : `def make_units(g, bt, manual=False)`
/// manual : défaut false. Rend la liste des unités (dict, units.rs). `name_for` : fonction imbriquée, `count` : dict
/// local à clés (code, type). `U::unit_name(Some(g), …)`, `U::from_reg(r, si, owner, name, army, src, nid, ctrl)`
/// (défauts du Python : src 'campagne'…, voir units.rs). `Game::gen_title(gen)` (fonction associée).
/// `AA.fort_eff(g, n)` → `AA::fort_eff(g, n, &Val::None)` (army_actions/defense.rs : `fort_eff(g: &Game, n: &Val, att: &Val) -> f64`).
pub fn make_units(g: &mut Game, bt: &Val, manual: bool) -> Val {
    let units = list![];
    let mut count: HashMap<(String, String), i64> = HashMap::new();

    fn name_for(g: &Game, count: &mut HashMap<(String, String), i64>, owner: &Val, typ: &str) -> String {
        let n = count.entry((owner.string(), typ.to_string())).or_insert(0);
        *n += 1;
        U::unit_name(Some(g), owner, typ, *n)
    }

    for (si, side) in bt.at("sides").iter().enumerate() {
        let si = si as i64;
        for aid in side.at("armies").iter() {
            let a = g.armies.get(&aid);
            if !a.truthy() || !a.atb("regs") {
                continue;
            }
            let owner = a.at("owner");
            let ctrl = if manual && owner == g.player { "joueur" } else { "ia" };
            let gen = a.get("gen");
            let gname = format!("{}{}", a.at("name"), if gen.truthy() { format!(" ({})", Game::gen_title(&gen)) } else { String::new() });
            for r in a.at("regs").iter() {
                let nm = name_for(g, &mut count, &owner, r.at("type").s());
                let u = U::from_reg(&r, si, &owner, &nm, &aid, "reg", &Val::None, ctrl);
                let m = min2(100.0, u.atf("morale") + g.moral_medailles(&a)); // (médailles du général)
                u.set("morale", m);
                u.set("morale0", m);
                u.set("group", &aid);
                u.set("gname", &gname);
                units.push(u);
            }
            if gen.truthy() {
                let u = U::general(&(Val::from("g") + &aid), si, &owner, &gen, &aid, ctrl);
                u.set("name", Game::gen_title(&gen));
                u.set("group", &aid);
                u.set("gname", &gname);
                units.push(u);
            }
            let u = U::wagon(&(Val::from("w") + &aid), si, &owner, &aid, &format!("Chariot de munitions ({})", a.at("name")), ctrl);
            u.set("group", &aid);
            u.set("gname", &gname);
            units.push(u);
        }
        let nid = side.at("node");
        if nid.is_some() {
            let n = g.nodes.at(&nid);
            let o = n.at("owner");
            let pname = g.geo.nodes.at(&nid).at("name");
            let grp = format!("p{nid}");
            let gname = format!("Garnison de {pname}");
            let ctrl = if manual && o == g.player { "joueur" } else { "ia" };
            for r in n.at("garrison").iter() {
                let nm = name_for(g, &mut count, &o, r.at("type").s());
                let u = U::from_reg(&r, si, &o, &nm, &Val::None, "garnison", &nid, ctrl);
                u.set("group", &grp);
                u.set("gname", &gname);
                units.push(u);
            }
            let mil = n.at("milice");
            if mil >= 5 {
                let k = 1.max(py::int((mil.f() / MILICE_COMPANY as f64).ceil()));
                let fort = AA::fort_eff(g, &n, &Val::None);
                let mor = min2(100.0, 55.0 + 15.0 * fort);
                let arm = g.arm_level(o.s(), "inf");
                for i in 0..k {
                    let uid = if i == 0 { format!("m{nid}") } else { format!("m{nid}-{}", i + 1) };
                    let nm = if k == 1 { format!("Milice de {pname}") } else { format!("Milice de {pname} ({})", i + 1) };
                    let u = U::milice(&Val::from(uid), si, &o, mil.f() / k as f64, mor, arm, &nm, &nid, ctrl);
                    u.set("group", &grp);
                    u.set("gname", &gname);
                    units.push(u);
                }
            }
            // les canons du rempart : une batterie fixe par niveau de fortification
            let k = g.fort_guns(&n);
            for i in 0..k {
                let nm = if k == 1 { format!("Canons du rempart de {pname}") } else { format!("Canons du rempart de {pname} ({})", i + 1) };
                let u = U::from_reg(&g.fort_gun_reg(&n, i), si, &o, &nm, &Val::None, "rempart", &nid, ctrl);
                u.set("form", "batterie");
                u.set("group", &grp);
                u.set("gname", &gname);
                units.push(u);
            }
        }
    }
    units
}

/// « Commander la bataille » : le joueur déploie et mène ses troupes (manual) ; sinon l'IA des deux camps.
///
/// Python (bridge.py, l. 342-353) : `def create(g, bt, manual=True)`
/// manual : défaut true. `TacticalBattle(g.geo, spec, units, ai_sides)` → `TacticalBattle::new(g.geo.clone(), …)`.
/// Ne range pas la bataille dans g (l'appelant le fait).
pub fn create(g: &mut Game, bt: &Val, manual: bool) -> Box<TacticalBattle> {
    let spec = make_spec(g, bt);
    if !manual {
        spec.set("me", Val::None);
    }
    let units = make_units(g, bt, manual);
    let ai_sides: Val = (0..2i64)
        .filter(|&s| !units.iter().any(|u| u.at("side") == s && u.at("ctrl") == "joueur"))
        .map(Val::from)
        .collect();
    let mut tb = Box::new(TacticalBattle::new(g.geo.clone(), &spec, &units, &ai_sides));
    for s in 0..2 {
        default_deploy(&mut tb, s);
    }
    tb.warm();
    tb
}

/// « Donner mes ordres » : la bataille sans commandement du joueur ; l'ennemi se déploie, puis le camp du joueur
/// selon les ordres par défaut (il les change ensuite : set_orders).
///
/// Python (bridge.py, l. 356-374) : `def create_orders(g, bt)`
/// None : le joueur n'a pas de troupes dans cette bataille (`spec['me'] is None`).
pub fn create_orders(g: &mut Game, bt: &Val) -> Option<Box<TacticalBattle>> {
    let spec = make_spec(g, bt);
    let me = spec.at("me");
    if me.is_none() {
        return None;
    }
    let me = me.i();
    spec.set("mode", "ordres");
    spec.set("orders", list![Val::None, Val::None]);
    let lv = list![&g.difficulty, &g.difficulty];
    lv.set(me, ACCEL_LEVEL); // (ses officiers : une IA correcte, quelle que soit la difficulté de l'adversaire)
    spec.set("ai_levels", lv);
    let units = make_units(g, bt, false);
    let mut tb = Box::new(TacticalBattle::new(g.geo.clone(), &spec, &units, &list![0, 1]));
    default_deploy(&mut tb, 1 - me);
    let o = OR::defaults(&tb, me, &Val::None);
    spec.at("orders").set(me, o);
    default_deploy(&mut tb, me);
    tb.warm();
    Some(tb)
}

pub const PLAN_STEP: i64 = 2; // le plan de la fenêtre de bataille : une case sur deux (75 × 50 pour 3 × 2 km)

/// Le plan de la position ennemie (fenêtre de bataille) : le terrain en petites cases, vos troupes, les zones des
/// deux armées, et l'ennemi tel que vos éclaireurs le voient s'ils sont assez nombreux (orders.scouting).
///
/// Python (bridge.py, l. 380-396) : `def plan_view(tb)`
/// `tb.t` → `tb.map.t` ; `tb.seen_by[me]` : un set (appartenance seulement). tb.me n'est pas None ici (`.i()`).
pub fn plan_view(tb: &mut TacticalBattle) -> Val {
    let me = tb.me.i();
    tb._update_vision();
    let (cols, rows) = (COLS / PLAN_STEP, ROWS / PLAN_STEP);
    let mut t = String::new();
    for j in 0..rows {
        for i in 0..cols {
            t.push((97 + tb.map.t[(j * PLAN_STEP * COLS + i * PLAN_STEP) as usize]) as char);
        }
    }
    let seen = if OR::scouting(tb, me) >= 0.15 { tb.seen_by.at(me) } else { pyset![] };
    let units = list![];
    for u in tb.units.iter() {
        if !U::alive(&u) || u.at("cls") == "chariot" || u.at("cls") == "general" || !(u.at("side") == me || seen.has(u.at("id"))) {
            continue;
        }
        let (w, d) = U::footprint(&u);
        units.push(dict! {"s" => u.at("side"), "c" => u.at("cls"), "x" => py::round(u.atf("x")), "y" => py::round(u.atf("y")),
            "r" => py::round_n(u.atf("dir"), 2), "w" => py::round(w), "d" => py::round(d)});
    }
    dict! {"cols" => cols, "rows" => rows, "cell" => CELL * PLAN_STEP, "t" => t, "units" => units, "me" => me,
        "seen" => seen.truthy(), "zones" => list![tb.ai_zone(0), tb.ai_zone(1)], "colors" => tb.spec.at("colors"),
        "place" => tb.place_info().truthy()}
}

/// Python (bridge.py, l. 399-401) : `def _livres(g, tb)`
/// Rend le trésor du camp du joueur (nombre) ou None.
pub fn _livres(g: &Game, tb: &TacticalBattle) -> Val {
    let o = tb.spec.at("owners").at(&tb.me);
    if g.factions.has(&o) {
        g.factions.at(&o).at("res").at("livres")
    } else {
        Val::None
    }
}

/// La fenêtre des ordres : les choix (et ce qui les verrouille), les ordres en cours, l'avis, les éclaireurs.
///
/// Python (bridge.py, l. 404-409) : `def orders_view(g, tb)`
/// `OR::advise`, `OR::report` veulent `&mut TacticalBattle`.
pub fn orders_view(g: &Game, tb: &mut TacticalBattle) -> Val {
    let me = tb.me.i();
    let o = OR::of(tb, me).or(dict! {});
    let groups = OR::groups(tb, me, &_livres(g, tb));
    let advice = OR::advise(tb, me, &o);
    let report = OR::report(tb, me);
    dict! {"groups" => groups, "tabs" => OR::TABS(), "orders" => &o, "advice" => advice, "report" => report,
        "place" => tb.place_info().truthy(), "side" => me, "arrows" => OR::arrows(tb, me, &o)}
}

/// Le joueur change ses ordres : ses troupes se redéploient selon eux ; go : la bataille commence ; skip : elle se
/// joue au plus vite (appareil sans 3D).
///
/// Python (bridge.py, l. 412-434) : `def set_orders(g, tb, raw, go=False, skip=False)`
/// tb : la bataille en cours, sortie de g.tactical par l'appelant (command) le temps de l'appel ; raw : ce que le
/// navigateur envoie. Défauts : go = false, skip = false. Rend {ok, msg | ordres}. `**p` de tb.order : un dict.
pub fn set_orders(g: &mut Game, tb: &mut TacticalBattle, raw: &Val, go: bool, skip: bool) -> Val {
    if tb.phase != "deploiement" || tb.spec.get("mode") != "ordres" {
        return dict! {"ok" => false, "msg" => "La bataille est déjà engagée."};
    }
    let me = tb.me.i();
    let o = OR::clean(tb, me, raw, &_livres(g, tb));
    tb.spec.at("orders").set(me, &o);
    default_deploy(tb, me);
    if !go {
        return dict! {"ok" => true, "ordres" => orders_view(g, tb)};
    }
    if o.get("ruse") == "deserteurs" {
        g.factions.at(tb.spec.at("owners").at(me)).at("res").dec("livres", OR::FEINT_COST);
    }
    let (ok, msg) = tb.start();
    if !ok {
        return dict! {"ok" => false, "msg" => msg};
    }
    OR::setup(tb, me, &o);
    if o.get("ruse") == "deserteurs" {
        AI::shift_reserve(tb, 1 - me, OR::wing_sign(&o), &Val::from("des déserteurs annoncent l'attaque sur l'aile : la réserve et la cavalerie s'y portent."));
    }
    tb.replay = dict! {"real" => 0.0, "k" => 1, "skip" => skip};
    tb.log("Vos officiers engagent la bataille selon vos ordres.", &Val::None, &Val::None);
    dict! {"ok" => true, "msg" => "La bataille commence."}
}

/// Déploiement de départ (l'IA de secours, pour toutes les unités du camp, que le joueur retouchera).
///
/// Python (bridge.py, l. 437-453) : `def default_deploy(tb, side)`
/// try / finally : rien n'est rattrapé ; les ctrl sont remis après `AI::deploy` (une panique arrête tout de toute
/// façon). `tb.deploy(side, rest, cx, cy, &Val::None, &Val::None, "any")`.
pub fn default_deploy(tb: &mut TacticalBattle, side: i64) {
    let saved = dict! {};
    for u in tb.units.iter() {
        if u.at("side") == side {
            saved.set(u.at("id"), u.at("ctrl"));
        }
    }
    for u in tb.units.iter() {
        if u.at("side") == side {
            u.set("ctrl", "ia");
        }
    }
    AI::deploy(tb, side);
    for u in tb.units.iter() {
        if saved.has(u.at("id")) {
            u.set("ctrl", saved.at(u.at("id")));
        }
    }
    // unités oubliées : au centre de la zone
    let z = tb.zone(side);
    let rest: Val = tb.units.iter().filter(|u| u.at("side") == side && u.atf("x") == 0.0 && u.atf("y") == 0.0).map(|u| u.at("id")).collect();
    if rest.truthy() {
        tb.deploy(side, &rest, (&z.at(0) + &z.at(2)).f() / 2.0, (&z.at(1) + &z.at(3)).f() / 2.0, &Val::None, &Val::None, "any");
    }
}

// ================================================================== boucle et fin

/// Appelé par App.loop toutes les 0,1 s : fait avancer la bataille tactique en cours (à l'allure du film, ou en
/// accéléré : autant de pas que le permet ACCEL_BUDGET).
///
/// Python (bridge.py, l. 457-472) : `def tick(g, real_dt)`
/// La bataille en cours est sortie de g.tactical le temps de l'avancer, puis remise, ou passée à finish si elle est
/// finie ; `bid not in g.battles` : elle est jetée. Rend le nombre de pas.
pub fn tick(g: &mut Game, real_dt: f64) -> i64 {
    ensure(g);
    let Some(mut tb) = g.tactical.take() else { return 0 };
    if !g.battles.has(tb.bid.as_str()) {
        // paix signée ou place passée à un autre camp pendant la bataille : elle s'arrête sans vainqueur
        return 0;
    }
    let n = advance(&mut tb, real_dt);
    if tb.phase == "fin" {
        finish(g, tb);
    } else {
        g.tactical = Some(tb);
    }
    n
}

/// La bataille avance à l'allure du film (ou au plus vite après « Passer », ou en accéléré) ; rien tant que le
/// joueur donne ses ordres ou qu'il doit répondre au moment décisif.
///
/// Python (bridge.py, l. 475-489) : `def advance(tb, real_dt)`
/// rp est tb.replay (le même dict). `tb.run_for(ACCEL_BUDGET, &Val::None)`, `tb.advance(real_dt, &Val::None)`.
/// Appelée aussi par skirmish::tick.
pub fn advance(tb: &mut TacticalBattle, real_dt: f64) -> i64 {
    let rp = tb.replay.clone();
    if rp.is_none() {
        return if tb.accel { tb.run_for(ACCEL_BUDGET, &Val::None) } else { tb.advance(real_dt, &Val::None) }; // (manuel : à sa vitesse)
    }
    if tb.phase != "combat" || tb.ask.truthy() {
        return 0;
    }
    rp.set("real", rp.get_or("real", 0.0) + real_dt);
    if rp.getb("skip") {
        return tb.run_for(ACCEL_BUDGET, &Val::None);
    }
    let real = rp.atf("real");
    let m = if real > REPLAY_LONGER { 4.0 } else if real > REPLAY_LONG { 2.0 } else { 1.0 };
    let rate = REPLAY_RATE * max2(rp.get_or("k", 1).f(), m);
    // (un serveur qui peine ne prend pas plus d'une seconde de retard : le film ralentit plutôt que de sauter)
    let until = min2(max2(rp.get_or("until", tb.clock).f(), tb.clock) + real_dt * rate, tb.clock + rate);
    rp.set("until", until);
    tb.run_for(ACCEL_BUDGET, &rp.at("until"))
}

/// Synchrone (essais, bancs) : « Finir automatiquement », puis toute la suite de la bataille d'un coup, sans budget
/// de temps, et le report en campagne comme pour une bataille jouée.
///
/// Python (bridge.py, l. 492-500) : `def resolve_now(g, tb)`
/// SIGNATURE DIFFÉRENTE : Python `resolve_now(g, tb)` n'est appelé qu'avec `tb = g.tactical[bid]` (essais, bancs).
/// En Rust : la bataille en cours (g.tactical), sortie de son champ ; rien s'il n'y en a pas. `g.tactical.get(tb.bid)
/// is tb` est alors vrai : elle passe par finish (dans g.tac_done).
pub fn resolve_now(g: &mut Game) {
    let Some(mut tb) = g.tactical.take() else { return };
    if tb.phase != "fin" {
        if !tb.accel {
            tb.autofinish();
        }
        tb.run_to_end();
    }
    finish(g, tb);
}

/// Reporte le résultat sur les régiments de campagne, puis engine.end_battle comme une bataille automatique.
///
/// Python (bridge.py, l. 503-584) : `def finish(g, tb)`
/// tb : la bataille, sortie de g.tactical par l'appelant (`g.tactical.pop(bid, None)` : si g.tactical tient encore
/// une bataille de ce bid, la vider). `g.tac_done = {bid: tb}` → `g.tac_done = Some(tb)` (avant end_battle, qui peut
/// la relire par find) ; la suite lit tb dans g.tac_done. `g.capturer_general(a, vainqueur, true)` (défaut reste),
/// `g.blesser_general(a, &Val::None)` (défaut gravite).
pub fn finish(g: &mut Game, tb: Box<TacticalBattle>) {
    let bid = tb.bid.clone();
    if g.tactical.as_ref().is_some_and(|t| t.bid == bid) {
        g.tactical = None;
    }
    // (tb est rangée dans tac_done : ses objets partagés restent à portée de main)
    let (res, units, me, spec) = (tb.result.clone(), tb.units.clone(), tb.me.clone(), tb.spec.clone());
    g.tac_done = Some(tb);
    let bt = g.battles.get(bid.as_str());
    if !bt.truthy() || !res.truthy() {
        return;
    }
    let winner = res.ati("winner");
    let mut disengage = res.atb("disengage");
    let loser = 1 - winner;
    if disengage && loser == 1 && bt.at("sides").at(1).at("node").is_some() {
        disengage = false; // le défenseur d'une place qui décroche l'abandonne
    }
    let mil = dict! {};
    for u in units.iter() {
        let r_ = res.at("units").get(u.at("id"));
        if r_.is_none() {
            continue;
        }
        let src = u.at("src");
        if src == "milice" {
            mil.set(u.at("nid"), mil.get_or(u.at("nid"), 0.0).f() + max2(0.0, r_.atf("men")));
            continue;
        }
        if src == "general" {
            // le sort de l'état-major est celui du général (SPEC-GENERAUX.md)
            let a = g.armies.get(u.at("army"));
            if a.truthy() && a.getb("gen") {
                if r_.at("captured") >= 15 {
                    let v = units.iter().find(|x| x.at("side") != u.at("side")).map_or(Val::None, |x| x.at("owner"));
                    g.capturer_general(&a, &v, true);
                } else if r_.at("men") <= 3 {
                    g.tuer_general(&a);
                } else if r_.atb("wounded") {
                    g.blesser_general(&a, &Val::None);
                }
            }
            continue;
        }
        if src == "chariot" {
            continue;
        }
        let regs = if src == "garnison" {
            g.nodes.at(u.at("nid")).at("garrison")
        } else {
            g.armies.get(u.at("army")).or(dict! {}).get_or("regs", list![])
        };
        let Some(reg) = regs.iter().find(|r| r.at("id") == u.at("id")) else { continue };
        reg.set("n", max2(0.0, r_.atf("men")));
        let owner = u.at("owner");
        if g.factions.has(&owner) && g.mod_(owner.s(), "wounded", 0.0) != 0.0 {
            // Croix-Rouge : rendus par end_battle (pas les prisonniers)
            reg.set("wnd", max2(0.0, (&r_.at("lost") - &r_.get_or("captured", 0)).f()) * g.mod_(owner.s(), "wounded", 0.0));
        }
        reg.set("morale", max2(5.0, min2(100.0, r_.atf("morale"))));
        let gain = r_.atf("xp") - if u.at("side") == winner { 8.0 } else { 0.0 }; // end_battle donne +8 aux vainqueurs
        reg.set("xp", min2(100.0, reg.atf("xp") + max2(0.0, gain)));
        reg.set("ammo", max2(0.0, min2(100.0, r_.atf("ammo"))));
        reg.set("fat", max2(0.0, min2(100.0, r_.atf("fat"))));
    }
    for (nid, men) in mil.items() {
        g.nodes.at(&nid).set("milice", men);
    }
    for si in 0..2i64 {
        let side = bt.at("sides").at(si);
        side.inc("lost", res.at("lost").at(si));
        let nd = side.at("node");
        if nd.is_some() {
            let n = g.nodes.at(&nd);
            n.set("garrison", n.at("garrison").iter().filter(|r| r.at("n") >= 5).collect::<Val>());
        }
        for aid in side.at("armies").iter() {
            let a = g.armies.get(&aid);
            if !a.truthy() {
                side.at("armies").remove(&aid);
                continue;
            }
            a.set("regs", a.at("regs").iter().filter(|r| r.at("n") >= 5).collect::<Val>());
            if !a.atb("regs") {
                side.at("armies").remove(&aid);
                g.armies.del(&aid);
            }
        }
    }
    // la poursuite et les prisonniers ont déjà eu lieu sur le champ de bataille : la campagne reprend ce décompte
    // (res['prisoners'][i] : hommes du camp i faits prisonniers) au lieu de recalculer les siens
    bt.set("tac", dict! {"prisoners" => list![py::int_v(&res.at("prisoners").at(0)), py::int_v(&res.at("prisoners").at(1))]});
    let nd = bt.at("sides").iter().map(|s| s.at("node")).find(|n| n.is_some());
    if let Some(nd) = nd {
        // les maisons touchées, brûlées, en ruine restent après la bataille (les ruines d'avant y sont déjà comptées)
        let n = g.nodes.at(&nd);
        let old = n.get_or("deg", 0.0).f();
        let deg = g.tac_done.as_ref().unwrap().degats_ville();
        g.damage_town(&n, max2(0.0, (deg - old) / max2(1e-6, 1.0 - old)));
    }
    g.end_battle(&bt, winner, disengage);
    // le mois s'était arrêté sur cette bataille : la raison affichée dit maintenant son issue
    let tr = g.tour.clone();
    let stop = if tr.is_dict() { tr.get("stop") } else { Val::None };
    if stop.is_dict() && stop.get("sel") == list!["battle", bt.at("id")] && me.is_some() {
        let issue = if !disengage {
            if me == winner {
                "Victoire"
            } else {
                "Défaite"
            }
        } else if me == winner {
            "L'ennemi décroche"
        } else {
            "Retraite"
        };
        stop.set("text", format!("{issue} — {}. À vous de jouer.", spec.get("title").or("bataille")));
        stop.set("sel", Val::None);
    }
    g.speed_idx = 0;
    if TT::planning(g) {
        TT::settle(g); // tour par tour : l'armée battue se replie tout de suite
    }
}

// ================================================================== sauvegarde

/// Python (bridge.py, l. 588-591) : `def save_into(g, d)`
/// d : le dict de la sauvegarde. `{bid: tb.to_dict()}` pour la bataille en cours.
pub fn save_into(g: &mut Game, d: &Val) {
    ensure(g);
    d.set("settings", g.settings.copy());
    let t = dict! {};
    if let Some(tb) = &g.tactical {
        t.set(tb.bid.as_str(), tb.to_dict());
    }
    d.set("tactical", t);
}

/// Python (bridge.py, l. 594-608) : `def load_from(g, d)`
/// `try: TacticalBattle.from_dict(…) except Exception` : `TacticalBattle::from_dict` rend `Err` si la sauvegarde
/// est illisible. `traceback.print_exc()` → `eprintln!`. Une seule bataille (g.tactical : Option).
pub fn load_from(g: &mut Game, d: &Val) {
    g.settings = d.get("settings").or(dict! {}).copy();
    g.tactical = None;
    g.tac_done = None;
    ensure(g);
    for (bid, x) in d.get("tactical").or(dict! {}).items() {
        if g.battles.has(&bid) {
            match TacticalBattle::from_dict(g.geo.clone(), &x) {
                Ok(tb) => g.tactical = Some(Box::new(tb)), // (sur ordres ou à la main : elle reprend ainsi)
                Err(e) => {
                    eprintln!("bataille {bid} illisible : {e}");
                    g.battles.at(&bid).set("mode", "attente"); // bataille illisible : on redemande au joueur
                }
            }
        }
    }
    for bt in g.battles.values() {
        let m = bt.get("mode");
        if (m == "ordres" || m == "manuel") && !g.tactical.as_ref().is_some_and(|tb| bt.at("id") == tb.bid.as_str()) {
            bt.set("mode", "attente");
        }
    }
}

/// Anciennes sauvegardes : munitions pleines, hommes frais, batailles automatiques.
///
/// Python (bridge.py, l. 611-623) : `def migrate(g)`
pub fn migrate(g: &mut Game) {
    ensure(g);
    for a in g.armies.values() {
        for r in a.at("regs").iter() {
            r.setdefault("ammo", 100.0);
            r.setdefault("fat", 0.0);
        }
    }
    for n in g.nodes.iter() {
        for r in n.at("garrison").iter() {
            r.setdefault("ammo", 100.0);
            r.setdefault("fat", 0.0);
        }
    }
    for bt in g.battles.values() {
        bt.setdefault("mode", "auto");
    }
}

// ================================================================== vues et commandes

/// Python (bridge.py, l. 627-633) : `def tac_view(g)`
/// Rend {bid, phase, title} ou None.
pub fn tac_view(g: &mut Game) -> Val {
    ensure(g);
    if let Some(tb) = &g.tactical {
        return dict! {"bid" => &tb.bid, "phase" => &tb.phase, "title" => tb.spec.get("title")};
    }
    if let Some(tb) = &g.tac_done {
        return dict! {"bid" => &tb.bid, "phase" => "fin", "title" => tb.spec.get("title")};
    }
    Val::None
}

/// Où est la bataille de ce bid (find) : 1 en cours, 2 finie, 0 nulle part.
fn _ou(g: &Game, bid: &Val) -> u8 {
    if g.tactical.as_ref().is_some_and(|tb| *bid == tb.bid.as_str()) {
        return 1;
    }
    if g.tac_done.as_ref().is_some_and(|tb| *bid == tb.bid.as_str()) {
        return 2;
    }
    if !bid.truthy() {
        if g.tactical.is_some() {
            return 1;
        }
        if g.tac_done.is_some() {
            return 2;
        }
    }
    0
}

/// Python (bridge.py, l. 636-645) : `def find(g, bid)`
/// bid : texte, '' ou None. `bid in g.tactical` → `g.tactical` tient la bataille de ce bid (`tb.bid == bid`) ;
/// `not bid` : la première, en cours puis finie. Appelle ensure.
pub fn find<'a>(g: &'a mut Game, bid: &Val) -> Option<&'a mut TacticalBattle> {
    ensure(g);
    match _ou(g, bid) {
        1 => g.tactical.as_deref_mut(),
        2 => g.tac_done.as_deref_mut(),
        _ => None,
    }
}

/// Python (bridge.py, l. 648-670) : `def battle_view(g, bid, since=0)`
/// since : défaut 0. Rend la vue ou None. `orders_view(g, tb)` et `ST::of_unit(&u, tb)` veulent tb en `&mut` à côté
/// de g : sortir la bataille de son champ (tactical ou tac_done) le temps de la vue, puis l'y remettre.
pub fn battle_view(g: &mut Game, bid: &Val, since: i64) -> Val {
    ensure(g);
    let ou = _ou(g, bid);
    let mut tb = match ou {
        1 => g.tactical.take().unwrap(),
        2 => g.tac_done.take().unwrap(),
        _ => return Val::None,
    };
    let v = tb.view(&tb.me.clone(), since);
    if tb.spec.get("mode") == "ordres" {
        v.set("mode", "ordres");
        if tb.phase == "deploiement" && since == 0 {
            v.set("ordres", orders_view(g, &mut tb));
        }
        if tb.replay.is_some() {
            v.set("replay", dict! {"k" => tb.replay.get_or("k", 1), "skip" => tb.replay.getb("skip")});
            if tb.ask.truthy() && tb.ask.get("side") == tb.me {
                v.set("ask", dict! {"text" => tb.ask.at("text"), "key" => tb.ask.at("key")});
            }
            let mem = tb.ai_mem.get(format!("s{}", tb.me)).or(dict! {});
            let notes: Val = mem
                .get("journal")
                .or(list![])
                .slice(Some(-12), None)
                .iter()
                .map(|e| e.pair().1)
                .filter(|txt| !DULL().iter().any(|k| txt.has(&k)))
                .collect();
            v.set("notes", notes.slice(Some(-4), None));
            v.set("fx", v.at("fx").slice(Some(-ACCEL_FX), None)); // (la bataille défile vite : les derniers effets suffisent)
        }
    }
    for d in v.at("units").iter() {
        // valeurs chiffrées de mes troupes (stats.py) ; l'ennemi reste dans le brouillard
        let u = tb.by_id.get(d.at("id"));
        if u.is_some() && (tb.me.is_none() || u.at("side") == tb.me) {
            d.set("stats", ST::of_unit(&u, &mut tb));
            if u.at("cls") == "artillerie" && tb.is_wood(u.atf("x"), u.atf("y")) {
                d.set("camo", 1); // (canons camouflés dans un bois : le panneau du régiment le dit)
            }
        }
    }
    if ou == 1 {
        g.tactical = Some(tb);
    } else {
        g.tac_done = Some(tb);
    }
    v
}

/// Python (bridge.py, l. 673-677) : `def map_view(g, bid)`
/// Rend `tb.map_view()` ou None.
pub fn map_view(g: &mut Game, bid: &Val) -> Val {
    match find(g, bid) {
        Some(tb) => tb.map_view(),
        None => Val::None,
    }
}

/// Le joueur reprend la campagne : on oublie la bataille terminée. Refus si la campagne est figée.
///
/// Python (bridge.py, l. 680-691) : `def on_speed(g, v)`
/// v : rang de vitesse demandé. `g.tac_done = {}` → None. `AA::asking(g: &mut Game) -> Val` (une armée ou None),
/// `AA::place(g: &Game, nid: i64) -> String` (army_actions).
pub fn on_speed(g: &mut Game, v: i64) -> (bool, String) {
    ensure(g);
    let a = if v > 0 { AA::asking(g) } else { Val::None };
    if a.truthy() {
        return (false, format!("La {} attend vos ordres devant {}.", a.at("name"), AA::place(g, a.at("ask").ati("node"))));
    }
    if v > 0 && frozen(g) {
        let msg = if waiting(g) {
            "Une bataille attend vos ordres : commandez-la ou laissez la résolution automatique."
        } else {
            "Une bataille est en cours sur le champ de bataille."
        };
        return (false, msg.to_string());
    }
    if v > 0 {
        g.tac_done = None;
    }
    (true, String::new())
}

/// Armée engagée dans une bataille sur ordres ou commandée : ses ordres se donnent sur le champ de bataille.
///
/// Python (bridge.py, l. 694-700) : `def army_locked(g, aid)`
/// aid : ce que le navigateur envoie (texte ou None).
pub fn army_locked(g: &Game, aid: &Val) -> bool {
    let a = if aid.truthy() { g.armies.get(aid) } else { Val::None };
    if !a.truthy() || !a.getb("battle") {
        return false;
    }
    let bt = g.battles.get(a.at("battle"));
    bt.truthy() && (bt.get("mode") == "ordres" || bt.get("mode") == "manuel")
}

/// Sous-commandes `tac` (contrat, § 6). Renvoie {ok, msg}.
///
/// Python (bridge.py, l. 703-797) : `def command(g, body)`
/// body : la commande du navigateur (dict). Rend {ok, msg…}. Les sous-commandes qui agissent sur la bataille en cours
/// la sortent de g.tactical et l'y remettent (sauf cancel ; _manual_command la reçoit en propre).
/// `g.tactical[bt['id']] = tb` → `g.tactical = Some(tb)` ; `g.tac_preview.pop(bt['id'], None)` : la bataille préparée
/// si son bid est bt['id'] ; `g.tac_preview = {bt['id']: tb}` : la garder, et rendre `plan_view` (tb reste dans
/// tac_preview). Une valeur invalide du navigateur (KeyError, ValueError…) panique : le serveur rattrape toute
/// erreur d'une commande, comme server.py (« Commande invalide (…) »).
pub fn command(g: &mut Game, body: &Val) -> Val {
    ensure(g);
    let sub = body.get("sub");
    if sub == "settings" {
        let v = body.get("battles");
        if !SETTINGS().has(&v) {
            return dict! {"ok" => false, "msg" => "Réglage inconnu."};
        }
        g.settings.set("battles", &v);
        let msg = dict! {"demander" => "Toujours demander avant une bataille.",
            "auto" => "Batailles toujours résolues automatiquement.",
            "auto_petites" => "Escarmouches résolues automatiquement."}
        .at(&v);
        return dict! {"ok" => true, "msg" => msg};
    }
    // la bataille préparée pour cette bataille de campagne (tac_preview), sortie de son champ
    let preparee = |g: &mut Game, bt: &Val| -> Option<Box<TacticalBattle>> {
        if g.tac_preview.as_ref().is_some_and(|tb| bt.at("id") == tb.bid.as_str()) {
            g.tac_preview.take()
        } else {
            None
        }
    };
    if sub == "preview" {
        // la fenêtre de bataille s'ouvre : la bataille se prépare (carte, ennemi déployé) pour en montrer le plan
        let bt = g.battles.get(body.get("bid"));
        if !bt.truthy() || bt.get("mode") != "attente" {
            return dict! {"ok" => false, "msg" => "Aucune bataille en attente."};
        }
        let tb = match preparee(g, &bt) {
            Some(tb) => Some(tb),
            None => create_orders(g, &bt),
        };
        let Some(mut tb) = tb else {
            return dict! {"ok" => false, "msg" => "Vous n'avez pas de troupes dans cette bataille."};
        };
        let plan = plan_view(&mut tb);
        g.tac_preview = Some(tb);
        return dict! {"ok" => true, "plan" => plan};
    }
    if sub == "choose" {
        let bt = g.battles.get(body.get("bid"));
        if !bt.truthy() || bt.get("mode") != "attente" {
            return dict! {"ok" => false, "msg" => "Aucune bataille en attente."};
        }
        let mode = body.get("mode");
        let pre = preparee(g, &bt);
        if mode == "auto" {
            bt.set("mode", "auto");
            if TT::planning(g) {
                TT::settle(g); // tour par tour : le général règle la bataille sur-le-champ, puis les marches suspendues reprennent
                return dict! {"ok" => true, "msg" => "Le général a commandé la bataille."};
            }
            return dict! {"ok" => true, "msg" => "Le général commande : résolution automatique."};
        }
        if mode != "manuel" && mode != "ordres" {
            return dict! {"ok" => false, "msg" => "Mode inconnu."};
        }
        if g.tactical.is_some() {
            return dict! {"ok" => false, "msg" => "Une autre bataille est déjà en cours."};
        }
        let tb = if mode == "ordres" {
            match pre {
                Some(tb) => Some(tb),
                None => create_orders(g, &bt),
            }
        } else {
            Some(create(g, &bt, true))
        };
        let tb = match tb {
            Some(tb) if tb.me.is_some() => tb,
            _ => {
                bt.set("mode", "auto");
                return dict! {"ok" => false, "msg" => "Vous n'avez pas de troupes dans cette bataille."};
            }
        };
        bt.set("mode", &mode);
        g.tactical = Some(tb);
        g.tac_done = None;
        let msg = if mode == "ordres" { "Donnez vos ordres." } else { "Déployez vos troupes." };
        return dict! {"ok" => true, "msg" => msg, "bid" => bt.at("id")};
    }
    if sub == "close" {
        g.tac_done = None;
        return dict! {"ok" => true};
    }
    // (une seule bataille en cours : celle de body['bid'] s'il la nomme, sinon la première, c'est la même)
    let Some(mut tb) = g.tactical.take() else {
        return dict! {"ok" => false, "msg" => "Aucune bataille en cours."};
    };
    let r = 'r: {
        if sub == "piet" {
            // la boue laissée par les troupes, gardée avec la bataille (SPEC-SUITE F8) : rien d'autre ne la lit
            let png = body.get("png");
            if !valid_piet(&png) {
                break 'r dict! {"ok" => false, "msg" => "Image invalide."};
            }
            tb.piet = png;
            break 'r dict! {"ok" => true};
        }
        if sub == "unit" {
            // la fiche d'un de vos régiments : « Occuper les maisons » (là où il est), « Barricader » ; vos officiers l'y
            // laissent (ai._tenue) ; à la main, il y reste
            let kind = body.get("kind");
            if !(kind == "maisons" || kind == "barricade") || !tup![0, 1].has(&tb.me) {
                break 'r dict! {"ok" => false, "msg" => "Ordre inconnu."};
            }
            let me = tb.me.i();
            let (ok, msg) = tb.order(me, &list![body.get("id")], body.at("kind").s(), "any", &dict! {});
            break 'r dict! {"ok" => ok, "msg" => msg};
        }
        if tb.spec.get("mode") != "ordres" {
            return _manual_command(g, tb, &sub, body);
        }
        if sub == "orders" {
            break 'r set_orders(g, &mut tb, &body.get("orders"), body.getb("go"), body.getb("skip"));
        }
        if sub == "cancel" {
            // retour à la fenêtre de bataille : la bataille n'a pas commencé, on l'oublie
            if tb.phase != "deploiement" {
                break 'r dict! {"ok" => false, "msg" => "La bataille est déjà engagée."};
            }
            let bt = g.battles.get(tb.bid.as_str());
            if bt.truthy() {
                bt.set("mode", "attente");
            }
            return dict! {"ok" => true};
        }
        if sub == "answer" {
            let ok = OR::answer(&mut tb, if body.get("v") == "go" { "go" } else { "wait" });
            break 'r dict! {"ok" => ok, "msg" => if ok { "" } else { "Aucune question en attente." }};
        }
        if sub == "replay" {
            if tb.replay.is_none() {
                break 'r dict! {"ok" => false, "msg" => "La bataille n'est pas engagée."};
            }
            if tup![1, 2, 4].has(&body.get("k")) {
                tb.replay.set("k", body.at("k"));
            }
            if body.getb("skip") {
                tb.replay.set("skip", true);
                if tb.ask.truthy() {
                    OR::answer(&mut tb, "go");
                }
            }
            break 'r dict! {"ok" => true};
        }
        dict! {"ok" => false, "msg" => "Commande de bataille inconnue."}
    };
    g.tactical = Some(tb);
    r
}

/// Commandes d'une bataille commandée à la main (« Commander la bataille »).
///
/// Python (bridge.py, l. 800-838) : `def _manual_command(g, tb, sub, body)`
/// tb : la bataille en cours, sortie de g.tactical par command : la remettre dans g.tactical avant de rendre, sauf
/// si finish(g, tb) l'a passée dans tac_done (autofinish). sub : body['sub'] (texte ou None).
/// `list(body.get('units') or [])` ; `**p` → le dict p passé à `tb.order(me, &ids, kind, "joueur", &p)` (kind : `""` si
/// body['kind'] n'est pas un texte, voir battle::order).
pub fn _manual_command(g: &mut Game, tb: Box<TacticalBattle>, sub: &Val, body: &Val) -> Val {
    let mut tb = tb;
    let me = tb.me.clone();
    let r = 'r: {
        if sub == "deploy" {
            let units = body.get("units").or(list![]).to_list();
            let (x, y) = (_num(&body.get("x")), _num(&body.get("y")));
            let dir = if body.get("dir").is_none() { Val::None } else { Val::from(_num(&body.get("dir"))) };
            let (ok, msg) = tb.deploy(me.i(), &units, x, y, &dir, &body.get("form"), "joueur");
            break 'r dict! {"ok" => ok, "msg" => msg};
        }
        if sub == "start" {
            let (ok, msg) = tb.start();
            break 'r dict! {"ok" => ok, "msg" => msg};
        }
        if sub == "order" {
            let p = dict! {};
            for k in ["x", "y", "dir", "target", "form", "run", "mode", "fire", "value", "v"] {
                if body.has(k) {
                    p.set(k, body.at(k));
                }
            }
            for k in ["x", "y", "dir"] {
                if p.has(k) && p.at(k).is_some() {
                    p.set(k, _num(&p.at(k)));
                }
            }
            let units = body.get("units").or(list![]).to_list();
            let kind = body.get("kind");
            let (ok, msg) = tb.order(me.i(), &units, if kind.is_str() { kind.s() } else { "" }, "joueur", &p);
            break 'r dict! {"ok" => ok, "msg" => msg};
        }
        if sub == "speed" {
            let v = py::int(_num(&body.get_or("v", 1)));
            if ![0, 1, 2, 4].contains(&v) {
                break 'r dict! {"ok" => false, "msg" => "Vitesse invalide."};
            }
            if tb.accel {
                break 'r dict! {"ok" => false, "msg" => "Vos officiers mènent la bataille au plus vite : reprenez le commandement pour régler la vitesse."};
            }
            tb.speed = v;
            break 'r dict! {"ok" => true};
        }
        if sub == "withdraw" {
            let (ok, msg) = tb.withdraw(me.i());
            break 'r dict! {"ok" => ok, "msg" => msg};
        }
        if sub == "autofinish" {
            // la suite se joue en accéléré dans tick (le joueur la voit défiler et peut reprendre le commandement)
            let (ok, msg) = tb.autofinish();
            if tb.phase == "fin" {
                finish(g, tb);
                return dict! {"ok" => ok, "msg" => msg};
            }
            break 'r dict! {"ok" => ok, "msg" => msg};
        }
        if sub == "resume" {
            let (ok, msg) = tb.resume();
            break 'r dict! {"ok" => ok, "msg" => msg};
        }
        dict! {"ok" => false, "msg" => "Commande de bataille inconnue."}
    };
    g.tactical = Some(tb);
    r
}

/// Python (bridge.py, l. 841-845) : `def _num(v)`
/// `float(v)` → `py::float_v` (panique avec le message de Python) ; non fini : `panic!("ValueError: nombre invalide")`
/// (rattrapée par le serveur, comme toute erreur d'une commande).
pub fn _num(v: &Val) -> f64 {
    let x = py::float_v(v);
    if !x.is_finite() {
        panic!("ValueError: nombre invalide");
    }
    x
}

#[cfg(test)]
mod essais {
    use crate::py::json;

    /// zlib.crc32 et la graine de make_spec contre Python (tests/references/pont.json, outils/jumeau/pont_ref.py).
    #[test]
    fn crc32_et_graine() {
        assert_eq!(super::crc32(b"123456789"), 0xCBF4_3926);
        let r = json::loads(include_str!("../../tests/references/pont.json")).unwrap();
        for c in r.at("crc32").iter() {
            assert_eq!(super::crc32(c.at(0).s().as_bytes()) as i64, c.ati(1), "crc32({})", c.at(0));
        }
        for c in r.at("graine").iter() {
            assert_eq!(super::graine(c.at(0).s(), c.ati(1)), c.ati(2), "graine({}, {})", c.at(0), c.at(1));
        }
    }
}
