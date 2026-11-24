//! Diplomatie et commerce entre départements.
//!
//! Porte game/diplomacy.py (PORTAGE.md). Une signature ne se change pas sans le signaler. La partie s'appelle `game`
//! ici, comme dans le Python.
#![allow(unused_imports)]

use crate::army_actions::{self as AA, vmax, vmin};
use crate::engine::memoire as MEM;
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
        let maitres = game.maitres();
        for &(a, b, _) in game.geo_fixe().aretes.iter() {
            // (deux places du même maître, le cas de presque toutes les routes : écartées sans fabriquer leurs textes)
            if matches!((&maitres[a], &maitres[b]), (Val::Str(x), Val::Str(y)) if x == y) {
                continue;
            }
            let (oa, ob) = (maitres[a].string(), maitres[b].string());
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
    if fa.atb("overlord") {
        return Some("Un protectorat ne déclare pas la guerre seul.".to_string());
    }
    if game.factions.at(b).at_is("overlord", &a) {
        return Some(format!("{} est votre protectorat : ce lien ne se rompt pas ainsi.", game.fname(b)));
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
    // (SPEC-EMPIRE, module 7) un casus belli (incident de corsaires) : les autres camps ne s'en fâchent pas
    let cb = crate::engine::commerce::casus_belli(game, a, b);
    game.factions.at(a).get_or("cb", dict! {}).pop(b);
    game.set_status(a, b, "guerre");
    game.factions.at(a).set("last_war", game.t);
    game.factions.at(b).set("last_war", game.t);
    for (x, y) in [(a, b), (b, a)] {
        game.factions.at(x).at("trade").pop(y);
        game.factions.at(x).at("war_since").set(y, game.t);
    }
    let rb = game.factions.at(b).at("rel");
    rb.set(a, vmax(-100, &rb.at(a) - if was_ally { 70 } else { 45 }));
    MEM::retenir(game, b, a, if was_ally { "trahison" } else { "guerre" }, None); // (SPEC-POLITIQUE, module 6)
    for (o, f) in game.factions.items() {
        let o = o.string();
        if o == a || o == b || !f.atb("alive") {
            continue;
        }
        let rel = f.at("rel");
        if game.at_war(&o, b) {
            rel.set(a, vmin(100, &rel.at(a) + 8i64));
        } else {
            rel.set(a, vmax(-100, &rel.at(a) - if cb { 0 } else if was_ally { 14 } else { 7 }));
        }
    }
    let texte = format!("{} déclare la guerre à {} !{}", game.fname(a), game.fname(b), if cb { format!(" (casus belli : les corsaires {})", R::de(&game.fname(b))) } else { String::new() });
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
        if f.at_is("overlord", &b) && f.at("truce").has(a) {
            continue; // une trêve signée se respecte, même pour secourir un allié
        }
        // (SPEC-POLITIQUE, module 6) l'agressé appelle ses alliés : une IA répond selon son attitude et sa fidélité, le
        // joueur reçoit l'appel ; un refus se paie en attitude, et peut rompre l'alliance
        let allie = !f.atb("overlord")
            && game.status(&o, b) == "alliance"
            && !game.at_war(&o, a)
            && game.status(&o, a) != "alliance"
            && !f.at("truce").has(a);
        if allie && attend_le_joueur(game, &o) {
            appel(game, b, &Val::from(&o), &Val::from(a));
            continue;
        }
        if allie && !repond_a_l_appel(game, &o, b) {
            refuser_appel(game, b, &o);
            continue;
        }
        if f.at_is("overlord", &b) || allie {
            if allie {
                MEM::retenir(game, b, &o, "aide", None);
            }
            game.set_status(&o, a, "guerre");
            f.at("trade").pop(a);
            game.factions.at(a).at("trade").pop(&o);
            f.at("war_since").set(a, game.t);
            game.factions.at(a).at("war_since").set(&o, game.t);
            let texte = format!("{} honore son alliance et entre en guerre contre {}.", game.fname(&o), game.fname(a));
            game.log("diplo", &texte, &dict! {"who" => &o, "important" => true});
        } else if f.at_is("overlord", &a) && !game.at_war(&o, b) && !f.at("truce").has(b) {
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
        if ar.at_is("owner", &a) || ar.at_is("owner", &b) {
            if ar.at_is("state", "siege") && ar.at("at_node").is_some() && game.nodes.at(ar.at("at_node")).at("siege").is_none() {
                ar.set("state", "idle");
            }
            let tgt = ar.get("target").or(dict! {}).get("node");
            if tgt.is_some() {
                let to = game.nodes.at(&tgt).at("owner");
                if (to == a || to == b) && to != ar.at("owner") {
                    ar.set("path", list![]); // la marche contre l'ancien ennemi s'arrête
                    if ar.at_is("state", "move") {
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
    // (SPEC-POLITIQUE, module 6) les protectorats, entrés en guerre avec leur protecteur, en sortent avec lui
    for (x, y) in [(a, b), (b, a)] {
        let suivent: Vec<String> =
            game.factions.items().into_iter().filter(|(c, f)| f.at_is("overlord", &x) && game.at_war(c.s(), y)).map(|(c, _)| c.string()).collect();
        for c in suivent {
            make_peace(game, &c, y);
        }
    }
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
    let l: Vec<Val> = game.factions.at(a).get_or("captifs", list![]).iter().filter(|c| c.at_is("de", &b)).collect();
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
    let texte = format!("{} se soumet à {} et devient son protectorat.", game.fname(v), game.fname(over));
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
    let op = Val::from(MEM::valeur(game, ai, frm)); // (SPEC-POLITIQUE, module 6) l'attitude : la relation et la mémoire
    let (fa, fb) = (game.faction_power(ai), game.faction_power(frm));
    let pa = if fa > 1.0 { fa } else { 1.0 };
    let pb = if fb > 1.0 { fb } else { 1.0 };
    let diplo = game.mod_(frm, "diplo", 0.0) + game.mod_(frm, "prestige", 0.0);
    let st = game.status(ai, frm);
    let nom = game.fname(ai);
    let amount = amount as f64;
    match action {
        "paix" => {
            if st != "guerre" {
                return (false, "Nous ne sommes pas en guerre.".to_string());
            }
            let score = score_paix(game, ai, frm) + amount / 12.0;
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
            let score = score_alliance(game, ai, frm) + amount / 15.0;
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
            let score = score_commerce(game, ai, frm) + amount / 10.0;
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
            if op.f() + diplo + bonus(game, ai, frm, None) + amount / 15.0 > 20.0 {
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
    if let Some(why) = diplomatie_bloquee(game, frm, &to, action) {
        return (Some(false), why); // (SPEC-POLITIQUE, module 6)
    }
    if action == "guerre" {
        let (ok, msg) = declare_war(game, frm, &to, false);
        return (Some(ok), msg);
    }
    if action == "rompre" {
        if game.status(frm, &to) != "alliance" {
            return (Some(false), "Pas d'alliance à rompre.".to_string());
        }
        if game.factions.at(&to).at_is("overlord", &frm) || f.at_is("overlord", &to) {
            return (Some(false), "Un lien de vassalité ne se rompt pas ainsi.".to_string());
        }
        game.set_status(frm, &to, "paix");
        let rel = game.factions.at(&to).at("rel");
        rel.set(frm, vmax(-100, &rel.at(frm) - 25i64));
        MEM::retenir(game, &to, frm, "trahison", None); // (SPEC-POLITIQUE, module 6)
        let texte = format!("{} rompt son alliance avec {}.", game.fname(frm), game.fname(&to));
        game.log("diplo", &texte, &dict! {"who" => frm, "important" => true});
        return (Some(true), "Alliance rompue.".to_string());
    }
    if action == "fin_commerce" {
        f.at("trade").pop(&to);
        game.factions.at(&to).at("trade").pop(frm);
        let rel = game.factions.at(&to).at("rel");
        rel.set(frm, vmax(-100, &rel.at(frm) - 8i64));
        MEM::retenir(game, &to, frm, "accord_rompu", None); // (SPEC-POLITIQUE, module 6)
        game._dirty_income = true;
        return (Some(true), "Accord commercial dénoncé.".to_string());
    }
    if action == "fin_passage" {
        let (ok, msg) = AA::revoke_passage(game, frm, &to);
        if ok {
            MEM::retenir(game, &to, frm, "accord_rompu", None); // (SPEC-POLITIQUE, module 6)
        }
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
        MEM::retenir(game, &to, frm, "cadeau", Some(gain / 2.0)); // (SPEC-POLITIQUE, module 6)
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
            crate::engine::commerce::accord(game, frm, to); // la route commerciale par mer (SPEC-EMPIRE, module 7)
            MEM::retenir(game, frm, to, "commerce", None); // (SPEC-POLITIQUE, module 6)
            MEM::retenir(game, to, frm, "commerce", None);
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
        "mariage" => {
            FM::marier(game, frm, to);
            MEM::retenir(game, frm, to, "mariage", None); // (SPEC-POLITIQUE, module 6)
            MEM::retenir(game, to, frm, "mariage", None);
        }
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
    if matches!(p.ats("action").as_str(), "proposition" | "ultimatum" | "appel") {
        return repondre(game, &p, accept); // (SPEC-POLITIQUE, module 6)
    }
    if !accept {
        let rel = game.factions.at(&frm).at("rel");
        rel.set(&me, vmax(-100, &rel.at(&me) - 4i64));
        return (true, "Proposition refusée.".to_string());
    }
    let ff = game.factions.at(&frm).at("res");
    let action = p.ats("action");
    let give_l = if action == "echange" && p.at("give").at(0) == "livres" { p.at("give").at(1) } else { Val::from(0) };
    if p.atb("amount") && ff.at("livres") < &p.at("amount") + &give_l {
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

// ------------------------------------------------------------------ (SPEC-POLITIQUE, module 6) diplomatie profonde
//
// Propositions composées (clauses des deux côtés, R::CLAUSES), contre-propositions, ultimatums, appels aux armes,
// protectorats (les vassaux d'avant : `overlord` reste la clé du protecteur). Le caractère, la mémoire et l'attitude :
// engine/memoire.rs. Les commandes du navigateur : `commande` ({cmd: "diplo", sub: …}) ; l'ancienne forme
// ({cmd: "diplo", to, action, …}) passe toujours par `act`.
//
// Une proposition qui attend le joueur (game.proposals) : {id, frm, action, amount: 0, give: None, get: None, expires,
// date} et, selon l'action : "proposition" → clauses {donner, recevoir} (ce que frm donne, ce qu'il demande),
// contre_proposition ; "ultimatum" → exigence ; "appel" → contre (l'ennemi).

/// Les points qu'ajoutent au score d'acceptation de `ai` son caractère (k : "paix", "alliance", "commerce") et un diplomate
/// de `frm` posté chez lui.
fn bonus(game: &Game, ai: &str, frm: &str, k: Option<&str>) -> f64 {
    k.map_or(0.0, |k| MEM::trait_(game, ai, k)) + if MEM::diplomate_present(game, frm, ai) { R::DIPLOMATE_BONUS } else { 0.0 }
}

/// Le score de `ai` pour la paix avec `frm`, sans tribut (accepte au-delà de 45).
fn score_paix(game: &Game, ai: &str, frm: &str) -> f64 {
    let f = game.factions.at(ai);
    let (pa, pb) = (game.faction_power(ai).max(1.0), game.faction_power(frm).max(1.0));
    let diplo = game.mod_(frm, "diplo", 0.0) + game.mod_(frm, "prestige", 0.0);
    let days = game.t - f.at("war_since").get_or(frm, game.t).f();
    32.0 * (pb / pa) + days / 5.0 + MEM::valeur(game, ai, frm) / 3.0 + diplo + 6.0 * lost_nodes(game, ai) as f64
        + f.get_or("weary", 0).f() / 2.0
        - 6.0 * lost_nodes(game, frm) as f64
        - 20.0 * R::FACTIONS().at(ai).at("personality").atf("aggr")
        + bonus(game, ai, frm, Some("paix"))
}

/// Le score de `ai` pour une alliance avec `frm`, sans tribut (accepte à 60).
fn score_alliance(game: &Game, ai: &str, frm: &str) -> f64 {
    let (pa, pb) = (game.faction_power(ai).max(1.0), game.faction_power(frm).max(1.0));
    let diplo = game.mod_(frm, "diplo", 0.0) + game.mod_(frm, "prestige", 0.0);
    let common = game.factions.keys().iter().any(|o| game.at_war(ai, o.s()) && game.at_war(frm, o.s()));
    let r = pb / pa;
    MEM::valeur(game, ai, frm) + diplo + (if common { 25.0 } else { 0.0 }) + (if FM::lie(game, ai, frm) { 20.0 } else { 0.0 })
        + 15.0 * (if r < 1.5 { r } else { 1.5 })
        + bonus(game, ai, frm, Some("alliance"))
}

/// Le score de `ai` pour un accord commercial avec `frm`, sans tribut (accepte à 20).
fn score_commerce(game: &Game, ai: &str, frm: &str) -> f64 {
    let diplo = game.mod_(frm, "diplo", 0.0) + game.mod_(frm, "prestige", 0.0);
    MEM::valeur(game, ai, frm) + 30.0 * R::FACTIONS().at(ai).at("personality").atf("trade") + diplo + bonus(game, ai, frm, Some("commerce"))
}

/// Ce camp est-il le joueur, qui répond lui-même (pas une simulation où son IA le gouverne) ?
fn attend_le_joueur(game: &Game, code: &str) -> bool {
    code == game.player && !game.ais.contains_key(code)
}

/// Le protecteur d'un camp (None : il est libre).
pub fn protecteur(game: &Game, code: &str) -> Option<String> {
    let o = game.factions.at(code).at("overlord");
    if o.truthy() { Some(o.string()) } else { None }
}

/// Un protectorat ne mène pas sa propre diplomatie : on traite avec son protecteur. Restent permis la guerre (que
/// war_refusal juge), les ruptures, les cadeaux, les prisonniers, et la paix avec qui n'est pas en guerre contre le
/// protecteur (une guerre à soi).
fn diplomatie_bloquee(game: &Game, frm: &str, to: &str, action: &str) -> Option<String> {
    if matches!(action, "guerre" | "rompre" | "fin_commerce" | "fin_passage" | "prisonniers" | "cadeau") {
        return None;
    }
    if let Some(ov) = protecteur(game, frm).filter(|ov| ov != to) {
        if !(action == "paix" && !game.at_war(&ov, to)) {
            return Some(format!("Un protectorat ne mène pas sa propre diplomatie : {} parle pour lui.", game.fname(&ov)));
        }
    }
    if let Some(ov) = protecteur(game, to).filter(|ov| ov != frm) {
        if !(action == "paix" && !game.at_war(&ov, frm)) {
            return Some(format!("{} est un protectorat de {} : adressez-vous à son protecteur.", game.fname(to), game.fname(&ov)));
        }
    }
    None
}

/// Ce que vaut une place cédée, en livres.
fn valeur_region(game: &Game, nid: i64) -> f64 {
    let (gn, n) = (game.geo.nodes.at(nid), game.nodes.at(nid));
    120.0 * crate::ai::VALUE().get_or(gn.at("type"), 2).f() + 60.0 * n.get_or("dev", 0).f() + n.get_or("pop", 0).f() / 200.0
}

/// La vue d'une clause en clair (« 200 livres », « Bordeaux », « la paix »…).
pub fn texte_clause(game: &Game, c: &Val) -> String {
    match c.ats("type").as_str() {
        "argent" => format!("{} livres", c.at("montant")),
        "tribut" => format!("{} livres par tour pendant {} tours", c.at("montant"), c.at("tours")),
        "region" => game.geo.nodes.at(c.at("node")).ats("name"),
        "technologie" => R::TECH().at(c.at("tech")).ats("name"),
        "passage" => "le droit de passage".to_string(),
        "commerce" => "un accord commercial".to_string(),
        "alliance" => "une alliance".to_string(),
        "paix" => "la paix".to_string(),
        "protectorat" => "son protectorat".to_string(),
        "independance" => "l'indépendance".to_string(),
        "cartes" => "ses cartes".to_string(),
        t => t.to_string(),
    }
}

fn texte_liste(game: &Game, l: &Val) -> String {
    if !l.truthy() {
        return "rien".to_string();
    }
    l.iter().map(|c| texte_clause(game, &c)).collect::<Vec<_>>().join(", ")
}

/// Une clause venue du navigateur (ou d'une IA), vérifiée : `giver` la donne à `receiver`. Rend la clause propre
/// ({type, …champs de R::CLAUSES}) ou la raison du refus.
pub fn lire_clause(game: &Game, giver: &str, receiver: &str, c: &Val) -> Result<Val, String> {
    let t = if c.is_dict() { c.get("type") } else { Val::None };
    if !t.is_str() || !R::CLAUSES().has(&t) {
        return Err("Clause inconnue.".to_string());
    }
    let entier = |k: &str| int_nav(&c.get_or(k, 0)).map_err(|e| format!("Commande invalide ({e})."));
    let (fg, fr) = (game.factions.at(giver), game.factions.at(receiver));
    let st = game.status(giver, receiver);
    let nom = game.fname(giver);
    let t = t.string();
    let out = dict! {"type" => &t};
    match t.as_str() {
        "argent" => {
            let m = entier("montant")?;
            if m <= 0 {
                return Err("Indiquez un montant.".to_string());
            }
            if fg.at("res").at("livres") < m {
                return Err(format!("{nom} n'a pas {m} livres."));
            }
            out.set("montant", m);
        }
        "tribut" => {
            let (m, n) = (entier("montant")?, entier("tours")?);
            if m <= 0 || n <= 0 || n > R::TRIBUT_TOURS_MAX {
                return Err(format!("Un tribut : un montant par tour, de 1 à {} tours.", R::TRIBUT_TOURS_MAX));
            }
            out.set("montant", m);
            out.set("tours", n);
        }
        "region" => {
            let nid = entier("node")?;
            if nid < 0 || nid >= game.nodes.len() as i64 {
                return Err("Place inconnue.".to_string());
            }
            let (n, gn) = (game.nodes.at(nid), game.geo.nodes.at(nid));
            if !n.at_is("owner", &giver) {
                return Err(format!("{nom} ne tient pas {}.", gn.at("name")));
            }
            if gn.at_is("type", "capitale") && gn.at_is("dept", &giver) {
                return Err("On ne cède pas sa capitale.".to_string());
            }
            if n.at("siege").truthy() {
                return Err(format!("{} est assiégée.", gn.at("name")));
            }
            out.set("node", nid);
        }
        "technologie" => {
            let tech = c.get("tech");
            if !tech.is_str() || !R::TECH().has(&tech) {
                return Err("Technologie inconnue.".to_string());
            }
            if !fg.at("techs").has(&tech) {
                return Err(format!("{nom} ne connaît pas cette technologie."));
            }
            if fr.at("techs").has(&tech) {
                return Err(format!("{} la connaît déjà.", game.fname(receiver)));
            }
            if R::TECH().at(&tech).at("req").iter().any(|q| !fr.at("techs").has(&q)) {
                return Err(format!("{} n'en a pas les prérequis.", game.fname(receiver)));
            }
            out.set("tech", tech);
        }
        "passage" => {
            if st != "paix" {
                return Err("Le droit de passage se donne en paix (des alliés passent déjà librement).".to_string());
            }
            if AA::has_passage(game, receiver, giver) {
                return Err("Le droit de passage court déjà.".to_string());
            }
        }
        "commerce" => {
            if st == "guerre" {
                return Err("Impossible de commercer avec un ennemi.".to_string());
            }
            if fg.at("trade").has(receiver) {
                return Err("Accord déjà en vigueur.".to_string());
            }
        }
        "alliance" => {
            if st == "guerre" {
                return Err("Faites d'abord la paix.".to_string());
            }
            if st == "alliance" {
                return Err("Déjà alliés.".to_string());
            }
        }
        "paix" => {
            if st != "guerre" {
                return Err("Pas de guerre à finir.".to_string());
            }
        }
        "protectorat" => {
            if fg.atb("overlord") || fr.atb("overlord") {
                return Err("Un protectorat ne passe pas sous une autre protection.".to_string());
            }
            if game.factions.values().iter().any(|f| f.at_is("overlord", &giver)) {
                return Err(format!("{nom} protège lui-même d'autres camps."));
            }
        }
        "independance" => {
            if !fr.at_is("overlord", &giver) {
                return Err(format!("{} n'est pas un protectorat de {nom}.", game.fname(receiver)));
            }
        }
        _ => {} // cartes
    }
    Ok(out)
}

/// Les clauses d'une proposition de frm à to ({donner: [...], recevoir: [...]}), vérifiées.
pub fn lire_clauses(game: &Game, frm: &str, to: &str, clauses: &Val) -> Result<Val, String> {
    if !clauses.is_dict() {
        return Err("Proposition invalide.".to_string());
    }
    let out = dict! {};
    let mut types: Vec<String> = vec![];
    for (cote, giver, receiver) in [("donner", frm, to), ("recevoir", to, frm)] {
        let l = clauses.get_or(cote, list![]);
        if !l.is_list() || l.len() > R::CLAUSES_MAX {
            return Err(format!("Au plus {} clauses de chaque côté.", R::CLAUSES_MAX));
        }
        let propres = list![];
        for c in l.iter() {
            let c = lire_clause(game, giver, receiver, &c)?;
            let t = c.ats("type");
            let cle = if c.has("node") { format!("{t}{}", c.at("node")) } else if c.has("tech") { format!("{t}{}", c.at("tech")) } else { format!("{cote}{t}") };
            let cle = if R::CLAUSES().at(&t).atb("mutuelle") { t.clone() } else { cle };
            if types.contains(&cle) {
                return Err(format!("Clause en double : {}.", R::CLAUSES().at(&t).at("nom")));
            }
            types.push(cle);
            propres.push(c);
        }
        out.set(cote, propres);
    }
    if !out.at("donner").truthy() && !out.at("recevoir").truthy() {
        return Err("Proposition vide.".to_string());
    }
    if types.contains(&"paix".to_string()) && types.iter().any(|t| t == "alliance" || t == "commerce") {
        return Err("La paix d'abord : l'alliance ou le commerce viendront ensuite.".to_string());
    }
    Ok(out)
}

/// Ce qu'un protectorat coûte ou rapporte à `ai` qui s'y soumettrait à `prot` : très cher, sauf devant une menace
/// écrasante dont `prot` peut le garder.
fn protection_voulue(game: &Game, ai: &str, prot: &str) -> f64 {
    let pa = game.faction_power(ai).max(1.0);
    let menace = game.factions.keys().iter().filter(|o| game.at_war(ai, o.s())).map(|o| game.faction_power(o.s())).fold(0.0, f64::max);
    let mut v = -2500.0 + 10.0 * MEM::valeur(game, ai, prot);
    if menace > 3.0 * pa && game.faction_power(prot) > 0.5 * menace {
        v += 3000.0;
    }
    v
}

/// Ce que vaut une clause, en livres, pour le camp `ai` (positif : il y gagne) ; ai_donne : c'est lui qui la donne. Une
/// clause mutuelle (paix, alliance, commerce) vaut la marge de son score d'acceptation.
pub fn valeur_clause(game: &Game, ai: &str, autre: &str, c: &Val, ai_donne: bool) -> f64 {
    let att = MEM::valeur(game, ai, autre);
    let argent = MEM::trait_(game, ai, "argent");
    match c.ats("type").as_str() {
        "argent" => if ai_donne { -c.atf("montant") } else { c.atf("montant") * argent },
        "tribut" => {
            let tot = c.atf("montant") * c.atf("tours");
            if ai_donne { -tot } else { 0.8 * tot * argent }
        }
        "region" => {
            let v = valeur_region(game, c.ati("node"));
            if ai_donne {
                -v * if game.geo.nodes.at(c.at("node")).at_is("dept", &ai) { 3.0 } else { 1.5 }
            } else {
                v * MEM::trait_(game, ai, "region")
            }
        }
        "technologie" => {
            let cost = R::TECH().at(c.at("tech")).atf("cost");
            if ai_donne { -0.2 * cost * if att < 0.0 { 2.0 } else { 1.0 } } else { 0.3 * cost }
        }
        "passage" | "cartes" => if ai_donne { -(80.0 + 3.0 * (-att).max(0.0)) } else { 60.0 },
        "paix" => (score_paix(game, ai, autre) - 45.0) * 12.0,
        "alliance" => (score_alliance(game, ai, autre) - 60.0) * 15.0,
        "commerce" => (score_commerce(game, ai, autre) - 20.0) * 10.0,
        "protectorat" => if ai_donne { protection_voulue(game, ai, autre) } else { 600.0 },
        "independance" => {
            if !ai_donne {
                1500.0
            } else if game.faction_power(autre) > 0.8 * game.faction_power(ai) {
                200.0 // (il ne se tient plus : mieux vaut le lâcher en ami)
            } else {
                -1000.0
            }
        }
        _ => 0.0,
    }
}

/// L'IA `ai` juge les clauses que `frm` lui propose (frm donne `donner`, demande `recevoir`) : ce qu'elle y gagne, moins
/// ce qu'elle cède (pesé selon son attitude, le prestige de frm, un diplomate présent). Rend (accepte, bilan en livres).
pub fn evaluer(game: &Game, ai: &str, frm: &str, cl: &Val) -> (bool, f64) {
    let (mut gains, mut couts) = (0.0, 0.0);
    let mut vus: Vec<String> = vec![];
    for (l, ai_donne) in [(cl.at("donner"), false), (cl.at("recevoir"), true)] {
        for c in l.iter() {
            let t = c.ats("type");
            if R::CLAUSES().at(&t).atb("mutuelle") {
                if vus.contains(&t) {
                    continue;
                }
                vus.push(t);
            }
            let v = valeur_clause(game, ai, frm, &c, ai_donne);
            if v >= 0.0 {
                gains += v;
            } else {
                couts -= v;
            }
        }
    }
    let diplo = game.mod_(frm, "diplo", 0.0) + game.mod_(frm, "prestige", 0.0);
    let mut k = 1.15 - MEM::valeur(game, ai, frm) / 400.0 - diplo / 200.0;
    if MEM::diplomate_present(game, frm, ai) {
        k -= R::DIPLOMATE_K;
    }
    let bilan = gains - couts * k.max(0.5);
    (bilan >= 0.0, bilan)
}

/// La contre-proposition de l'IA `ai` à une proposition de `frm` qu'elle refuse (bilan < 0), vue de frm : un complément en
/// argent comptant s'il peut le payer, sinon un tribut sur douze tours à sa mesure, sinon la même sans ce qu'elle cède de
/// plus cher. None : rien à proposer.
fn contre_proposition(game: &Game, ai: &str, frm: &str, cl: &Val, bilan: f64) -> Option<Val> {
    let manque = -bilan;
    let argent = MEM::trait_(game, ai, "argent");
    let donne: f64 = cl.at("donner").iter().filter(|c| c.at_is("type", "argent")).map(|c| c.atf("montant")).sum();
    let livres = game.factions.at(frm).at("res").atf("livres") - donne;
    let avec = |c: Val| -> Val {
        let d = cl.at("donner").iter().filter(|x| !x.at_is("type", &c.ats("type"))).collect::<Val>();
        d.push(c);
        dict! {"donner" => d, "recevoir" => cl.at("recevoir").copy()}
    };
    let m = (1.05 * manque / argent / 10.0).ceil() * 10.0; // (un peu plus que le manque : on ne marchande pas à la livre près)
    if m + donne <= 0.6 * livres + donne && m > 0.0 {
        let c = avec(dict! {"type" => "argent", "montant" => py::int(m + donne)});
        if evaluer(game, ai, frm, &c).0 {
            return Some(c);
        }
    }
    let revenu = game.factions.at(frm).at("income").get_or("livres", 0.0).f() * TT::TOUR_DAYS;
    let mt = (1.05 * manque / (0.8 * argent * 12.0)).ceil();
    if !cl.at("donner").iter().any(|c| c.at_is("type", "tribut")) && mt > 0.0 && mt <= 0.4 * revenu {
        let c = avec(dict! {"type" => "tribut", "montant" => py::int(mt), "tours" => 12});
        if evaluer(game, ai, frm, &c).0 {
            return Some(c);
        }
    }
    let rec = cl.at("recevoir");
    if rec.len() > 1 {
        let cher = py::min_by_key(rec.vec(), |c| py::int(valeur_clause(game, ai, frm, c, true))).unwrap();
        let c = dict! {"donner" => cl.at("donner").copy(), "recevoir" => rec.iter().filter(|x| *x != cher).collect::<Val>()};
        if evaluer(game, ai, frm, &c).0 {
            return Some(c);
        }
    }
    None
}

/// Les cartes de `giver` montrées à `receiver` : ses villes, quelques tours (comme un rapport d'espion).
fn donner_cartes(game: &mut Game, giver: &str, receiver: &str) {
    let until = TT::deadline(game, R::CARTES_TOURS, &[receiver]);
    let intel = game.factions.at(receiver).setdefault("intel", dict! {});
    for n in game.owned_nodes(giver).iter() {
        if matches!(game.geo.nodes.at(n.at("id")).ats("type").as_str(), "capitale" | "ville") {
            intel.set(n.ati("id").to_string(), until);
        }
    }
}

/// `receiver` apprend la technologie `tech` (sa recherche en cours, si c'était elle, s'arrête).
fn donner_tech(game: &mut Game, receiver: &str, tech: &Val) {
    let f = game.factions.at(receiver);
    f.at("techs").push(tech);
    f.setdefault("tech_dates", dict! {}).set(tech, list![game.date_str(&Val::None), py::round_n(game.t, 2)]);
    for (b, cur) in f.at("research").items() {
        if cur.truthy() && cur.at("tech") == *tech {
            f.at("research").set(&b, Val::None);
        }
    }
    game.recompute_mods(receiver);
}

/// Le protectorat `v` recouvre sa liberté.
pub fn liberer(game: &mut Game, v: &str) {
    let Some(over) = protecteur(game, v) else { return };
    let fv = game.factions.at(v);
    fv.set("overlord", Val::None);
    fv.set("_tribute", 0);
    game.set_status(v, &over, "paix");
    game._dirty_income = true;
    let texte = format!("{} recouvre son indépendance : le protectorat de {} prend fin.", game.fname(v), game.fname(&over));
    game.log("diplo", &texte, &dict! {"who" => v, "important" => true});
}

/// `giver` donne à `receiver` ce que dit la clause (déjà vérifiée).
fn executer_clause(game: &mut Game, giver: &str, receiver: &str, c: &Val) {
    match c.ats("type").as_str() {
        "argent" => {
            game.factions.at(giver).at("res").dec("livres", c.at("montant"));
            game.factions.at(receiver).at("res").inc("livres", c.at("montant"));
        }
        "tribut" => {
            let t = dict! {"a" => receiver, "montant" => c.at("montant"), "reste" => c.at("tours")};
            game.factions.at(giver).setdefault("tributs", list![]).push(t);
        }
        "region" => game.capture(c.ati("node"), receiver, true),
        "technologie" => donner_tech(game, receiver, &c.at("tech")),
        "passage" => AA::grant_passage(game, giver, receiver, AA::PASSAGE_TOURS),
        "commerce" => apply(game, giver, receiver, "commerce", 0, &Val::None, &Val::None),
        "alliance" => make_alliance(game, giver, receiver),
        "paix" => make_peace(game, giver, receiver),
        "protectorat" => make_vassal(game, giver, receiver),
        "independance" => liberer(game, receiver),
        "cartes" => donner_cartes(game, giver, receiver),
        _ => {}
    }
}

/// L'accord se conclut : frm donne `donner` à to, to donne `recevoir` à frm (la paix d'abord, le protectorat en dernier ;
/// une clause mutuelle une seule fois). Les deux s'en souviennent.
pub fn appliquer_clauses(game: &mut Game, frm: &str, to: &str, cl: &Val) {
    let mut toutes: Vec<(Val, &str, &str)> = vec![];
    for c in cl.at("donner").iter() {
        toutes.push((c, frm, to));
    }
    for c in cl.at("recevoir").iter() {
        toutes.push((c, to, frm));
    }
    let rang = |c: &Val| match c.ats("type").as_str() { "paix" => 0, "protectorat" | "independance" => 2, _ => 1 };
    toutes.sort_by_key(|x| rang(&x.0));
    let mut vus: Vec<String> = vec![];
    for (c, giver, receiver) in toutes {
        let t = c.ats("type");
        if R::CLAUSES().at(&t).atb("mutuelle") {
            if vus.contains(&t) {
                continue;
            }
            vus.push(t);
        }
        executer_clause(game, giver, receiver, &c);
    }
    MEM::retenir(game, frm, to, "accord", None);
    MEM::retenir(game, to, frm, "accord", None);
    let texte = format!(
        "Accord entre {} et {} : {} donne {} ; {} donne {}.",
        game.fname(frm), game.fname(to), game.fname(frm), texte_liste(game, &cl.at("donner")), game.fname(to), texte_liste(game, &cl.at("recevoir"))
    );
    let important = frm == game.player || to == game.player;
    game.log("diplo", &texte, &dict! {"who" => frm, "important" => important});
}

/// Le camp joueur reçoit une proposition (action, champs propres) ; texte : ce que le journal en dit.
fn au_joueur(game: &mut Game, frm: &str, action: &str, champs: Val, texte: String) {
    let p = dict! {
        "id" => game.nid("p"), "frm" => frm, "action" => action, "amount" => 0, "give" => Val::None, "get" => Val::None,
        "expires" => TT::deadline(game, R::PROPOSAL_TOURS, &[]), "date" => game.date_str(&Val::None)
    };
    p.update(&champs);
    game.proposals.push(p);
    game.log("diplo", &format!("{texte} : répondez pendant votre tour."), &dict! {"who" => frm, "important" => true});
    game.alert_pause(false);
}

/// Une proposition composée de frm à to : clauses {donner: [...], recevoir: [...]} (ce que frm donne, ce qu'il demande).
/// Une IA l'accepte, la refuse, ou (au joueur) fait une contre-proposition qu'il trouvera dans ses propositions reçues.
pub fn proposer(game: &mut Game, frm: &str, to: &Val, clauses: &Val) -> (Option<bool>, String) {
    if !to.is_str() || !game.factions.has(to) || !game.factions.at(to).atb("alive") || *to == frm {
        return (Some(false), "Département invalide.".to_string());
    }
    let to = to.string();
    if let Some(why) = diplomatie_bloquee(game, frm, &to, "proposer") {
        return (Some(false), why);
    }
    let cl = match lire_clauses(game, frm, &to, clauses) {
        Ok(cl) => cl,
        Err(e) => return (Some(false), e),
    };
    if attend_le_joueur(game, &to) {
        let texte = format!(
            "{} vous propose un accord (il donne {} ; il demande {})",
            game.fname(frm), texte_liste(game, &cl.at("donner")), texte_liste(game, &cl.at("recevoir"))
        );
        au_joueur(game, frm, "proposition", dict! {"clauses" => cl, "contre_proposition" => false}, texte);
        return (None, "Proposition envoyée.".to_string());
    }
    let (ok, bilan) = evaluer(game, &to, frm, &cl);
    let nom = game.fname(&to);
    if ok {
        appliquer_clauses(game, frm, &to, &cl);
        return (Some(true), format!("{nom} accepte l'accord."));
    }
    let contre = if attend_le_joueur(game, frm) { contre_proposition(game, &to, frm, &cl, bilan) } else { None };
    let rel = game.factions.at(&to).at("rel");
    rel.set(frm, vmax(-100, &rel.at(frm) - 1i64));
    if let Some(c) = contre {
        // (vue de l'IA : elle donne ce que le joueur demandait, elle demande ce qu'il donnait, et le complément)
        let sienne = dict! {"donner" => c.at("recevoir"), "recevoir" => c.at("donner")};
        let texte = format!(
            "{nom} refuse votre proposition mais en fait une autre (il donne {} ; il demande {})",
            texte_liste(game, &sienne.at("donner")), texte_liste(game, &sienne.at("recevoir"))
        );
        au_joueur(game, &to, "proposition", dict! {"clauses" => sienne, "contre_proposition" => true}, texte.clone());
        return (Some(false), format!("{texte}."));
    }
    (Some(false), format!("{nom} refuse : l'accord ne lui convient pas (il y perdrait {} livres).", py::int(-bilan)))
}

/// Une exigence d'ultimatum, vérifiée : {type: "region", node} (une place de `cible`), {type: "tribut", montant, tours},
/// {type: "rompre", allie} (une alliance de `cible`).
fn lire_exigence(game: &Game, frm: &str, cible: &str, e: &Val) -> Result<Val, String> {
    let t = if e.is_dict() { e.get("type") } else { Val::None };
    if t == "rompre" {
        let allie = e.get("allie");
        if !allie.is_str() || !game.factions.has(&allie) || allie == frm || game.status(cible, allie.s()) != "alliance" {
            return Err(format!("{} n'a pas cette alliance.", game.fname(cible)));
        }
        if game.factions.at(&allie).at_is("overlord", &cible) || game.factions.at(cible).at_is("overlord", allie.s()) {
            return Err("Un protectorat ne se rompt pas ainsi.".to_string());
        }
        return Ok(dict! {"type" => "rompre", "allie" => allie});
    }
    if t == "region" || t == "tribut" {
        return lire_clause(game, cible, frm, e);
    }
    Err("Exigence inconnue (une région, un tribut, une rupture d'alliance).".to_string())
}

fn texte_exigence(game: &Game, e: &Val) -> String {
    if e.at_is("type", "rompre") { format!("la rupture de son alliance avec {}", game.fname(e.at("allie").s())) } else { texte_clause(game, e) }
}

/// L'IA `cible` cède-t-elle à l'ultimatum de `frm` ? Devant un camp au moins R::ULTIMATUM_RAPPORT fois plus fort, si la peur
/// (rapport des forces, caractère, rancune) couvre ce qu'on lui demande.
pub fn cede_a_l_ultimatum(game: &Game, cible: &str, frm: &str, e: &Val) -> bool {
    let ratio = game.faction_power(frm) / game.faction_power(cible).max(1.0);
    let cout = match e.ats("type").as_str() {
        "rompre" => 300.0 + 10.0 * MEM::valeur(game, cible, e.at("allie").s()).max(0.0),
        _ => -valeur_clause(game, cible, frm, e, true),
    };
    let peur = 40.0 * (ratio - 1.0) + MEM::trait_(game, cible, "menace") - (-MEM::valeur(game, cible, frm)).max(0.0) / 4.0;
    ratio >= R::ULTIMATUM_RAPPORT && peur * 15.0 >= cout
}

/// `cible` cède à l'exigence de `frm`.
fn executer_exigence(game: &mut Game, cible: &str, frm: &str, e: &Val) {
    if e.at_is("type", "rompre") {
        let allie = e.ats("allie");
        game.set_status(cible, &allie, "paix");
        MEM::retenir(game, &allie, cible, "trahison", None);
    } else {
        executer_clause(game, cible, frm, e);
    }
    let texte = format!("{} cède à l'ultimatum {} : {}.", game.fname(cible), R::de(&game.fname(frm)), texte_exigence(game, e));
    let important = frm == game.player || cible == game.player;
    game.log("diplo", &texte, &dict! {"who" => frm, "important" => important});
}

/// `cible` rejette l'ultimatum de `frm` : frm tient un casus belli contre lui (une guerre qui ne fâche personne).
fn refuser_ultimatum(game: &mut Game, frm: &str, cible: &str) {
    let until = TT::deadline(game, R::CASUS_BELLI_TOURS, &[frm, cible]);
    game.factions.at(frm).setdefault("cb", dict! {}).set(cible, until);
    let texte = format!("{} rejette l'ultimatum {} : casus belli.", game.fname(cible), R::de(&game.fname(frm)));
    let important = frm == game.player || cible == game.player;
    game.log("diplo", &texte, &dict! {"who" => cible, "important" => important});
}

/// Un ultimatum de frm à cible (exigence : voir lire_exigence). Une IA cède ou refuse (casus belli pour frm) ; le joueur
/// le trouve dans ses propositions reçues.
pub fn ultimatum(game: &mut Game, frm: &str, cible: &Val, exigence: &Val) -> (Option<bool>, String) {
    if !cible.is_str() || !game.factions.has(cible) || !game.factions.at(cible).atb("alive") || *cible == frm {
        return (Some(false), "Département invalide.".to_string());
    }
    let cible = cible.string();
    if let Some(why) = diplomatie_bloquee(game, frm, &cible, "ultimatum") {
        return (Some(false), why);
    }
    if game.at_war(frm, &cible) {
        return (Some(false), "Déjà en guerre : exigez plutôt sa soumission ou la paix à vos conditions.".to_string());
    }
    let e = match lire_exigence(game, frm, &cible, exigence) {
        Ok(e) => e,
        Err(why) => return (Some(false), why),
    };
    MEM::retenir(game, &cible, frm, "ultimatum", None);
    if attend_le_joueur(game, &cible) {
        let texte = format!("{} vous adresse un ultimatum : il exige {}, sous peine de guerre", game.fname(frm), texte_exigence(game, &e));
        au_joueur(game, frm, "ultimatum", dict! {"exigence" => e}, texte);
        return (None, "Ultimatum envoyé.".to_string());
    }
    let nom = game.fname(&cible);
    if cede_a_l_ultimatum(game, &cible, frm, &e) {
        executer_exigence(game, &cible, frm, &e);
        return (Some(true), format!("{nom} cède à l'ultimatum."));
    }
    refuser_ultimatum(game, frm, &cible);
    (Some(false), format!("{nom} rejette l'ultimatum : vous tenez un casus belli contre lui."))
}

/// Le seuil d'attitude au-dessus duquel `allie` répond à un appel aux armes : 15, moins pour un camp fidèle.
fn seuil_appel(game: &Game, allie: &str) -> f64 {
    15.0 - 30.0 * (MEM::trait_(game, allie, "fidelite") - 0.5)
}

/// L'IA `allie` répond-elle à l'appel aux armes de `frm` ?
pub fn repond_a_l_appel(game: &Game, allie: &str, frm: &str) -> bool {
    MEM::valeur(game, allie, frm) > seuil_appel(game, allie)
}

/// `allie` refuse l'appel aux armes de `frm` : frm s'en souvient, et rompt l'alliance s'il ne l'aime plus.
pub fn refuser_appel(game: &mut Game, frm: &str, allie: &str) {
    MEM::retenir(game, frm, allie, "appel_refuse", None);
    let rompue = MEM::valeur(game, frm, allie) < 0.0 && game.status(frm, allie) == "alliance";
    if rompue {
        game.set_status(frm, allie, "paix");
    }
    let texte = format!(
        "{} refuse l'appel aux armes {}{}.",
        game.fname(allie), R::de(&game.fname(frm)), if rompue { " : l'alliance est rompue" } else { "" }
    );
    let important = frm == game.player || allie == game.player;
    game.log("diplo", &texte, &dict! {"who" => frm, "important" => important});
}

/// frm, en guerre contre `contre`, appelle son allié `allie` aux armes. Une IA répond (selon son attitude et sa fidélité) ;
/// le joueur reçoit l'appel dans ses propositions.
pub fn appel(game: &mut Game, frm: &str, allie: &Val, contre: &Val) -> (Option<bool>, String) {
    let ok = |c: &Val| c.is_str() && game.factions.has(c) && game.factions.at(c).atb("alive") && *c != frm;
    if !ok(allie) || !ok(contre) || allie == contre {
        return (Some(false), "Département invalide.".to_string());
    }
    let (allie, contre) = (allie.string(), contre.string());
    if !game.at_war(frm, &contre) {
        return (Some(false), format!("Vous n'êtes pas en guerre contre {}.", game.fname(&contre)));
    }
    if game.status(frm, &allie) != "alliance" {
        return (Some(false), format!("{} n'est pas votre allié.", game.fname(&allie)));
    }
    if game.at_war(&allie, &contre) {
        return (Some(false), format!("{} est déjà en guerre contre {}.", game.fname(&allie), game.fname(&contre)));
    }
    if attend_le_joueur(game, &allie) {
        let texte = format!("{} vous appelle aux armes contre {}", game.fname(frm), game.fname(&contre));
        au_joueur(game, frm, "appel", dict! {"contre" => &contre}, texte);
        return (None, "Appel envoyé.".to_string());
    }
    let nom = game.fname(&allie);
    if war_refusal(game, &allie, &contre).is_none() && repond_a_l_appel(game, &allie, frm) {
        declare_war(game, &allie, &contre, false);
        MEM::retenir(game, frm, &allie, "aide", None);
        return (Some(true), format!("{nom} répond à votre appel et entre en guerre."));
    }
    refuser_appel(game, frm, &allie);
    (Some(false), format!("{nom} refuse de vous suivre dans cette guerre."))
}

/// Le joueur répond à une proposition, un ultimatum ou un appel (déjà retiré de game.proposals).
fn repondre(game: &mut Game, p: &Val, accept: bool) -> (bool, String) {
    let (frm, me) = (p.ats("frm"), game.player.clone());
    match p.ats("action").as_str() {
        "proposition" => {
            if !accept {
                let rel = game.factions.at(&frm).at("rel");
                rel.set(&me, vmax(-100, &rel.at(&me) - 4i64));
                return (true, "Proposition refusée.".to_string());
            }
            // (tout se revérifie : les stocks, les places, la guerre ont pu changer depuis)
            let cl = match lire_clauses(game, &frm, &me, &p.at("clauses")) {
                Ok(cl) => cl,
                Err(e) => return (false, format!("Cet accord n'est plus possible : {e}")),
            };
            appliquer_clauses(game, &frm, &me, &cl);
            (true, "Accord conclu.".to_string())
        }
        "ultimatum" => {
            if !accept {
                refuser_ultimatum(game, &frm, &me);
                return (true, format!("Ultimatum rejeté : {} tient un casus belli contre vous.", game.fname(&frm)));
            }
            match lire_exigence(game, &frm, &me, &p.at("exigence")) {
                Ok(e) => {
                    executer_exigence(game, &me, &frm, &e);
                    (true, "Vous cédez à l'ultimatum.".to_string())
                }
                Err(e) => (false, format!("Cette exigence n'a plus lieu d'être : {e}")),
            }
        }
        _ => {
            let contre = p.ats("contre");
            if !accept {
                refuser_appel(game, &frm, &me);
                return (true, "Appel aux armes refusé.".to_string());
            }
            if !game.at_war(&frm, &contre) || game.at_war(&me, &contre) {
                return (false, "Cet appel n'a plus lieu d'être.".to_string());
            }
            let (ok, msg) = declare_war(game, &me, &contre, false);
            if ok {
                MEM::retenir(game, &frm, &me, "aide", None);
            }
            (ok, msg)
        }
    }
}

/// La vue d'une proposition reçue (views) : ses clauses, son exigence, l'ennemi d'un appel, et un texte.
pub fn vue_proposition(game: &Game, p: &Val, d: &Val) {
    match p.ats("action").as_str() {
        "proposition" => {
            let cl = p.at("clauses");
            let vue = |l: Val| l.iter().map(|c| { let x = c.copy(); x.set("texte", texte_clause(game, &c)); x }).collect::<Val>();
            d.set("clauses", dict! {"donner" => vue(cl.at("donner")), "recevoir" => vue(cl.at("recevoir"))});
            d.set("contre_proposition", p.get_or("contre_proposition", false));
            d.set("texte", format!("Il donne {} ; il demande {}.", texte_liste(game, &cl.at("donner")), texte_liste(game, &cl.at("recevoir"))));
        }
        "ultimatum" => {
            d.set("exigence", p.at("exigence"));
            d.set("texte", format!("Il exige {}, sous peine de guerre.", texte_exigence(game, &p.at("exigence"))));
        }
        "appel" => {
            d.set("contre", p.at("contre"));
            d.set("texte", format!("Il vous appelle aux armes contre {}.", game.fname(p.at("contre").s())));
        }
        _ => {}
    }
}

/// Les commandes diplomatiques de la page ({cmd: "diplo", sub, cible, …}) : "proposer" (clauses), "ultimatum"
/// (exigence), "appel" (contre), "repondre" (id, accepte) ; une autre sous-commande est une action d'avant (act).
pub fn commande(game: &mut Game, frm: &str, body: &Val) -> (Option<bool>, String) {
    let cible = body.get_or("cible", body.get("to"));
    match body.get("sub").or("").string().as_str() {
        "proposer" => proposer(game, frm, &cible, &body.get_or("clauses", dict! {})),
        "ultimatum" => ultimatum(game, frm, &cible, &body.get_or("exigence", dict! {})),
        "appel" => appel(game, frm, &cible, &body.get("contre")),
        "repondre" => {
            let (ok, msg) = answer(game, &body.get("id"), body.getb("accepte") || body.getb("accept"));
            (Some(ok), msg)
        }
        sub => {
            let give = body.get("give");
            let get = body.get("get");
            act(game, frm, &cible, &Val::from(sub), &body.get_or("amount", 0),
                &if give.truthy() { give.to_tuple() } else { Val::None }, &if get.truthy() { get.to_tuple() } else { Val::None })
        }
    }
}

/// Chaque mois : les tributs promis se paient (un tribut impayé fâche, une guerre l'annule), les souvenirs effacés s'en vont.
pub fn mois(game: &mut Game) {
    MEM::purger(game);
    for (code, f) in game.factions.items() {
        let l = f.get("tributs");
        if !l.truthy() {
            continue;
        }
        let code = code.string();
        let garde = list![];
        for t in l.iter() {
            let a = t.ats("a");
            if !f.atb("alive") || !game.factions.at(&a).atb("alive") || game.at_war(&code, &a) {
                continue;
            }
            let m = t.atf("montant");
            let livres = f.at("res").atf("livres").max(0.0);
            let paye = m.min(livres);
            f.at("res").dec("livres", paye);
            game.factions.at(&a).at("res").inc("livres", paye);
            if paye < m {
                MEM::retenir(game, &a, &code, "tribut_impaye", None);
            }
            t.dec("reste", 1);
            if t.ati("reste") > 0 {
                garde.push(t);
            }
        }
        f.set("tributs", garde);
    }
}
