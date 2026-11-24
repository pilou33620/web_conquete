//! L'IA en politique intérieure (SPEC-POLITIQUE, module 5) : elle répartit son impôt entre noblesse et peuple (la
//! moyenne reste celle que règle son économie, ai/gouvernement.rs), pourvoit les postes vacants et remplace un ministre
//! incapable, et choisit devant une révolution selon son caractère. Léger : une fois par mois, sans chemin ni carte.

use crate::engine::politique as PO;
use crate::engine::{Date, Game};
use crate::py::Val;
use crate::rules as R;

/// Le caractère d'un camp : `factions[c].caractere` (SPEC-POLITIQUE, module 6) s'il existe, sinon tiré de sa
/// personnalité (agressif, prudent ou opportuniste).
pub fn caractere(g: &Game, code: &str) -> String {
    let c = g.factions.at(code).get("caractere");
    if c.is_str() {
        return c.string();
    }
    if c.is_dict() && c.get("id").is_str() {
        return c.at("id").string();
    }
    let aggr = R::FACTIONS().at(code).at("personality").get_or("aggr", 0.5).f();
    if aggr >= 0.65 { "agressif" } else if aggr <= 0.35 { "prudent" } else { "opportuniste" }.to_string()
}

/// Le mois de l'IA : impôt par classe, ministres.
pub fn mois(g: &mut Game, code: &str, d: Date) {
    let p = g.factions.at(code).at("politique");
    let cl = p.at("classes");
    let (mn, mp) = (cl.at("noblesse").atf("mecontentement"), cl.at("peuple").atf("mecontentement"));
    let (n, pe) = (cl.at("noblesse").atf("impot"), cl.at("peuple").atf("impot"));
    // la classe la plus fâchée paie un peu moins, l'autre un peu plus (la moyenne ne bouge pas)
    let danger = R::SEUIL_EMEUTE - 5.0;
    let d_ = if (mp > danger && mp > mn) || mp - mn > 15.0 {
        0.05_f64.min(1.0 - n).min(pe)
    } else if (mn > danger && mn > mp) || mn - mp > 15.0 {
        -(0.05_f64.min(n).min(1.0 - pe))
    } else {
        0.0
    };
    if d_.abs() > 0.001 {
        PO::regler_impot(g, code, "noblesse", n + d_);
        PO::regler_impot(g, code, "peuple", pe - d_);
    }
    // ministres : les postes vacants, et en janvier un incapable remplacé par un candidat brillant
    for poste in R::POSTES().keys() {
        let m = p.at("cabinet").get(&poste);
        let cands = p.at("candidats");
        let best = crate::py::max_by_key(
            cands.iter().filter(|c| !c.at("traits").has("corrompu")).collect::<Vec<Val>>(),
            |c| c.ati("competence"),
        );
        let Some(best) = best else { break };
        let vacant = !m.is_dict();
        let incapable = d.month == 1 && m.is_dict() && m.ati("competence") <= 1 && best.ati("competence") >= 4;
        if vacant || incapable {
            PO::nommer(g, code, poste.s(), best.at("id").s());
        }
    }
}

/// Les poids des choix devant une révolution (réprimer, abdiquer, céder), selon le caractère et la chance de réprimer.
pub fn poids_revolution(g: &Game, code: &str, chance: f64) -> [f64; 3] {
    let (rep, ced) = match caractere(g, code).as_str() {
        "agressif" | "expansionniste" => (3.0, 1.0),
        "prudent" | "marchand" => (0.7, 3.0),
        _ => (1.5, 1.5),
    };
    [rep * (0.5 + chance), 0.2, ced]
}
