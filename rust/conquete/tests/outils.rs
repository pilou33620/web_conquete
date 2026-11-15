//! Les outils (src/bin : bilan, banc_ia, simuler, carte_hex, bataille_hex) contre leurs originaux Python (outils/*.py) :
//! chaque exécutable est lancé sur un cas court et sa sortie comparée à celle que l'outil Python a écrite sur le même cas
//! (tests/references/outils/ ; pour les deux exports, trop gros, leur SHA-256).
//!
//! Les sorties Python ont été écrites ainsi, de la racine du dépôt :
//! - bilan.txt : `python3 outils/bilan.py bilan_journal.jsonl` ; le journal vient de quatre escarmouches et de deux
//!   campagnes 'ordres' (1813, 10 mois ; 1700, 8 mois) de outils/jumeau/campagnes_ref.py, journal des batailles ouvert ;
//! - banc_ia.txt : `python3 outils/banc_ia.py --graines 1 --epoques 1790 --lieux bataille --proc 2` (la colonne cpu,
//!   le temps de calcul, n'est pas comparée) ;
//! - simuler.txt : `python3 outils/simuler.py --parties 2 --epoque 1700 --annees 1 --graine 3 --proc 2` ;
//! - carte_hex, bataille_hex : `python3 outils/carte_hex.py | sha256sum` (de même bataille_hex.py).

use sha2::{Digest, Sha256};
use std::process::Command;
use std::sync::Mutex;

/// Lance un outil (la carte relue du cache des essais) ; rend sa sortie. Un seul à la fois : deux outils n'écrivent pas
/// le cache de la carte ensemble.
fn lancer(exe: &str, args: &[&str]) -> String {
    static VERROU: Mutex<()> = Mutex::new(());
    let _verrou = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("geo");
    std::fs::create_dir_all(&d).unwrap();
    let out = Command::new(exe).args(args).env("CONQUETE_DATA", &d).output().unwrap();
    assert!(out.status.success(), "{exe} : {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8(out.stdout).unwrap()
}

fn reference(nom: &str) -> String {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/references/outils").join(nom);
    std::fs::read_to_string(p).unwrap()
}

#[test]
fn bilan() {
    let journal = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/references/outils/bilan_journal.jsonl");
    assert_eq!(lancer(env!("CARGO_BIN_EXE_bilan"), &[journal.to_str().unwrap()]), reference("bilan.txt"));
}

/// Le temps de calcul (colonne cpu des lignes de bataille, fin de la ligne de bilan) n'est pas comparé.
fn sans_cpu(texte: &str) -> String {
    let mut out = vec![];
    for l in texte.lines() {
        let c: Vec<char> = l.chars().collect();
        if let Some(k) = l.find(" ; cpu moy.") {
            out.push(l[..k].to_string());
        } else if c.len() >= 81 && !l.starts_with("époque") && !l.contains("ERREUR") && c[..2] != [' ', ' '] {
            out.push(c[..76].iter().chain(&c[81..]).collect());
        } else {
            out.push(l.to_string());
        }
    }
    out.join("\n")
}

#[test]
fn banc_ia() {
    let rs = lancer(env!("CARGO_BIN_EXE_banc_ia"), &["--graines", "1", "--epoques", "1790", "--lieux", "bataille", "--proc", "2"]);
    assert_eq!(sans_cpu(&rs), sans_cpu(&reference("banc_ia.txt")));
}

#[test]
fn simuler() {
    let rs = lancer(env!("CARGO_BIN_EXE_simuler"), &["--parties", "2", "--epoque", "1700", "--annees", "1", "--graine", "3", "--proc", "2"]);
    assert_eq!(rs, reference("simuler.txt"));
}

fn sha256(texte: &str) -> String {
    Sha256::digest(texte.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn carte_hex() {
    assert_eq!(sha256(&lancer(env!("CARGO_BIN_EXE_carte_hex"), &[])), "21ea0b2941f34d1ace8368e92f30704e99dc541ff0cda74137bc38bcbec44444");
}

#[test]
fn bataille_hex() {
    assert_eq!(sha256(&lancer(env!("CARGO_BIN_EXE_bataille_hex"), &[])), "18f7e549356d45082038f6760d6e43a166e55fb180f76cd64567fe9a6343da33");
}
