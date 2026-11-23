//! Le raccord entre la campagne et ses batailles (l'ancien game/tactics/bridge.py, moins le champ de bataille tactique,
//! supprimé : SPEC-BATAILLE.md) :
//!
//! - réglage `settings['battles']` et attente du joueur (sa stratégie, puis son choix de poursuivre) ;
//! - munitions (`ammo`, 0–100 %) et fatigue (`fat`, 0–100) persistantes des régiments en campagne ;
//! - sauvegarde, chargement et migration ; commandes `tac` (`settings`, `choose`, `pursue`).
//!
//! Conventions (en plus de PORTAGE.md) : `g: &mut Game` (`&Game` pour une lecture pure) ; `bt` : une bataille de
//! campagne (dict de g.battles).

use crate::army_actions as AA;
use crate::engine::Game;
use crate::py::{self, Val};
use crate::rules as R;
use crate::turns as TT;
use crate::{dict, py_const, tup};

py_const!(SETTINGS, tup!["demander", "auto", "auto_petites"]);
pub const SMALL_MEN: i64 = 600; // escarmouche : moins de 600 hommes en tout…

// munitions consommées par jour de bataille (% de la dotation), selon la phase et l'arme
py_const!(AUTO_AMMO, dict!{"canonnade" => dict!{"artillerie" => 80, "inf" => 10, "cavalerie" => 0},
    "fusillade" => dict!{"artillerie" => 50, "inf" => 70, "cavalerie" => 15},
    "charge" => dict!{"artillerie" => 30, "inf" => 40, "cavalerie" => 25}});
pub const AUTO_FAT: i64 = 40; // fatigue par jour de bataille automatique

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

/// Le réglage des batailles (nouvelle partie ou ancienne sauvegarde) : settings (None ou pas un dict → {}) et
/// settings['battles'].
///
/// Python (bridge.py, l. 53-65) : `def ensure(g)`
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
    g.battles.values().iter().any(en_attente) || crate::engine::navale::en_attente(g) // (SPEC-EMPIRE, module 2)
}

/// La bataille attend le joueur : sa stratégie ('attente'), ou son choix de poursuivre ou non ('poursuite').
/// (SPEC-BATAILLE.md ; pas de jumeau Python.)
pub fn en_attente(bt: &Val) -> bool {
    let m = bt.get("mode");
    m == "attente" || m == "poursuite"
}

/// La campagne est figée : une bataille attend le choix du joueur.
///
/// Python (bridge.py, l. 72-74) : `def frozen(g)`
pub fn frozen(g: &Game) -> bool {
    waiting(g)
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

// ================================================================== sauvegarde

/// Python (bridge.py, l. 588-591) : `def save_into(g, d)`
/// d : le dict de la sauvegarde.
pub fn save_into(g: &mut Game, d: &Val) {
    ensure(g);
    d.set("settings", g.settings.copy());
}

/// Python (bridge.py, l. 594-608) : `def load_from(g, d)`
/// Depuis la bataille par stratégie (SPEC-BATAILLE.md), plus aucune bataille ne se livre sur le champ de bataille : la
/// bataille tactique d'une ancienne sauvegarde (d['tactical']) n'est pas relue, et la bataille de campagne qu'elle
/// menait (mode 'ordres' ou 'manuel') redemande au joueur sa stratégie.
pub fn load_from(g: &mut Game, d: &Val) {
    g.settings = d.get("settings").or(dict! {}).copy();
    ensure(g);
    for bt in g.battles.values() {
        let m = bt.get("mode");
        if m == "ordres" || m == "manuel" {
            bt.set("mode", "attente");
            bt.pop("tac");
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

// ================================================================== commandes

/// Le joueur reprend la campagne. Refus si elle est figée.
///
/// Python (bridge.py, l. 680-691) : `def on_speed(g, v)`
/// v : rang de vitesse demandé. `AA::asking(g: &mut Game) -> Val` (une armée ou None), `AA::place(g: &Game, nid: i64)
/// -> String` (army_actions).
pub fn on_speed(g: &mut Game, v: i64) -> (bool, String) {
    ensure(g);
    let a = if v > 0 { AA::asking(g) } else { Val::None };
    if a.truthy() {
        return (false, format!("La {} attend vos ordres devant {}.", a.at("name"), AA::place(g, a.at("ask").ati("node"))));
    }
    if v > 0 && frozen(g) {
        return (false, "Une bataille attend vos ordres : choisissez votre stratégie (ou la poursuite).".to_string());
    }
    (true, String::new())
}

/// Sous-commandes `tac` : `settings` (réglage des batailles), `choose` (la stratégie du joueur) et `pursue` (poursuivre
/// ou tenir le terrain). Renvoie {ok, msg}. Les sous-commandes du champ de bataille (preview, deploy, orders, replay…)
/// n'existent plus : SPEC-BATAILLE.md.
///
/// Python (bridge.py, l. 703-797) : `def command(g, body)`
pub fn command(g: &mut Game, body: &Val) -> Val {
    ensure(g);
    let sub = body.get("sub");
    if sub == "settings" {
        let v = body.get("battles");
        if !SETTINGS().has(&v) {
            return dict! {"ok" => false, "msg" => "Réglage inconnu."};
        }
        g.settings.set("battles", &v);
        let msg = dict! {"demander" => "Vous choisirez la stratégie de chaque bataille.",
            "auto" => "Vos généraux choisissent toujours la stratégie.",
            "auto_petites" => "Vos généraux règlent seuls les escarmouches."}
        .at(&v);
        return dict! {"ok" => true, "msg" => msg};
    }
    if sub == "choose" && g.navales.has(&body.get("bid")) {
        return crate::engine::navale::choisir(g, body); // bataille navale (SPEC-EMPIRE, module 2)
    }
    if sub == "choose" {
        // la stratégie du joueur (SPEC-BATAILLE.md) : `strat` (rules.STRATS, parmi celles de la situation), ou
        // `mode: "auto"` pour laisser le général choisir. Les anciens modes « ordres » et « manuel » sont refusés.
        let bt = g.battles.get(body.get("bid"));
        if !bt.truthy() || bt.get("mode") != "attente" {
            return dict! {"ok" => false, "msg" => "Aucune bataille en attente."};
        }
        let (mode, strat) = (body.get("mode"), body.get("strat"));
        if mode == "manuel" || mode == "ordres" {
            return dict! {"ok" => false, "msg" => "Les batailles ne se livrent plus sur le champ de bataille : choisissez une stratégie."};
        }
        let mut msg = "Le général choisit sa stratégie et livre bataille.".to_string();
        if strat.is_some() {
            let Some(si) = g.camp_du_joueur(&bt) else {
                return dict! {"ok" => false, "msg" => "Vous n'avez pas de troupes dans cette bataille."};
            };
            let dispo = g.strats_dispo(&bt, si, &g.player.clone());
            match dispo.iter().find(|(id, _)| strat == id.as_str()) {
                None => return dict! {"ok" => false, "msg" => "Stratégie inconnue dans cette situation."},
                Some((_, why)) if !why.is_empty() => return dict! {"ok" => false, "msg" => why.as_str()},
                _ => {}
            }
            bt.at("sides").at(si).set("strat", &strat);
            msg = format!("{} : la bataille s'engage.", R::STRATS().at(&strat).at("label"));
        } else if mode != "auto" {
            return dict! {"ok" => false, "msg" => "Choisissez une stratégie."};
        }
        bt.set("mode", "auto");
        if TT::planning(g) {
            TT::settle(g); // tour par tour : la bataille se règle sur-le-champ, puis les marches suspendues reprennent
        }
        return dict! {"ok" => true, "msg" => msg, "bid" => bt.at("id")};
    }
    if sub == "pursue" {
        // après la victoire : poursuivre (`v` vrai) ou tenir le terrain
        let bt = g.battles.get(body.get("bid"));
        if !bt.truthy() || bt.get("mode") != "poursuite" {
            return dict! {"ok" => false, "msg" => "Aucune poursuite à décider."};
        }
        let v = body.getb("v");
        let fin = bt.at("fin");
        bt.set("pursue", v);
        bt.set("mode", "auto");
        g.end_battle(&bt, fin.ati(0), fin.atb(1));
        if TT::planning(g) {
            TT::settle(g);
        }
        return dict! {"ok" => true, "msg" => if v { "La cavalerie se lance à la poursuite." } else { "L'armée tient le terrain." }, "bid" => bt.at("id")};
    }
    dict! {"ok" => false, "msg" => "Commande de bataille inconnue."}
}
