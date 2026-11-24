//! Les outils (src/bin : bilan, simuler, carte_hex ; equilibre en fin de fichier) contre leurs originaux Python (outils/*.py) :
//! chaque exécutable est lancé sur un cas court et sa sortie comparée à celle que l'outil Python a écrite sur le même cas
//! (tests/references/outils/ ; pour l'export, trop gros, son SHA-256).
//!
//! Les sorties Python ont été écrites ainsi, de la racine du dépôt :
//! - bilan.txt : `python3 outils/bilan.py bilan_journal.jsonl` ; le journal vient de quatre escarmouches et de deux
//!   campagnes 'ordres' (1813, 10 mois ; 1700, 8 mois) de outils/jumeau/campagnes_ref.py, journal des batailles ouvert ;
//! - simuler.txt : `python3 outils/simuler.py --parties 2 --epoque 1700 --annees 1 --graine 3 --proc 2` ;
//! - carte_hex : `python3 outils/carte_hex.py | sha256sum`.

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

#[test]
fn simuler() {
    let rs = lancer(env!("CARGO_BIN_EXE_simuler"), &["--parties", "2", "--epoque", "1700", "--annees", "1", "--graine", "3", "--proc", "2"]);
    assert_eq!(rs, reference("simuler.txt"));
}

fn sha256(texte: &str) -> String {
    Sha256::digest(texte.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// La carte par défaut (l'Aquitaine depuis le 22/11/2026) sur sa grille d'hexagones : exactement le fichier de la page
/// web/js/dev/carte-hex-data.js (que `carte_hex > web/js/dev/carte-hex-data.js` écrit).
#[test]
fn carte_hex() {
    let page = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/js/dev/carte-hex-data.js");
    let attendu = std::fs::read_to_string(page).unwrap();
    assert_eq!(sha256(&lancer(env!("CARGO_BIN_EXE_carte_hex"), &[])), sha256(&attendu));
}

/// L'outil d'équilibre (SPEC-POLITIQUE.md, module 8 ; pas d'original Python) : une partie d'un an en Aquitaine dans son
/// processus, puis la série entière réduite à cette partie : le rapport HTML et le résumé JSON sont écrits, avec les clés
/// que lit l'assistant.
#[test]
fn equilibre() {
    let exe = env!("CARGO_BIN_EXE_equilibre");
    let j: serde_json::Value = serde_json::from_str(lancer(exe, &["--partie", "2:1700:3:1:hasard"]).trim()).unwrap();
    assert!(j["erreur"].is_null(), "{}", j["erreur"]);
    assert_eq!(j["x"], serde_json::json!([1700, 1701])); // le départ et la fin de l'année
    let camp = j["camps"].as_object().unwrap().values().next().unwrap();
    for k in ["places", "vivant", "revenus", "armee", "techs"] {
        assert!(camp.get(k).is_some(), "série {k} absente");
    }
    for k in ["unites", "batiments", "detresse"] {
        assert!(j["compteurs"].get(k).is_some(), "compteur {k} absent");
    }

    let sortie = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("equilibre");
    let _ = std::fs::remove_dir_all(&sortie);
    let args = ["--reglages", "aucun.toml", "--cartes", "2", "--parties", "1", "--annees", "1", "--coeurs", "1", "--sortie", sortie.to_str().unwrap()];
    lancer(exe, &args);
    let fichiers: Vec<std::path::PathBuf> = std::fs::read_dir(&sortie).unwrap().map(|e| e.unwrap().path()).collect();
    let lire = |debut: &str| std::fs::read_to_string(fichiers.iter().find(|f| f.file_name().unwrap().to_string_lossy().starts_with(debut)).unwrap()).unwrap();
    let page = lire("rapport-");
    assert!(page.contains("<script id=\"donnees\"") && !page.contains("__DONNEES__"));
    let resume: serde_json::Value = serde_json::from_str(&lire("resume-")).unwrap();
    for k in ["reglages", "colonnes_camps", "cartes", "alertes", "plantages"] {
        assert!(resume.get(k).is_some(), "clé {k} absente du résumé");
    }
    let carte = &resume["cartes"][0];
    assert_eq!(carte["parties"], 1);
    assert_eq!(carte["camps"].as_array().unwrap().len(), 5); // les cinq départements de l'Aquitaine
    assert!(carte["compteurs"]["strategies"].is_object() && carte["temps"]["moyen_ms"].is_number());
}
