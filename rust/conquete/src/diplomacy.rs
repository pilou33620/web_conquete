//! Diplomatie et commerce entre départements.
//!
//! Porte game/diplomacy.py (PORTAGE.md). Une signature ne se change pas sans le signaler. La partie s'appelle `game`
//! ici, comme dans le Python.
#![allow(unused_imports)]

use crate::army_actions::{self as AA, vmax, vmin};
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

/// `{x, y} == {a, b}` (deux camps, dans un ordre ou dans l'autre).
fn meme_paire(x: &Val, y: &Val, a: &str, b: &str) -> bool {
    (*x == a && *y == b) || (*x == b && *y == a)
}

/// `int(v)` d'une valeur venue du navigateur ; Err : le texte de l'exception de Python (ValueError, TypeError,
/// OverflowError), que le serveur rendait en « Commande invalide (…) ».
fn int_nav(v: &Val) -> Result<i64, String> {
    match v {
        Val::Bool(_) | Val::Int(_) => Ok(v.i()),
        Val::Float(f) if f.is_nan() => Err("cannot convert float NaN to integer".to_string()),
        Val::Float(f) if f.is_infinite() => Err("cannot convert float infinity to integer".to_string()),
        Val::Float(f) => Ok(py::int(*f)),
        Val::Str(s) => s.trim().parse::<i64>().map_err(|_| format!("invalid literal for int() with base 10: {}", v.repr())),
        _ => Err(format!("int() argument must be a string, a bytes-like object or a real number, not '{}'", v.type_name())),
    }
}

fn invalide(e: String) -> (Option<bool>, String) {
    (Some(false), format!("Commande invalide ({e})."))
}

/// Python : `lost_nodes(game, code)`.
// game/diplomacy.py, lignes 12 à 14
pub fn lost_nodes(game: &Game, code: &str) -> i64 {
    let f = game.factions.at(code);
    py::int_v(&vmax(0, &f.at("start_nodes") - game.owned_nodes(code).len() as i64))
}

/// Python : `borders(game, a, b)`.
/// Le cache est `game._frontieres` (quart de journée, set des paires (a, b) de propriétaires voisins) : chercher
/// avec `Paire(a, b)`.
// game/diplomacy.py, lignes 17 à 28
pub fn borders(game: &mut Game, a: &str, b: &str) -> bool {
    // (toute la France : 4 000 routes, demandé des dizaines de milliers de fois par mois ; gardé un quart de journée)
    let k = py::int(game.t * 4.0);
    if !matches!(&game._frontieres, Some((k0, _)) if *k0 == k) {
        let mut s = IndexSet::default();
        for e in game.geo.edges.iter() {
            let (oa, ob) = (game.nodes.at(e.at("a")).ats("owner"), game.nodes.at(e.at("b")).ats("owner"));
            if oa != ob {
                s.insert((oa.clone(), ob.clone()));
                s.insert((ob, oa));
            }
        }
        game._frontieres = Some((k, s));
    }
    game._frontieres.as_ref().unwrap().1.contains(&Paire(a, b))
}

/// Python : `value_of(game, code, res, qty)`.
// game/diplomacy.py, lignes 31 à 36
pub fn value_of(game: &Game, code: &str, res: &str, qty: f64) -> f64 {
    let stock = game.factions.at(code).at("res").get_or(res, 0);
    let mut need = if stock < 80i64 { 1.6 } else if stock < 400i64 { 1.0 } else { 0.6 };
    if res == "livres" {
        need = if stock < 150i64 { 1.3 } else { 1.0 };
    }
    qty * BASE_VALUE().atf(res) * need
}

// ------------------------------------------------------------------ effets

/// Raison pour laquelle a ne peut pas déclarer la guerre à b (None : il le peut).
/// Python : `war_refusal(game, a, b)`.
// game/diplomacy.py, lignes 40 à 51
pub fn war_refusal(game: &Game, a: &str, b: &str) -> Option<String> {
    if game.at_war(a, b) {
        return Some("Déjà en guerre.".to_string());
    }
    let fa = game.factions.at(a);
    if fa.at("overlord").truthy() {
        return Some("Un vassal ne déclare pas la guerre seul.".to_string());
    }
    if game.factions.at(b).at("overlord") == a {
        return Some(format!("{} est votre vassal : un lien de vassalité ne se rompt pas ainsi.", game.fname(b)));
    }
    if fa.at("truce").has(b) {
        return Some(format!("Une trêve avec {} court jusqu'au {}.", game.fname(b), game.date_str(&fa.at("truce").at(b))));
    }
    None
}

/// Python : `declare_war(game, a, b, quiet=False)`.
/// quiet : False par défaut (ne sert pas).
// game/diplomacy.py, lignes 54 à 94
pub fn declare_war(game: &mut Game, a: &str, b: &str, quiet: bool) -> (bool, String) {
    let _ = quiet;
    if let Some(why) = war_refusal(game, a, b) {
        return (false, why);
    }
    let was_ally = game.status(a, b) == "alliance";
    game.set_status(a, b, "guerre");
    game.factions.at(a).set("last_war", game.t);
    game.factions.at(b).set("last_war", game.t);
    for (x, y) in [(a, b), (b, a)] {
        game.factions.at(x).at("trade").pop(y);
        game.factions.at(x).at("war_since").set(y, game.t);
    }
    let rb = game.factions.at(b).at("rel");
    rb.set(a, vmax(-100, &rb.at(a) - if was_ally { 70 } else { 45 }));
    for (o, f) in game.factions.items() {
        let o = o.string();
        if o == a || o == b || !f.atb("alive") {
            continue;
        }
        let rel = f.at("rel");
        if game.at_war(&o, b) {
            rel.set(a, vmin(100, &rel.at(a) + 8i64));
        } else {
            rel.set(a, vmax(-100, &rel.at(a) - if was_ally { 14 } else { 7 }));
        }
    }
    let texte = format!("{} déclare la guerre à {} !", game.fname(a), game.fname(b));
    game.log("diplo", &texte, &dict! {"who" => a, "important" => true});
    FM::guerre(game, a, b); // contre une maison alliée par mariage : l'ordre public en pâtit
    if game.player == a || game.player == b {
        game.alert_pause(false);
    }
    // alliances et vassaux
    for (o, f) in game.factions.items() {
        let o = o.string();
        if !f.atb("alive") || o == a || o == b {
            continue;
        }
        if f.at("overlord") == b && f.at("truce").has(a) {
            continue; // une trêve signée se respecte, même pour secourir un allié
        }
        if f.at("overlord") == b
            || (game.status(&o, b) == "alliance"
                && f.at("rel").at(b) > 15i64
                && !game.at_war(&o, a)
                && game.status(&o, a) != "alliance"
                && !f.at("truce").has(a))
        {
            game.set_status(&o, a, "guerre");
            f.at("trade").pop(a);
            game.factions.at(a).at("trade").pop(&o);
            f.at("war_since").set(a, game.t);
            game.factions.at(a).at("war_since").set(&o, game.t);
            let texte = format!("{} honore son alliance et entre en guerre contre {}.", game.fname(&o), game.fname(a));
            game.log("diplo", &texte, &dict! {"who" => &o, "important" => true});
        } else if f.at("overlord") == a && !game.at_war(&o, b) && !f.at("truce").has(b) {
            game.set_status(&o, b, "guerre");
            f.at("trade").pop(b);
            f.at("war_since").set(b, game.t);
        }
    }
    (true, format!("Guerre déclarée à {}.", game.fname(b)))
}

/// Python : `make_peace(game, a, b)`.
// game/diplomacy.py, lignes 97 à 126
pub fn make_peace(game: &mut Game, a: &str, b: &str) {
    game.set_status(a, b, "paix");
    game.factions.at(a).set("last_war", game.t);
    game.factions.at(b).set("last_war", game.t);
    let until = TT::deadline(game, R::PEACE_TRUCE, &[a, b]);
    game.factions.at(a).at("truce").set(b, until);
    game.factions.at(b).at("truce").set(a, until);
    for (x, y) in [(a, b), (b, a)] {
        let rel = game.factions.at(x).at("rel");
        rel.set(y, vmin(100, &rel.at(y) + 12i64));
        game.factions.at(x).at("war_since").pop(y);
    }
    // les sièges et batailles en cours entre eux cessent
    for bt in game.battles.values() {
        if meme_paire(&bt.at("sides").at(0).at("owner"), &bt.at("sides").at(1).at("owner"), a, b) {
            game.dissolve_battle(&bt);
        }
    }
    for n in game.nodes.iter() {
        let s = n.at("siege");
        if s.truthy() && meme_paire(&s.at("by"), &n.at("owner"), a, b) {
            n.set("siege", Val::None);
        }
    }
    for ar in game.armies.values() {
        if ar.at("owner") == a || ar.at("owner") == b {
            if ar.at("state") == "siege" && ar.at("at_node").is_some() && game.nodes.at(ar.at("at_node")).at("siege").is_none() {
                ar.set("state", "idle");
            }
            let tgt = ar.get("target").or(dict! {}).get("node");
            if tgt.is_some() {
                let to = game.nodes.at(&tgt).at("owner");
                if (to == a || to == b) && to != ar.at("owner") {
                    ar.set("path", list![]); // la marche contre l'ancien ennemi s'arrête
                    if ar.at("state") == "move" {
                        ar.set("state", "idle");
                    }
                }
            }
            ar.set("grace", game.t + 2.0);
        }
    }
    for (x, y) in [(a, b), (b, a)] {
        // les généraux captifs sont libérés (SPEC-GENERAUX.md)
        for c in captifs(game, x, y).iter() {
            rendre_general(game, x, &c);
        }
    }
    let texte = format!("Paix signée entre {} et {} (trêve de {} tours).", game.fname(a), game.fname(b), R::PEACE_TRUCE);
    game.log("diplo", &texte, &dict! {"who" => a, "important" => true});
}

/// Prisonniers originaires de b détenus par a.
/// Python : `held(game, a, b)`.
// game/diplomacy.py, lignes 129 à 131
pub fn held(game: &Game, a: &str, b: &str) -> i64 {
    py::int_v(&game.factions.at(a).get_or("prisoners", dict! {}).get_or(b, 0))
}

/// Généraux de b captifs de a (les plus gradés d'abord).
/// Python : `captifs(game, a, b)`.
/// Rend une liste de captifs dict(gen, de) (les mêmes objets que f['captifs'] : rendre_general les y retire).
// game/diplomacy.py, lignes 134 à 136
pub fn captifs(game: &Game, a: &str, b: &str) -> Val {
    let l: Vec<Val> = game.factions.at(a).get_or("captifs", list![]).iter().filter(|c| c.at("de") == b).collect();
    Val::list(py::sorted_by_key(l, |c| -c.at("gen").at("lvl")))
}

/// Python : `a_echanger(game, a, b)`.
// game/diplomacy.py, lignes 139 à 140
pub fn a_echanger(game: &Game, a: &str, b: &str) -> bool {
    held(game, a, b) != 0 || held(game, b, a) != 0 || captifs(game, a, b).truthy() || captifs(game, b, a).truthy()
}

/// Le captif c de a rentre dans la réserve de son camp.
/// Python : `rendre_general(game, a, c)`.
// game/diplomacy.py, lignes 143 à 152
pub fn rendre_general(game: &mut Game, a: &str, c: &Val) {
    game.factions.at(a).at("captifs").remove(c);
    let de = c.at("de");
    if game.factions.has(&de) && game.factions.at(&de).atb("alive") {
        let gen = c.at("gen");
        if gen.at("lvl") == R::GENERAL_RANKS().len() as i64 && game.generaux(de.s()).iter().any(|o| o.at("lvl") == gen.at("lvl")) {
            gen.dec("lvl", 1); // (un seul maréchal par camp : le revenant redescend lieutenant général)
        }
        let res = game.factions.at(&de).setdefault("generaux", list![]);
        res.push(gen);
        if res.len() as i64 > R::RESERVE_MAX {
            res.replace_all(res.slice(Some(-R::RESERVE_MAX), None).vec()); // del res[:-R.RESERVE_MAX]
        }
    }
}

/// Cartel d'échange : chacun rend les prisonniers de l'autre, homme pour homme, puis le surplus se rachète.
/// Python : `exchange_prisoners(game, a, b)`.
// game/diplomacy.py, lignes 155 à 201
pub fn exchange_prisoners(game: &mut Game, a: &str, b: &str) -> String {
    let (fa, fb) = (game.factions.at(a), game.factions.at(b));
    let (pa, pb) = (fa.setdefault("prisoners", dict! {}), fb.setdefault("prisoners", dict! {}));
    let (ha, hb) = (held(game, a, b), held(game, b, a));
    let k = if hb < ha { hb } else { ha };
    let mut out: Vec<String> = vec![];
    if k != 0 {
        pa.set(b, ha - k);
        pb.set(a, hb - k);
        game.add_recrues(a, k as f64);
        game.add_recrues(b, k as f64);
        out.push(format!("{k} prisonniers rendus de part et d'autre"));
    }
    for (x, y, fx, fy, surplus) in [(a, b, &fa, &fb, ha - k), (b, a, &fb, &fa, hb - k)] {
        let _ = x;
        if surplus <= 0 {
            continue;
        }
        let livres = vmax(0.0, fy.at("res").at("livres"));
        let q = py::int_v(&livres.floordiv(R::PRISONER_RANSOM));
        let m = if q < surplus { q } else { surplus };
        if m <= 0 {
            continue;
        }
        fy.at("res").dec("livres", m * R::PRISONER_RANSOM);
        fx.at("res").inc("livres", m * R::PRISONER_RANSOM);
        let px = fx.at("prisoners");
        px.set(y, &px.get_or(y, 0) - m);
        game.add_recrues(y, m as f64);
        out.push(format!("{} rachète {m} des siens pour {} livres", game.fname(y), m * R::PRISONER_RANSOM));
    }
    // les généraux : un pour un (les plus gradés ensemble), le surplus se rachète selon le grade
    let (ga, gb) = (captifs(game, a, b), captifs(game, b, a));
    for (ca, cb) in ga.vec().iter().zip(gb.vec().iter()) {
        rendre_general(game, a, ca);
        rendre_general(game, b, cb);
        out.push(format!("{} échangé contre {}", ca.at("gen").at("name"), cb.at("gen").at("name")));
    }
    for (x, y, reste) in [(a, b, ga.slice(Some(gb.len() as i64), None)), (b, a, gb.slice(Some(ga.len() as i64), None))] {
        for c in reste.iter() {
            let prix = R::GENERAL_RANCON().at(c.at("gen").ati("lvl") - 1);
            if game.factions.at(y).at("res").at("livres") < prix {
                continue;
            }
            game.factions.at(y).at("res").dec("livres", &prix);
            game.factions.at(x).at("res").inc("livres", &prix);
            rendre_general(game, x, &c);
            out.push(format!("{} rachète {} pour {prix} livres", game.fname(y), Game::gen_title(&c.at("gen")).to_lowercase()));
        }
    }
    for (x, y) in [(a, b), (b, a)] {
        let p = game.factions.at(x).at("prisoners");
        if p.get_or(y, 1) <= 0i64 {
            p.del(y);
        }
        let rel = game.factions.at(x).at("rel");
        rel.set(y, vmin(100, &rel.at(y) + 5i64));
    }
    let txt = if out.is_empty() { "aucun prisonnier rendu".to_string() } else { out.join(" ; ") };
    let texte = format!("Échange de prisonniers entre {} et {} : {txt}.", game.fname(a), game.fname(b));
    let important = game.player == a || game.player == b;
    game.log("diplo", &texte, &dict! {"who" => a, "important" => important});
    txt
}

/// Python : `make_alliance(game, a, b)`.
// game/diplomacy.py, lignes 204 à 208
pub fn make_alliance(game: &mut Game, a: &str, b: &str) {
    game.set_status(a, b, "alliance");
    for (x, y) in [(a, b), (b, a)] {
        let rel = game.factions.at(x).at("rel");
        rel.set(y, vmin(100, &rel.at(y) + 10i64));
    }
    let texte = format!("Alliance conclue entre {} et {}.", game.fname(a), game.fname(b));
    game.log("diplo", &texte, &dict! {"who" => a, "important" => true});
}

/// Python : `make_vassal(game, v, over)`.
// game/diplomacy.py, lignes 211 à 230
pub fn make_vassal(game: &mut Game, v: &str, over: &str) {
    let fv = game.factions.at(v);
    fv.set("overlord", over);
    game.set_status(v, over, "alliance");
    fv.at("truce").pop(over);
    for o in game.factions.keys() {
        let o = o.string();
        if o == v || o == over || !game.factions.at(&o).atb("alive") {
            continue;
        }
        if game.at_war(over, &o) {
            game.set_status(v, &o, "guerre");
        } else if game.at_war(v, &o) {
            game.set_status(v, &o, "paix");
        }
    }
    for bt in game.battles.values() {
        if meme_paire(&bt.at("sides").at(0).at("owner"), &bt.at("sides").at(1).at("owner"), v, over) {
            game.dissolve_battle(&bt);
        }
    }
    for n in game.nodes.iter() {
        let s = n.at("siege");
        if s.truthy() && meme_paire(&s.at("by"), &n.at("owner"), v, over) {
            n.set("siege", Val::None);
        }
    }
    let texte = format!("{} se soumet à {} et devient son vassal.", game.fname(v), game.fname(over));
    game.log("diplo", &texte, &dict! {"who" => over, "important" => true});
    game.check_end();
}

// ------------------------------------------------------------------ évaluation par une IA

/// Python : `ai_evaluate(game, ai, frm, action, amount=0, give=None, get=None)`.
/// ai : le camp qui répond (un code, pas l'objet AI) ; amount : 0 par défaut ; give, get : None ou des
/// tuples (ressource, quantité). Piège : `amount / 12` est une division de flottants.
// game/diplomacy.py, lignes 234 à 309
pub fn ai_evaluate(game: &Game, ai: &str, frm: &str, action: &str, amount: i64, give: &Val, get: &Val) -> (bool, String) {
    let f = game.factions.at(ai);
    let op = f.at("rel").at(frm);
    let (fa, fb) = (game.faction_power(ai), game.faction_power(frm));
    let pa = if fa > 1.0 { fa } else { 1.0 };
    let pb = if fb > 1.0 { fb } else { 1.0 };
    let pers = R::FACTIONS().at(ai).at("personality");
    let diplo = game.mod_(frm, "diplo", 0.0) + game.mod_(frm, "prestige", 0.0);
    let st = game.status(ai, frm);
    let nom = game.fname(ai);
    let amount = amount as f64;
    match action {
        "paix" => {
            if st != "guerre" {
                return (false, "Nous ne sommes pas en guerre.".to_string());
            }
            let days = game.t - f.at("war_since").get_or(frm, game.t).f();
            let score = 32.0 * (pb / pa) + days / 5.0 + amount / 12.0 + op.f() / 3.0 + diplo + 6.0 * lost_nodes(game, ai) as f64
                + f.get_or("weary", 0).f() / 2.0
                - 6.0 * lost_nodes(game, frm) as f64
                - 20.0 * pers.atf("aggr");
            if score > 45.0 {
                return (true, format!("{nom} accepte la paix."));
            }
            if pa > 1.4 * pb {
                return (false, format!("{nom} se croit en position de force et refuse."));
            }
            (false, format!("{nom} refuse : « Proposez-nous mieux » (essayez avec un tribut en livres)."))
        }
        "alliance" => {
            if st == "guerre" {
                return (false, "Faites d'abord la paix.".to_string());
            }
            if st == "alliance" {
                return (false, "Déjà alliés.".to_string());
            }
            let common = game.factions.keys().iter().any(|o| game.at_war(ai, o.s()) && game.at_war(frm, o.s()));
            let r = pb / pa;
            let score = op.f() + diplo + (if common { 25.0 } else { 0.0 }) + (if FM::lie(game, ai, frm) { 20.0 } else { 0.0 })
                + 15.0 * (if r < 1.5 { r } else { 1.5 })
                + amount / 15.0;
            if score >= 60.0 {
                return (true, format!("{nom} accepte l'alliance."));
            }
            (false, format!("{nom} ne vous fait pas encore assez confiance (relation {}).", py::int_v(&op)))
        }
        "commerce" => {
            if st == "guerre" {
                return (false, "Impossible de commercer avec un ennemi.".to_string());
            }
            if f.at("trade").has(frm) {
                return (false, "Accord déjà en vigueur.".to_string());
            }
            let score = op.f() + 30.0 * pers.atf("trade") + diplo + amount / 10.0;
            if score >= 20.0 {
                return (true, format!("{nom} signe l'accord commercial."));
            }
            (false, format!("{nom} refuse de commercer (relation {}).", py::int_v(&op)))
        }
        "echange" => {
            if st == "guerre" {
                return (false, "Pas d'échange avec un ennemi.".to_string());
            }
            let ((gr, gq), (wr, wq)) = (give.pair(), get.pair());
            if game.factions.at(ai).at("res").get_or(&wr, 0) < wq {
                return (false, format!("{nom} n'a pas assez de {}.", R::RES_LABEL().at(&wr).s().to_lowercase()));
            }
            let v_in = value_of(game, ai, gr.s(), gq.f());
            let v_out = value_of(game, ai, wr.s(), wq.f()) * (1.15 - op.f() / 400.0 - diplo / 200.0);
            let mkt = |r: &Val, q: &Val| q.f() * if *r == "livres" { 1.0 } else { game.market.get_or(r, BASE_VALUE().at(r)).f() };
            if mkt(&gr, &gq) < mkt(&wr, &wq) * 0.95 {
                return (false, format!("{nom} connaît les prix du marché et juge l'échange déséquilibré."));
            }
            if v_in >= v_out {
                return (true, format!("{nom} accepte l'échange."));
            }
            (false, format!("{nom} juge l'échange déséquilibré."))
        }
        "passage" => AA::eval_passage(game, ai, frm, amount as i64),
        "mariage" => {
            if let Some(why) = FM::refus_mariage(game, ai, frm) {
                return (false, why);
            }
            if op.f() + diplo + amount / 15.0 > 20.0 {
                return (true, format!("{nom} accepte le mariage."));
            }
            (false, format!("{nom} décline : nos maisons ne sont pas assez proches (relation {}).", py::int_v(&op)))
        }
        "prisonniers" => {
            if !a_echanger(game, ai, frm) {
                return (false, "Personne n'a de prisonniers à échanger.".to_string());
            }
            if op < -70i64 {
                return (false, format!("{nom} refuse de traiter avec vous, même pour ses prisonniers."));
            }
            (true, format!("{nom} accepte l'échange de prisonniers."))
        }
        "soumission" => {
            if st != "guerre" {
                return (false, "On n'exige la soumission que d'un ennemi.".to_string());
            }
            let lost = lost_nodes(game, ai);
            let cap_threat = game.nodes.at(game.capital_of(ai)).at("siege").is_some();
            if (pa < 0.3 * pb && (Val::from(lost) >= vmax(2, &f.at("start_nodes") * 0.4) || cap_threat)) || pa < 0.15 * pb {
                return (true, format!("{nom} accepte de se soumettre."));
            }
            (false, format!("{nom} refuse de se soumettre et combattra jusqu'au bout."))
        }
        _ => (false, "Proposition inconnue.".to_string()),
    }
}

// ------------------------------------------------------------------ point d'entrée

/// Python : `act(game, frm, to, action, amount=0, give=None, get=None)`.
/// to, action, amount, give, get : tels que le navigateur les envoie (amount : 0 par défaut ; give, get : None
/// par défaut, ou des tuples / listes (ressource, quantité)). Rend (None, message) quand la proposition attend le joueur.
// game/diplomacy.py, lignes 313 à 386
pub fn act(game: &mut Game, frm: &str, to: &Val, action: &Val, amount: &Val, give: &Val, get: &Val) -> (Option<bool>, String) {
    // (un destinataire qui n'est pas un texte n'est pas un camp ; une action qui n'est pas un texte n'en vaut aucune)
    if !to.is_str() || !game.factions.has(to) || !game.factions.at(to).atb("alive") || *to == frm {
        return (Some(false), "Département invalide.".to_string());
    }
    let to = to.string();
    let action = if action.is_str() { action.string() } else { String::new() };
    let action = action.as_str();
    let f = game.factions.at(frm);
    let amount = match int_nav(&amount.or(0)) {
        Ok(v) => if v > 0 { v } else { 0 },
        Err(e) => return invalide(e),
    };
    if f.at("res").at("livres") < amount {
        return (Some(false), "Livres insuffisantes.".to_string());
    }
    if action == "guerre" {
        let (ok, msg) = declare_war(game, frm, &to, false);
        return (Some(ok), msg);
    }
    if action == "rompre" {
        if game.status(frm, &to) != "alliance" {
            return (Some(false), "Pas d'alliance à rompre.".to_string());
        }
        if game.factions.at(&to).at("overlord") == frm || f.at("overlord") == to {
            return (Some(false), "Un lien de vassalité ne se rompt pas ainsi.".to_string());
        }
        game.set_status(frm, &to, "paix");
        let rel = game.factions.at(&to).at("rel");
        rel.set(frm, vmax(-100, &rel.at(frm) - 25i64));
        let texte = format!("{} rompt son alliance avec {}.", game.fname(frm), game.fname(&to));
        game.log("diplo", &texte, &dict! {"who" => frm, "important" => true});
        return (Some(true), "Alliance rompue.".to_string());
    }
    if action == "fin_commerce" {
        f.at("trade").pop(&to);
        game.factions.at(&to).at("trade").pop(frm);
        let rel = game.factions.at(&to).at("rel");
        rel.set(frm, vmax(-100, &rel.at(frm) - 8i64));
        game._dirty_income = true;
        return (Some(true), "Accord commercial dénoncé.".to_string());
    }
    if action == "fin_passage" {
        let (ok, msg) = AA::revoke_passage(game, frm, &to);
        return (Some(ok), msg);
    }
    if action == "passage" {
        let st = game.status(frm, &to);
        if st != "paix" {
            return (Some(false), "Le droit de passage se demande à un voisin en paix (vos alliés passent déjà librement).".to_string());
        }
        if AA::has_passage(game, frm, &to) {
            return (Some(false), "Vous avez déjà le droit de passage.".to_string());
        }
    }
    if action == "cadeau" {
        if amount <= 0 {
            return (Some(false), "Indiquez un montant.".to_string());
        }
        f.at("res").dec("livres", amount);
        game.factions.at(&to).at("res").inc("livres", amount);
        let g8 = amount as f64 / 8.0;
        let gain = if g8 < 30.0 { g8 } else { 30.0 };
        let rel = game.factions.at(&to).at("rel");
        rel.set(frm, vmin(100, &rel.at(frm) + gain));
        return (Some(true), format!("{} apprécie votre présent (relation {}).", game.fname(&to), R::num(gain, 1)));
    }
    let (mut give, mut get) = (give.clone(), get.clone());
    if action == "echange" {
        let complet = |v: &Val| (v.is_list() || v.is_tuple()) && v.len() == 2;
        if !give.truthy() || !get.truthy() || !complet(&give) || !complet(&get) {
            return (Some(false), "Échange incomplet.".to_string());
        }
        let connu = |r: &Val| r.is_str() && BASE_VALUE().has(r);
        if !connu(&give.at(0)) || !connu(&get.at(0)) || give.at(0) == get.at(0) {
            return (Some(false), "Échange invalide.".to_string());
        }
        let gq = match int_nav(&give.at(1)) {
            Ok(v) => v,
            Err(e) => return invalide(e),
        };
        give = tup![give.at(0), if gq > 1 { gq } else { 1 }];
        let wq = match int_nav(&get.at(1)) {
            Ok(v) => v,
            Err(e) => return invalide(e),
        };
        get = tup![get.at(0), if wq > 1 { wq } else { 1 }];
        if f.at("res").get_or(&give.at(0), 0) < give.at(1) {
            return (Some(false), "Stock insuffisant.".to_string());
        }
        let cap = game.recruit_cap(frm);
        if get.at(0) == "recrues" && &game.factions.at(frm).at("res").at("recrues") + &get.at(1) > if cap > 0 { cap } else { 0 } {
            return (Some(false), "Vos casernes ne peuvent pas loger autant de recrues.".to_string());
        }
        if give.at(0) == "livres" && Val::from(amount) + give.at(1) > f.at("res").at("livres") {
            return (Some(false), "Livres insuffisantes pour l'échange et le tribut.".to_string());
        }
    }
    if action == "prisonniers" && !a_echanger(game, frm, &to) {
        return (Some(false), "Personne n'a de prisonniers à échanger.".to_string());
    }
    if action == "mariage" {
        if let Some(why) = FM::refus_mariage(game, frm, &to) {
            return (Some(false), why);
        }
    }
    if to == game.player {
        let p = dict! {
            "id" => game.nid("p"), "frm" => frm, "action" => action, "amount" => amount, "give" => &give, "get" => &get,
            "expires" => TT::deadline(game, R::PROPOSAL_TOURS, &[]), "date" => game.date_str(&Val::None)
        };
        game.proposals.push(p);
        let what = match action {
            "paix" => "propose la paix",
            "alliance" => "propose une alliance",
            "commerce" => "propose un accord commercial",
            "echange" => "propose un échange",
            "prisonniers" => "propose un échange de prisonniers",
            "passage" => "demande le droit de passage sur vos terres",
            "mariage" => "propose un mariage entre vos maisons",
            "soumission" => "exige votre soumission",
            _ => "vous fait une proposition",
        };
        let texte = format!("{} {what} : répondez pendant votre tour.", game.fname(frm));
        game.log("diplo", &texte, &dict! {"who" => frm, "important" => true});
        if action == "paix" || action == "alliance" || action == "soumission" {
            game.alert_pause(false); // le commerce et les échanges n'arrêtent pas les années de paix
        }
        return (None, "Proposition envoyée.".to_string());
    }
    let (ok, msg) = ai_evaluate(game, &to, frm, action, amount, &give, &get);
    if ok {
        apply(game, frm, &to, action, amount, &give, &get);
    } else {
        let rel = game.factions.at(&to).at("rel");
        rel.set(frm, vmax(-100, &rel.at(frm) - 1i64));
    }
    (Some(ok), msg)
}

/// Python : `apply(game, frm, to, action, amount=0, give=None, get=None)`.
/// amount : 0 par défaut ; give, get : None par défaut.
// game/diplomacy.py, lignes 389 à 419
pub fn apply(game: &mut Game, frm: &str, to: &str, action: &str, amount: i64, give: &Val, get: &Val) {
    let (f, g) = (game.factions.at(frm), game.factions.at(to));
    if amount != 0 {
        f.at("res").dec("livres", amount);
        g.at("res").inc("livres", amount);
    }
    match action {
        "paix" => make_peace(game, frm, to),
        "alliance" => make_alliance(game, frm, to),
        "commerce" => {
            f.at("trade").set(to, true);
            g.at("trade").set(frm, true);
            game._dirty_income = true;
            let texte = format!("Accord commercial entre {} et {}.", game.fname(frm), game.fname(to));
            let important = frm == game.player || to == game.player;
            game.log("diplo", &texte, &dict! {"who" => frm, "important" => important});
        }
        "echange" => {
            let ((gr, gq), (wr, wq)) = (give.pair(), get.pair());
            f.at("res").dec(&gr, &gq);
            g.at("res").dec(&wr, &wq);
            for (side, res, q) in [(to, &gr, &gq), (frm, &wr, &wq)] {
                if *res == "recrues" {
                    game.add_recrues(side, q.f());
                } else {
                    game.factions.at(side).at("res").inc(res, q);
                }
            }
        }
        "soumission" => make_vassal(game, to, frm),
        "prisonniers" => {
            exchange_prisoners(game, frm, to);
        }
        "passage" => AA::grant_passage(game, to, frm, AA::PASSAGE_TOURS),
        "mariage" => FM::marier(game, frm, to),
        _ => {}
    }
}

/// Python : `answer(game, pid, accept)`.
/// pid : l'identifiant de la proposition, tel que le navigateur l'envoie.
// game/diplomacy.py, lignes 422 à 456
pub fn answer(game: &mut Game, pid: &Val, accept: bool) -> (bool, String) {
    let p = game.proposals.iter().find(|x| x.at("id") == *pid).unwrap_or(Val::None);
    if !p.truthy() {
        return (false, "Proposition expirée.".to_string());
    }
    game.proposals.remove(&p);
    let frm = p.ats("frm");
    let me = game.player.clone();
    if !game.factions.at(&frm).atb("alive") {
        return (false, format!("{} n'existe plus : sa proposition tombe.", game.fname(&frm)));
    }
    if !accept {
        let rel = game.factions.at(&frm).at("rel");
        rel.set(&me, vmax(-100, &rel.at(&me) - 4i64));
        return (true, "Proposition refusée.".to_string());
    }
    let ff = game.factions.at(&frm).at("res");
    let action = p.ats("action");
    let give_l = if action == "echange" && p.at("give").at(0) == "livres" { p.at("give").at(1) } else { Val::from(0) };
    if p.at("amount").truthy() && ff.at("livres") < &p.at("amount") + &give_l {
        return (false, format!("{} n'a plus de quoi payer le tribut promis.", game.fname(&frm)));
    }
    if action == "echange" {
        let ((gr, gq), (wr, wq)) = (p.at("give").pair(), p.at("get").pair());
        if game.factions.at(&me).at("res").get_or(&wr, 0) < wq || ff.get_or(&gr, 0) < gq {
            return (false, "Les stocks ne permettent plus cet échange.".to_string());
        }
    }
    let st = game.status(&me, &frm);
    if action == "paix" && st != "guerre" {
        return (false, "Nous ne sommes plus en guerre.".to_string());
    }
    if (action == "alliance" || action == "commerce" || action == "echange") && st == "guerre" {
        return (false, "Nous sommes en guerre : cette proposition n'a plus lieu d'être.".to_string());
    }
    if action == "alliance" && st == "alliance" {
        return (false, "Déjà alliés.".to_string());
    }
    if action == "passage" && st != "paix" {
        return (false, "Nous ne sommes plus en paix : cette demande n'a plus lieu d'être.".to_string());
    }
    if action == "prisonniers" && !a_echanger(game, &me, &frm) {
        return (false, "Il n'y a plus de prisonniers à échanger.".to_string());
    }
    if action == "mariage" {
        if let Some(why) = FM::refus_mariage(game, &frm, &me) {
            return (false, why);
        }
    }
    apply(game, &frm, &me, &action, p.ati("amount"), &p.at("give"), &p.at("get"));
    (true, "Proposition acceptée.".to_string())
}
