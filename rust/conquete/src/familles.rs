//! Familles dirigeantes (SPEC-MERCENAIRES.md, « Familles et successions ») : la maison de chaque camp, son chef, ses
//! héritiers et ses mariages ; chaque année, naissances, morts et successions, et la crise quand il n'y a pas d'héritier.
//!
//!     f['maison'] = dict(nom, chef=dict(nom, ne, trait) | None (succession en cours), conjoint=None | dict(nom, de),
//!                        heritiers=[dict(nom, ne[, conjoint])], liens={camp: année du mariage})
//!
//! Porte game/familles.py (PORTAGE.md). Une signature ne se change pas sans
//! le signaler. Le hasard des familles est le leur (`_rng` : `Random::new_str`), sauf `appliquer` (g.rng).

use crate::diplomacy as D;
use crate::engine::Game;
use crate::events as EV;
use crate::py::{self, Random, Val};
use crate::rules as R;
use crate::{dict, list};

/// Python : `_rng(g, code, quoi)`.
/// `random.Random(f"{g.seed}-{année}-{code}-{quoi}")` : `Random::new_str`.
// game/familles.py, lignes 13 à 15
pub fn _rng(g: &Game, code: &str, quoi: &str) -> Random {
    // (son propre tirage, fixé par la partie, l'année et le camp : le hasard commun de la partie n'est pas décalé)
    Random::new_str(&format!("{}-{}-{}-{}", g.seed, g.date(&Val::None).year, code, quoi))
}

/// Python : `_trait(rnd)`.
/// Une clé de R::MAISON_TRAITS() (`rnd.choice(list(…))`, dans l'ordre du dict).
// game/familles.py, lignes 18 à 19
pub fn _trait(rnd: &mut Random) -> String {
    rnd.choice(&R::MAISON_TRAITS().keys()).string()
}

/// La maison d'un camp en début de partie, ou d'une ancienne sauvegarde au chargement.
/// Python : `nouvelle(g, code)`.
/// Rend le dict de la maison.
// game/familles.py, lignes 22 à 33
pub fn nouvelle(g: &Game, code: &str) -> Val {
    let mut rnd = _rng(g, code, "maison");
    let y = g.date(&Val::None).year;
    let nom = rnd.choice(&R::MAISON_NOMS().at(code).vec());
    let prenom = rnd.choice(&R::PRENOMS().vec());
    let ne = y - rnd.randint(28, 52);
    let chef = dict! {"nom" => format!("{prenom} {nom}"), "ne" => ne, "trait" => _trait(&mut rnd)};
    let m = dict! {"nom" => &nom, "chef" => &chef, "conjoint" => Val::None, "heritiers" => list![], "liens" => dict! {}};
    if rnd.random() < 0.7 {
        let pf = rnd.choice(&R::PRENOMS_F().vec());
        let sn = rnd.choice(&R::SURNAMES().vec());
        m.set("conjoint", dict! {"nom" => format!("{pf} {sn}"), "de" => Val::None});
        let lo = if chef.ati("ne") + 20 >= y - 20 { chef.ati("ne") + 20 } else { y - 20 };
        let mut her = vec![];
        for _ in 0..rnd.randint(0, 3) {
            let p = rnd.choice(&R::PRENOMS().vec());
            her.push(dict! {"nom" => format!("{p} {nom}"), "ne" => rnd.randint(lo, y)});
        }
        m.set("heritiers", Val::list(py::sorted_by_key(her, |h| h.ati("ne"))));
    }
    m
}

/// Python : `titre(g)`.
// game/familles.py, lignes 36 à 38
pub fn titre(g: &Game) -> String {
    let y = g.date(&Val::None).year;
    let t: Vec<Val> = R::MAISON_TITRES().iter().filter(|p| p.ati(0) <= y).map(|p| p.at(1)).collect();
    t[t.len() - 1].string()
}

/// Les maisons de a et b sont-elles unies par un mariage ?
/// Python : `lie(g, a, b)`.
// game/familles.py, lignes 41 à 43
pub fn lie(g: &Game, a: &str, b: &str) -> bool {
    let m = g.factions.at(a).get("maison");
    let m = if m.truthy() { m } else { dict! {} };
    m.get_or("liens", dict! {}).has(b)
}

/// Qui la maison peut marier : le chef s'il est seul, sinon l'aîné des héritiers libres (None : personne).
/// Python : `epoux(g, code)`.
/// Rend la personne (le dict du chef ou d'un héritier : le même objet, que marier modifie), ou None.
// game/familles.py, lignes 46 à 54
pub fn epoux(g: &Game, code: &str) -> Val {
    let m = g.factions.at(code).get("maison");
    if !m.truthy() || !m.atb("chef") {
        return Val::None;
    }
    let y = g.date(&Val::None).year;
    let adulte = |p: &Val| y - p.ati("ne") >= R::MARIAGE_AGE;
    if !m.atb("conjoint") {
        return if adulte(&m.at("chef")) { m.at("chef") } else { Val::None };
    }
    m.at("heritiers").iter().find(|h| !h.getb("conjoint") && adulte(h)).unwrap_or(Val::None)
}

/// Raison pour laquelle a et b ne peuvent pas marier leurs maisons (None : ils le peuvent).
/// Python : `refus_mariage(g, a, b)`.
// game/familles.py, lignes 57 à 66
pub fn refus_mariage(g: &Game, a: &str, b: &str) -> Option<String> {
    if g.at_war(a, b) {
        return Some("Pas de mariage avec un ennemi.".to_string());
    }
    if lie(g, a, b) {
        return Some("Vos deux maisons sont déjà unies par un mariage.".to_string());
    }
    for x in [a, b] {
        if !epoux(g, x).truthy() {
            return Some(format!("{} n'a personne à marier (ni chef seul, ni héritier libre).", g.fname(x)));
        }
    }
    None
}

/// Mariage entre les maisons de a et b : chacun marie son chef seul ou son aîné libre à une fille de l'autre maison.
/// Python : `marier(g, a, b)`.
/// Piège : `p is m['chef']` est une identité (`Val::is`).
// game/familles.py, lignes 69 à 86
pub fn marier(g: &mut Game, a: &str, b: &str) {
    let y = g.date(&Val::None).year;
    let mut noms = vec![];
    for (x, o) in [(a, b), (b, a)] {
        let (m, p) = (g.factions.at(x).at("maison"), epoux(g, x));
        let prenom = _rng(g, x, &format!("mariage-{o}")).choice(&R::PRENOMS_F().vec());
        let c = dict! {"nom" => format!("{prenom} {}", g.factions.at(o).at("maison").at("nom")), "de" => o};
        if p.is(&m.at("chef")) {
            m.set("conjoint", &c);
        } else {
            p.set("conjoint", &c);
        }
        m.at("liens").set(o, y);
        let rel = g.factions.at(x).at("rel");
        let v = &rel.at(o) + R::MARIAGE_REL;
        rel.set(o, if v < 100i64 { v } else { Val::from(100) });
        noms.push(format!("{} épouse {}", p.at("nom"), c.at("nom")));
    }
    let p = g.player.clone();
    let important = p == a || p == b || D::borders(g, &p, a) || D::borders(g, &p, b);
    let t = format!("Mariage entre les maisons {} et {} : {}.", R::de(&g.fname(a)), R::de(&g.fname(b)), noms.join(" ; "));
    g.log("diplo", &t, &dict! {"who" => a, "important" => important});
}

/// a déclare la guerre à b (diplomacy.declare_war) : contre une maison alliée par mariage, son pays gronde.
/// Python : `guerre(g, a, b)`.
// game/familles.py, lignes 89 à 97
pub fn guerre(g: &mut Game, a: &str, b: &str) {
    if !lie(g, a, b) {
        return;
    }
    let tm = g.factions.at(a).setdefault("tmods", list![]);
    tm.push(dict! {"k" => "order", "v" => -0.1, "until" => g.t + R::PARJURE_JOURS as f64});
    g.recompute_mods(a);
    if a == g.player {
        let t = format!(
            "Faire la guerre à une maison alliée par mariage indigne le pays : ordre public −10 % pendant {} mois.",
            py::floordiv_i(R::PARJURE_JOURS, 30)
        );
        g.log("revolte", &t, &dict! {"important" => true});
    }
}

// ------------------------------------------------------------------ chaque année

/// En janvier (Game.monthly) : naissances, puis la mort du chef selon son âge.
/// Python : `annuel(g)`.
// game/familles.py, lignes 101 à 116
pub fn annuel(g: &mut Game) {
    let y = g.date(&Val::None).year;
    for (code, f) in g.factions.items() {
        let code = code.string();
        let m = f.get("maison");
        if !f.atb("alive") || !m.truthy() || !m.atb("chef") {
            continue;
        }
        let mut rnd = _rng(g, &code, "vie");
        let age = y - m.at("chef").ati("ne");
        if m.atb("conjoint")
            && age < R::NAISSANCE_AGE
            && (m.at("heritiers").len() as i64) < R::HERITIERS_MAX
            && rnd.random() < R::NAISSANCE_P
        {
            let p = rnd.choice(&R::PRENOMS().vec());
            m.at("heritiers").push(dict! {"nom" => format!("{p} {}", m.at("nom")), "ne" => y});
            if code == g.player {
                let t = format!("Naissance dans votre maison : {}.", m.at("heritiers").at(-1).at("nom"));
                g.log("info", &t, &dict! {"who" => &code});
            }
        }
        // rare avant 50 ans, puis de plus en plus probable (12 % à 60 ans, 36 % à 80 ans)
        let x = (age - 50) as f64 * 0.012;
        let x = if x > 0.005 { x } else { 0.005 };
        if rnd.random() < if x < 0.6 { x } else { 0.6 } {
            mort(g, &code, &mut rnd);
        }
    }
}

/// Le chef meurt : l'aîné des héritiers lui succède ; sans héritier, crise de succession.
/// Python : `mort(g, code, rnd)`.
/// rnd : le hasard de l'année du camp (_rng(g, code, 'vie')), passé par annuel.
// game/familles.py, lignes 119 à 138
pub fn mort(g: &mut Game, code: &str, rnd: &mut Random) {
    let f = g.factions.at(code);
    let (m, chef) = (f.at("maison"), f.at("maison").at("chef"));
    let age = g.date(&Val::None).year - chef.ati("ne");
    let player = g.player.clone();
    let imp = code == player || D::borders(g, &player, code);
    let qui = format!("{}, {} {}", chef.at("nom"), titre(g).to_lowercase(), R::de(&g.fname(code)));
    if m.atb("heritiers") {
        let h = py::min_by_key(m.at("heritiers").vec(), |x| x.at("ne")).unwrap();
        m.at("heritiers").remove(&h);
        m.set("chef", dict! {"nom" => h.at("nom"), "ne" => h.at("ne"), "trait" => _trait(rnd)});
        m.set("conjoint", h.get("conjoint"));
        g.recompute_mods(code);
        let t = format!(
            "Mort {}, à {age} ans. Son aîné {} lui succède ({}).",
            R::de(&qui),
            h.at("nom"),
            R::MAISON_TRAITS().at(m.at("chef").at("trait")).at("label").s().to_lowercase()
        );
        g.log("evenement", &t, &dict! {"who" => code, "important" => imp});
        return;
    }
    m.set("chef", Val::None);
    m.set("conjoint", Val::None);
    let t = format!("Mort {}, à {age} ans, sans héritier : crise de succession.", R::de(&qui));
    g.log("evenement", &t, &dict! {"who" => code, "important" => imp});
    crise(g, code, &chef, rnd);
}

/// Crise de succession : six mois de désordre, et un événement à choix (le cousin, le plus prudent, en dernier).
/// Python : `crise(g, code, chef, rnd)`.
/// chef : le dict du chef mort.
// game/familles.py, lignes 141 à 171
pub fn crise(g: &mut Game, code: &str, chef: &Val, rnd: &mut Random) {
    let f = g.factions.at(code);
    let m = f.at("maison");
    let y = g.date(&Val::None).year;
    EV::apply(g, code, &dict! {"tmod" => dict! {"order" => -0.1}, "days" => R::CRISE_JOURS}, &Val::None);
    // le prétendant étranger : la maison alliée par mariage que l'on aime le plus
    let lies: Vec<Val> = m
        .at("liens")
        .iter()
        .filter(|o| {
            let fo = g.factions.at(o);
            fo.atb("alive") && fo.at("maison").atb("chef") && !g.at_war(code, o.s()) && fo.at("overlord") != code
        })
        .collect();
    let pret = py::max_by_key(lies, |o| f.at("rel").at(o)).unwrap_or(Val::None);
    let autres: Vec<Val> = R::MAISON_NOMS().at(code).iter().filter(|n| *n != m.at("nom")).collect();
    let choices = list![];
    if pret.truthy() {
        let mp = g.factions.at(&pret).at("maison");
        let nom = format!("{} {}", rnd.choice(&R::PRENOMS().vec()), mp.at("nom"));
        let label = format!("Reconnaître le prétendant {nom} : vassalité envers {}", g.fname(pret.s()));
        let ne = y - rnd.randint(20, 40);
        let chef_ = dict! {"nom" => &nom, "ne" => ne, "trait" => _trait(rnd), "maison" => mp.at("nom")};
        // (une IA ne s'y résout guère : banc de 1700)
        let ai = if f.at("rel").at(&pret) > 60i64 { Val::from(1) } else { Val::from(0.2) };
        choices.push(dict! {"label" => label, "fx" => dict! {"chef" => chef_, "vassal" => &pret}, "ai" => ai});
    }
    let nom = rnd.choice(&autres);
    let label = format!("Faire élire un notable, {nom}");
    let prenom = rnd.choice(&R::PRENOMS().vec());
    let ne = y - rnd.randint(35, 55);
    let chef_ = dict! {"nom" => format!("{prenom} {nom}"), "ne" => ne, "trait" => _trait(rnd), "maison" => &nom};
    let fx = dict! {"res" => dict! {"livres" => -300}, "chef" => chef_};
    if pret.truthy() {
        fx.set("refus", &pret);
    }
    choices.push(dict! {"label" => label, "fx" => fx, "ai" => 2});
    let label = format!("Appeler un cousin de la maison {}", m.at("nom"));
    let prenom = rnd.choice(&R::PRENOMS().vec());
    let ne = y - rnd.randint(25, 45);
    let chef_ = dict! {"nom" => format!("{prenom} {}", m.at("nom")), "ne" => ne, "trait" => _trait(rnd)};
    let fx = dict! {"stab" => -0.08, "chef" => chef_};
    if pret.truthy() {
        fx.set("refus", &pret);
    }
    choices.push(dict! {"label" => label, "fx" => fx, "ai" => 2});
    let suite = if pret.truthy() {
        format!(" {}, uni à la maison par mariage, fait valoir ses droits : le refuser peut mener à la guerre.", g.fname(pret.s()))
    } else {
        String::new()
    };
    let text = format!(
        "{} meurt sans héritier ; les factions se disputent sa place. Six mois de désordre : ordre public −10 % dans tout le pays.{suite}",
        chef.at("nom")
    );
    let ev = dict! {"id" => "crise_succession", "who" => list![code], "title" => "Crise de succession", "choices" => choices, "text" => text};
    EV::fire(g, code, &ev, "hist");
}

/// Les effets d'un choix de crise de succession (events.apply) : le nouveau chef, la vassalité, le refus.
/// Python : `appliquer(g, code, fx)`.
// game/familles.py, lignes 174 à 191
pub fn appliquer(g: &mut Game, code: &str, fx: &Val) {
    let m = g.factions.at(code).at("maison");
    if fx.getb("chef") {
        let c = fx.at("chef").copy();
        let nom = if c.has("maison") { c.pop("maison") } else { m.at("nom") };
        m.set("nom", nom);
        m.set("chef", c);
        m.set("conjoint", Val::None);
    }
    let o = fx.get("vassal");
    if o.truthy() && g.factions.at(&o).atb("alive") && g.factions.at(&o).at("overlord") != code {
        D::make_vassal(g, code, o.s());
    }
    let o = fx.get("refus");
    // le prétendant éconduit (une IA) peut prendre les armes : guerre de succession
    if o.truthy()
        && o != g.player
        && g.factions.at(&o).atb("alive")
        && D::war_refusal(g, o.s(), code).is_none()
        && g.rng.random() < 0.3 + 0.4 * R::FACTIONS().at(&o).at("personality").atf("aggr")
    {
        let t = format!("{} revendique la succession {} : guerre de succession !", g.fname(o.s()), R::de(&g.fname(code)));
        g.log("diplo", &t, &dict! {"who" => &o, "important" => true});
        D::declare_war(g, o.s(), code, false);
    }
}

/// Les effets propres aux crises de succession, en clair (events.describe).
/// Python : `decrire(g, fx)`.
/// Rend une liste de textes (events.describe l'ajoute à la sienne).
// game/familles.py, lignes 194 à 203
pub fn decrire(g: &Game, fx: &Val) -> Val {
    let out = list![];
    if fx.getb("chef") {
        let c = fx.at("chef");
        out.push(format!("nouveau chef : {} ({})", c.at("nom"), R::MAISON_TRAITS().at(c.at("trait")).at("label").s().to_lowercase()));
    }
    if fx.getb("vassal") {
        out.push(format!("vassal {}", R::de(&g.fname(fx.at("vassal").s()))));
    }
    if fx.getb("refus") {
        out.push(format!("{} éconduit peut déclarer la guerre", g.fname(fx.at("refus").s())));
    }
    out
}

/// La maison pour la carte du camp (Diplomatie).
/// Python : `vue(g, code)`.
/// Rend un dict, ou None.
// game/familles.py, lignes 206 à 215
pub fn vue(g: &Game, code: &str) -> Val {
    let m = g.factions.at(code).get("maison");
    if !m.truthy() {
        return Val::None;
    }
    let (y, ch) = (g.date(&Val::None).year, m.at("chef"));
    let tr = if ch.truthy() { R::MAISON_TRAITS().at(ch.at("trait")) } else { Val::None };
    let her: Val = m.at("heritiers").iter().map(|h| Val::from(y - h.ati("ne"))).collect();
    let liens = Val::list(py::sorted_by_key(m.at("liens").keys(), |k| k.clone()));
    let chef = if ch.truthy() {
        dict! {"nom" => ch.at("nom"), "age" => y - ch.ati("ne"), "trait" => tr.at("label"), "desc" => tr.at("desc")}
    } else {
        Val::None
    };
    dict! {
        "nom" => m.at("nom"), "titre" => titre(g), "conjoint" => m.at("conjoint"), "her" => her, "liens" => liens,
        "libre" => epoux(g, code).truthy(), "chef" => chef
    }
}
