//! (SPEC-POLITIQUE, module 6) Le caractère des camps, leur mémoire et leur attitude.
//!
//! - `factions[c].caractere` : une clé de R::CARACTERES, tirée à la création de la partie (selon le profil du pays, son
//!   histoire et la graine : stable pour la partie), posée au chargement d'une sauvegarde d'avant.
//! - `factions[a].memoire[b]` : ce dont a se souvient de b, une liste de faits `[jour, fait, poids, demi-vie]` (R::MEMOIRE) ;
//!   le poids s'efface de moitié à chaque demi-vie. Posée au premier fait (une sauvegarde d'avant n'en a pas).
//! - L'attitude de a envers b : sa relation (`rel`, qui bouge comme avant et que le reste du jeu lit toujours) + les faits
//!   de sa mémoire + la situation (régime semblable, diplomate de b à sa cour), bornée à ±100, avec ses raisons.

use crate::engine::Game;
use crate::py::{Random, Val};
use crate::rules as R;
use crate::{dict, list};

/// `d.get(k)` qui rend None aussi quand d n'est pas un dict (None : une clé absente d'une sauvegarde d'avant).
fn champ(d: &Val, k: &str) -> Val {
    if d.is_dict() { d.get(k) } else { Val::None }
}

/// Le caractère tiré pour un camp : le profil du pays (agressivité, commerce, expansion) qui donne un penchant à chaque
/// caractère, un bonus pour celui que l'histoire lui prête, et le hasard de la graine.
pub fn tirer_caractere(seed: i64, code: &str) -> String {
    let p = champ(&R::FACTIONS().get(code), "personality");
    let k = |c: &str| if p.is_some() { p.get_or(c, 0.5).f() } else { 0.5 };
    let (aggr, trade, expand) = (k("aggr"), k("trade"), k("expand"));
    let penchants = [
        ("agressif", aggr),
        ("expansionniste", 0.9 * expand),
        ("marchand", 0.85 * trade),
        ("prudent", 0.8 * (1.0 - aggr)),
        ("loyal", 0.45 + 0.3 * (0.5 - (aggr - 0.5).abs())),
        ("opportuniste", 0.5),
    ];
    let mut rng = Random::new_str(&format!("{seed}-caractere-{code}"));
    let histoire = R::CARACTERE_HISTOIRE.iter().find(|x| x.0 == code).map(|x| x.1);
    let mut best = ("opportuniste", f64::MIN);
    for (c, v) in penchants {
        let v = v + 0.3 * rng.random() + if histoire == Some(c) { R::CARACTERE_HISTOIRE_BONUS } else { 0.0 };
        if v > best.1 {
            best = (c, v);
        }
    }
    best.0.to_string()
}

/// Le caractère d'un camp (tiré s'il manque : une sauvegarde d'avant, avant migrate).
pub fn caractere(g: &Game, code: &str) -> String {
    let c = champ(&g.factions.get(code), "caractere");
    if c.is_str() && R::CARACTERES().has(&c) { c.string() } else { tirer_caractere(g.seed, code) }
}

/// Un trait chiffré du caractère d'un camp (R::CARACTERES : guerre, paix, alliance, commerce, fidelite, argent, region,
/// menace, rancune).
pub fn trait_(g: &Game, code: &str, k: &str) -> f64 {
    R::CARACTERES().at(caractere(g, code)).atf(k)
}

/// Le poids d'un fait de mémoire au jour t.
fn poids(fait: &Val, t: f64) -> f64 {
    fait.atf(2) * 0.5f64.powf((t - fait.atf(0)).max(0.0) / fait.atf(3))
}

/// `qui` se souvient d'un fait de `de` (une clé de R::MEMOIRE) ; poids : celui de la règle par défaut. Un mauvais souvenir
/// pèse selon la rancune de `qui` ; un même fait répété dans le mois s'ajoute au précédent (au plus le double du poids).
pub fn retenir(g: &Game, qui: &str, de: &str, fait: &str, poids_: Option<f64>) {
    if qui == de || !g.factions.has(qui) || !g.factions.has(de) {
        return;
    }
    let regle = R::MEMOIRE().at(fait);
    let base = regle.atf("poids");
    let mut p = poids_.unwrap_or(base);
    if p < 0.0 {
        p *= trait_(g, qui, "rancune");
    }
    let l = g.factions.at(qui).setdefault("memoire", dict! {}).setdefault(de, list![]);
    // les faits effacés s'en vont
    l.replace_all(l.iter().filter(|x| poids(x, g.t).abs() >= 0.5).collect());
    if let Some(dernier) = l.iter().filter(|x| x.at_is(1, fait) && g.t - x.atf(0) < R::MEMOIRE_FUSION).last() {
        let cap = 2.0 * base.abs().max(p.abs());
        let v = (poids(&dernier, g.t) + p).clamp(-cap, cap);
        dernier.set(0, g.t);
        dernier.set(2, v);
        return;
    }
    l.push(list![g.t, fait, p, regle.atf("demi_vie")]);
    while l.len() as i64 > R::MEMOIRE_MAX {
        l.del(0);
    }
}

/// La somme des souvenirs de a envers b, aujourd'hui.
pub fn somme(g: &Game, a: &str, b: &str) -> f64 {
    let m = g.factions.at(a).get("memoire");
    if !m.truthy() {
        return 0.0;
    }
    let l = m.get(b);
    if !l.truthy() {
        return 0.0;
    }
    l.iter().map(|x| poids(&x, g.t)).sum()
}

/// Le régime d'un camp (module 5, `factions[c].politique.regime`), s'il y en a un.
fn regime(g: &Game, code: &str) -> Val {
    champ(&g.factions.at(code).get("politique"), "regime")
}

/// La situation entre a et b qui pèse sur l'attitude de a : (texte, valeur).
fn situation(g: &Game, a: &str, b: &str) -> Vec<(&'static str, f64)> {
    let mut out = vec![];
    let (ra, rb) = (regime(g, a), regime(g, b));
    if ra.is_str() && rb.is_str() {
        out.push(if ra == rb { ("Régime semblable", R::ATT_REGIME) } else { ("Régimes différents", -R::ATT_REGIME / 2.0) });
    }
    if diplomate_present(g, b, a) {
        out.push(("Un diplomate à notre cour", R::ATT_DIPLOMATE));
    }
    out
}

/// L'attitude de a envers b (de −100 à 100) : ce que les IA consultent pour décider.
pub fn valeur(g: &Game, a: &str, b: &str) -> f64 {
    let rel = g.factions.at(a).at("rel").get_or(b, 0).f();
    (rel + somme(g, a, b) + situation(g, a, b).iter().map(|x| x.1).sum::<f64>()).clamp(-100.0, 100.0)
}

/// L'attitude de a envers b et ses raisons ({texte, valeur}) : la relation, chaque souvenir qui pèse encore, la situation.
pub fn vue(g: &Game, a: &str, b: &str) -> Val {
    let raisons = list![];
    let rel = g.factions.at(a).at("rel").get_or(b, 0).f();
    raisons.push(dict! {"texte" => "Relations", "valeur" => crate::py::round(rel)});
    let m = g.factions.at(a).get("memoire");
    if m.truthy() {
        for x in m.get(b).or(list![]).iter() {
            let p = poids(&x, g.t);
            if p.abs() >= 1.0 {
                let texte = format!("{} ({})", R::MEMOIRE().at(x.at(1)).ats("texte"), g.date_str(&x.at(0)));
                raisons.push(dict! {"texte" => texte, "valeur" => crate::py::round(p)});
            }
        }
    }
    for (texte, v) in situation(g, a, b) {
        raisons.push(dict! {"texte" => texte, "valeur" => crate::py::round(v)});
    }
    dict! {"valeur" => crate::py::round(valeur(g, a, b)), "raisons" => raisons}
}

/// Un diplomate de `code` est-il posté chez `chez` (module 4) ?
/// En attendant `agents::diplomate_present(g, code, chez)` (R7) : `factions[code].diplomates`, la liste des camps où il
/// en a un (posée par les essais). À brancher sur R7 à la fusion.
pub fn diplomate_present(g: &Game, code: &str, chez: &str) -> bool {
    let d = champ(&g.factions.get(code), "diplomates");
    d.is_list() && d.has(chez)
}

/// Une fois par mois : les souvenirs effacés s'en vont (la sauvegarde ne grossit pas).
pub fn purger(g: &Game) {
    for f in g.factions.values() {
        let m = f.get("memoire");
        if !m.truthy() {
            continue;
        }
        for (b, l) in m.items() {
            l.replace_all(l.iter().filter(|x| poids(x, g.t).abs() >= 0.5).collect());
            if !l.truthy() {
                m.del(&b);
            }
        }
    }
}
