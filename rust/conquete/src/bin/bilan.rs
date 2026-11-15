//! Bilan du journal des batailles (logs/batailles.jsonl, écrit par battle_log) : de quoi régler l'équilibre.
//! Portage de outils/bilan.py (mêmes options, mêmes tableaux).

mod commun;

use commun::Args;
use conquete::py::{self, json, Val};

const AIDE: &str = "Bilan du journal des batailles (logs/batailles.jsonl, écrit par le journal des batailles) : de quoi régler l'équilibre.

Usage :  target/release/bilan                 (tout le journal)
         target/release/bilan --depuis 2026-10-12   (seulement les batailles livrées depuis ce jour)
         target/release/bilan autre_journal.jsonl

Tableaux : assauts de places selon la fortification, brèches ouvertes au canon, batailles automatiques et commandées,
mode Bataille. Ne lit que le journal : aucune partie n'est lancée.";

/// Le journal du jeu, relatif au répertoire courant (la racine du dépôt), comme battle_log::LOG_FILE.
const DEFAULT: &str = "logs/batailles.jsonl";

fn load(path: &str, since: Option<&str>) -> Vec<Val> {
    let mut out = vec![];
    let mut paths = vec![path.to_string()];
    let old = path.replace(".jsonl", ".1.jsonl");
    if path == DEFAULT && std::path::Path::new(&old).exists() {
        paths.insert(0, old);
    }
    for p in paths {
        let Ok(texte) = std::fs::read_to_string(&p) else { continue };
        for line in texte.lines() {
            let Ok(r) = json::loads(line) else { continue };
            if since.is_some_and(|s| r.get_or("ts", "").s() < s) {
                continue;
            }
            out.push(r);
        }
    }
    out
}

fn mean(xs: impl IntoIterator<Item = Val>) -> Option<f64> {
    let xs: Vec<Val> = xs.into_iter().filter(|x| !x.is_none()).collect();
    if xs.is_empty() {
        return None;
    }
    let n = xs.len() as f64;
    Some(py::sum_v(xs).f() / n)
}

fn mean100(xs: impl IntoIterator<Item = Val>) -> Option<f64> {
    mean(xs).map(|m| 100.0 * m)
}

fn pct(k: usize, n: usize) -> String {
    if n == 0 {
        return "—".to_string();
    }
    format!("{:.0} %", (100 * k) as f64 / n as f64)
}

fn num(x: Option<f64>, d: usize) -> String {
    x.map_or("—".to_string(), |x| format!("{x:.d$}").replace('.', ","))
}

fn table(title: &str, head: &[&str], rows: &[Vec<String>]) {
    println!("\n== {title}");
    if rows.is_empty() {
        println!("   (aucune bataille)");
        return;
    }
    let len = |s: &str| s.chars().count();
    let w: Vec<usize> = head.iter().enumerate().map(|(i, h)| rows.iter().map(|r| len(&r[i])).fold(len(h), usize::max)).collect();
    let ligne = |cells: Vec<&str>| {
        let c: Vec<String> = cells.iter().enumerate().map(|(i, s)| format!("{s:<0$}", w[i])).collect();
        println!("   {}", c.join("  "));
    };
    ligne(head.to_vec());
    for r in rows {
        ligne(r.iter().map(String::as_str).collect());
    }
}

/// Pertes du camp i rapportées à son effectif de départ.
fn ratio(r: &Val, lost: &str, i: i64) -> Val {
    if r.get("men0").truthy() && r.at("men0").at(i).truthy() {
        &r.at(lost).at(i) / &r.at("men0").at(i)
    } else {
        Val::None
    }
}

/// `a / max(1, b)`.
fn par_max1(a: &Val, b: &Val) -> Val {
    if *b > Val::from(1) {
        a / b
    } else {
        a / &Val::from(1)
    }
}

/// `sorted({…})` de nombres.
fn tries(mut v: Vec<Val>) -> Vec<Val> {
    let mut u: Vec<Val> = vec![];
    v.retain(|x| {
        let neuf = !u.contains(x);
        if neuf {
            u.push(x.clone());
        }
        neuf
    });
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v
}

fn compte(rs: &[&Val], f: impl Fn(&Val) -> bool) -> usize {
    rs.iter().filter(|r| f(r)).count()
}

fn main() {
    let a = Args::parse(AIDE, &["depuis"]);
    if a.pos.len() > 1 {
        commun::erreur(&format!("unrecognized arguments: {}", a.pos[1..].join(" ")));
    }
    let journal = a.pos.first().cloned().unwrap_or_else(|| DEFAULT.to_string());
    let recs = load(&journal, a.opt("depuis").as_deref());
    if recs.is_empty() {
        println!("Journal vide ou absent : {journal}. Jouez quelques batailles, puis relancez.");
        std::process::exit(1);
    }
    let camp: Vec<&Val> = recs.iter().filter(|r| r.get("kind") == "campagne").collect();
    let sk: Vec<&Val> = recs.iter().filter(|r| r.get("kind") == "bataille").collect();
    println!(
        "{} batailles : {} de campagne ({} automatiques, {} commandées), {} du mode Bataille.",
        recs.len(),
        camp.len(),
        compte(&camp, |r| r.get("mode") == "auto"),
        compte(&camp, |r| r.get("mode") == "commandee"),
        sk.len()
    );

    // ---------------------------------------------------------------- assauts de places, selon la fortification
    let fort_de = |r: &Val| r.at("sides").at(1).get("fort").or(0);
    let assaut = |r: &Val| r.get("assault").truthy() && r.get("sides").truthy();
    let mut rows = vec![];
    for fort in tries(camp.iter().filter(|r| assaut(r)).map(|r| fort_de(r)).collect()) {
        for mode in ["auto", "commandee"] {
            let rs: Vec<&Val> = camp.iter().copied().filter(|r| assaut(r) && fort_de(r) == fort && r.get("mode") == mode).collect();
            if rs.is_empty() {
                continue;
            }
            rows.push(vec![
                fort.to_string(),
                mode.to_string(),
                rs.len().to_string(),
                num(mean(rs.iter().map(|r| r.at("sides").at(1).get("guns"))), 1),
                pct(compte(&rs, |r| r.get("captured").truthy()), rs.len()),
                num(mean(rs.iter().map(|r| par_max1(&r.at("men0").at(0), &r.at("men0").at(1)))), 2),
                num(mean100(rs.iter().map(|r| ratio(r, "lost", 0))), 0),
                num(mean100(rs.iter().map(|r| ratio(r, "lost", 1))), 0),
                num(mean(rs.iter().map(|r| r.get("days"))), 2),
            ]);
        }
    }
    table(
        "Assauts de places (campagne), selon le niveau de fortification",
        &["fort", "mode", "n", "canons", "prise", "rapport forces", "pertes att. %", "pertes déf. %", "jours"],
        &rows,
    );

    // ---------------------------------------------------------------- brèches au canon (batailles tactiques)
    let tac: Vec<Val> = recs.iter().filter(|r| r.get("tac").truthy() && r.at("tac").get("place").truthy()).map(|r| r.at("tac")).collect();
    let mut rows = vec![];
    for fort in tries(tac.iter().map(|t| t.at("place").at("fort")).collect()) {
        let ts: Vec<&Val> = tac.iter().filter(|t| t.at("place").at("fort") == fort).collect();
        let br: Vec<&Val> = ts.iter().copied().filter(|t| t.get("breaches").truthy()).collect();
        let nobr: Vec<&Val> = ts.iter().copied().filter(|t| !t.get("breaches").truthy()).collect();
        let won = |lst: &[&Val]| compte(lst, |t| t.get("winner") == 0 && !t.get("disengage").truthy());
        rows.push(vec![
            fort.to_string(),
            ts.len().to_string(),
            num(mean(ts.iter().map(|t| t.get("guns"))), 1),
            pct(br.len(), ts.len()),
            num(mean(br.iter().map(|t| &t.at("breaches").at(0).at(0) / 60)), 0),
            num(mean(br.iter().map(|t| Val::from(t.at("breaches").len() as i64))), 1),
            format!("{} / {}", pct(won(&br), br.len()), pct(won(&nobr), nobr.len())),
            num(mean(ts.iter().map(|t| &t.at("clock") / 60)), 0),
        ]);
    }
    table(
        "Brèches au canon (assauts joués sur le champ de bataille)",
        &["fort", "n", "canons rempart", "avec brèche", "1re brèche (min)", "brèches", "prise avec / sans brèche", "durée (min)"],
        &rows,
    );

    // ---------------------------------------------------------------- automatique contre commandée
    let mut rows = vec![];
    for (kind, test) in [("rase campagne", false), ("assaut", true)] {
        for mode in ["auto", "commandee"] {
            let rs: Vec<&Val> =
                camp.iter().copied().filter(|r| r.get("assault").truthy() == test && r.get("mode") == mode && r.get("men0").truthy()).collect();
            if rs.is_empty() {
                continue;
            }
            rows.push(vec![
                kind.to_string(),
                mode.to_string(),
                rs.len().to_string(),
                pct(compte(&rs, |r| r.get("winner") == 0), rs.len()),
                pct(compte(&rs, |r| r.get("disengage").truthy()), rs.len()),
                num(mean(rs.iter().map(|r| par_max1(&r.at("lost").at(0), &r.at("lost").at(1)))), 2),
                num(mean(rs.iter().map(|r| r.get("prisoners"))), 0),
            ]);
        }
    }
    table(
        "Batailles automatiques et commandées (campagne)",
        &["bataille", "mode", "n", "l’assaillant gagne", "décrochage", "pertes att./déf.", "prisonniers"],
        &rows,
    );

    // ---------------------------------------------------------------- mode Bataille
    let mut rows = vec![];
    for kind in ["bataille", "forteresse"] {
        for role in ["att", "def"] {
            let rs: Vec<&Val> = sk.iter().copied().filter(|r| r.get("sk").or(Val::dict()).get("kind") == kind && r.at("sk").get("role") == role).collect();
            if rs.is_empty() {
                continue;
            }
            let me = |r: &Val| r.at("tac").get("me").or(0);
            let win = compte(&rs, |r| r.at("tac").get("winner") == me(r));
            rows.push(vec![
                kind.to_string(),
                (if role == "att" { "attaque" } else { "défense" }).to_string(),
                rs.len().to_string(),
                pct(win, rs.len()),
                num(mean(rs.iter().map(|r| r.at("tac").at("lost").at(&me(r)))), 0),
                num(mean(rs.iter().map(|r| r.at("tac").at("lost").at(&(1 - &me(r))))), 0),
                pct(compte(&rs, |r| r.at("tac").get("accel").truthy()), rs.len()),
                num(mean(rs.iter().map(|r| &r.at("tac").at("clock") / 60)), 0),
            ]);
        }
    }
    table("Mode Bataille (vue du joueur)", &["type", "rôle", "n", "victoires", "vos pertes", "pertes ennemies", "finies auto.", "durée (min)"], &rows);
}
