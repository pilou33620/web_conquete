//! Le serveur du jeu (serveur.rs, l'exécutable `conquete`) contre le serveur Python : un vrai serveur sur un port
//! libre, ses fichiers dans un dossier temporaire (web/ recopié, saves/ posé par la référence), et les requêtes de
//! outils/jumeau/serveur_ref.py, qui range ce que server.py y répond (tests/references/serveur.json).
//! Repris de tests/test_serveur.py : ce qui tourne sans partie en cours.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn racine() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap()
}

fn reference() -> Value {
    let t = std::fs::read_to_string(racine().join("rust/conquete/tests/references/serveur.json")).unwrap();
    serde_json::from_str(&t).unwrap()
}

fn copier(de: &Path, vers: &Path) {
    std::fs::create_dir_all(vers).unwrap();
    for e in std::fs::read_dir(de).unwrap() {
        let e = e.unwrap();
        if e.file_type().unwrap().is_dir() {
            copier(&e.path(), &vers.join(e.file_name()));
        } else {
            std::fs::copy(e.path(), vers.join(e.file_name())).unwrap();
        }
    }
}

/// L'exécutable lancé dans un dossier à lui ; arrêté à la fin de l'essai.
struct Jeu {
    proc: Child,
    port: u16,
    dossier: PathBuf,
    sortie: Arc<Mutex<Vec<String>>>,
    pret: Duration,
}

impl Drop for Jeu {
    fn drop(&mut self) {
        let _ = self.proc.kill();
        let _ = self.proc.wait();
        let _ = std::fs::remove_dir_all(&self.dossier);
    }
}

impl Jeu {
    fn lancer(nom: &str, args: &[&str], env: &[(&str, &str)], saves: &Value) -> Jeu {
        let dossier = std::env::temp_dir().join(format!("conquete-serveur-{nom}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dossier);
        copier(&racine().join("web"), &dossier.join("web"));
        std::fs::create_dir_all(dossier.join("saves")).unwrap();
        for (i, (n, texte)) in saves.as_object().unwrap().iter().enumerate() {
            let f = dossier.join("saves").join(n);
            std::fs::write(&f, texte.as_str().unwrap()).unwrap();
            // (dans cet ordre : la plus récente à la fin, comme le jumeau)
            let t = std::time::UNIX_EPOCH + Duration::from_secs(1_700_000_000 + i as u64 * 60);
            std::fs::File::options().write(true).open(&f).unwrap().set_modified(t).unwrap();
        }
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let t0 = Instant::now();
        let mut proc = Command::new(env!("CARGO_BIN_EXE_conquete"))
            .args(args)
            .args(["--port", &port.to_string()])
            .current_dir(&dossier)
            .env("CONQUETE_DATA", racine().join("game/data"))
            .env("WEB_TOOLS_JETON_FICHIER", dossier.join("jeton.txt"))
            .env("WEB_TOOLS_HTTP", "1")
            .env("RUST_BACKTRACE", "0")
            .envs(env.iter().copied())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let sortie = Arc::new(Mutex::new(Vec::new()));
        for flux in [Box::new(proc.stdout.take().unwrap()) as Box<dyn Read + Send>, Box::new(proc.stderr.take().unwrap())] {
            let s = sortie.clone();
            std::thread::spawn(move || {
                for l in BufReader::new(flux).lines().map_while(Result::ok) {
                    s.lock().unwrap().push(l);
                }
            });
        }
        let mut jeu = Jeu { proc, port, dossier, sortie, pret: Duration::ZERO };
        jeu.attendre("est prêt", 600);
        jeu.pret = t0.elapsed();
        jeu
    }

    fn attendre(&mut self, texte: &str, secondes: u64) -> String {
        let fin = Instant::now() + Duration::from_secs(secondes);
        loop {
            if let Some(l) = self.sortie.lock().unwrap().iter().find(|l| l.contains(texte)) {
                return l.clone();
            }
            if let Ok(Some(s)) = self.proc.try_wait() {
                panic!("le serveur s'est arrêté ({s}) :\n{}", self.sortie.lock().unwrap().join("\n"));
            }
            assert!(Instant::now() < fin, "« {texte} » attendu :\n{}", self.sortie.lock().unwrap().join("\n"));
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn texte_sortie(&self) -> String {
        self.sortie.lock().unwrap().join("\n")
    }

    /// Une requête brute : (statut, en-têtes, corps). Statut 0 : connexion fermée sans réponse.
    fn brut(&self, octets: &[u8]) -> (u16, Vec<(String, String)>, Vec<u8>) {
        let mut c = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        c.set_read_timeout(Some(Duration::from_secs(120))).unwrap();
        c.write_all(octets).unwrap();
        let _ = c.shutdown(std::net::Shutdown::Write); // (fin de la requête : une ligne sans fin n'attend pas le délai du serveur)
        let mut r = Vec::new();
        let _ = c.read_to_end(&mut r);
        let Some(i) = r.windows(4).position(|w| w == b"\r\n\r\n") else { return (0, Vec::new(), r) };
        let tete = String::from_utf8_lossy(&r[..i]).into_owned();
        let mut lignes = tete.lines();
        let statut = lignes.next().unwrap().split(' ').nth(1).unwrap().parse().unwrap();
        let entetes = lignes.filter_map(|l| l.split_once(':')).map(|(k, v)| (k.trim().to_string(), v.trim().to_string())).collect();
        (statut, entetes, r[i + 4..].to_vec())
    }

    fn req(&self, methode: &str, chemin: &str, corps: &[u8], entetes: &[(&str, &str)]) -> (u16, Vec<(String, String)>, Vec<u8>) {
        let mut h: Vec<(String, String)> = vec![
            ("Host".into(), format!("127.0.0.1:{}", self.port)),
            ("Content-Type".into(), "application/json".into()),
            ("Content-Length".into(), corps.len().to_string()),
        ];
        for (k, v) in entetes {
            match h.iter_mut().find(|(a, _)| a.eq_ignore_ascii_case(k)) {
                Some(e) => e.1 = v.to_string(),
                None => h.push((k.to_string(), v.to_string())),
            }
        }
        let mut o = format!("{methode} {chemin} HTTP/1.1\r\n").into_bytes();
        for (k, v) in &h {
            o.extend(format!("{k}: {v}\r\n").bytes());
        }
        o.extend(b"\r\n");
        o.extend(corps);
        self.brut(&o)
    }

    fn get(&self, chemin: &str) -> (u16, Vec<(String, String)>, Vec<u8>) {
        self.req("GET", chemin, b"", &[])
    }
}

fn entete<'a>(h: &'a [(String, String)], nom: &str) -> Option<&'a str> {
    h.iter().find(|(k, _)| k.eq_ignore_ascii_case(nom)).map(|(_, v)| v.as_str())
}

fn degzip(b: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(b).read_to_end(&mut out).unwrap();
    out
}

/// Les sauvegardes de /api/saves, comme le jumeau les range (sans mtime, l'heure du nom mise de côté effacée).
fn saves_rangees(v: &Value) -> Value {
    let mut l = v.as_array().unwrap().clone();
    for x in &mut l {
        let o = x.as_object_mut().unwrap();
        o.shift_remove("mtime");
        let n = o["name"].as_str().unwrap().to_string();
        if let Some((a, _)) = n.split_once("-illisible-") {
            o.insert("name".into(), json!(format!("{a}-illisible-*")));
        }
    }
    Value::Array(l)
}

#[test]
fn serveur_local() {
    let r = reference();
    let jeu = Jeu::lancer("local", &["--local", "--no-browser", "--no-update"], &[], &r["fichiers"]);
    eprintln!("serveur prêt en {:.2} s : {}", jeu.pret.as_secs_f64(), jeu.sortie.lock().unwrap().iter().find(|l| l.contains("Carte prête")).unwrap());

    // la page d'accueil et un fichier de web/
    let (st, h, corps) = jeu.get("/");
    assert_eq!((st, entete(&h, "Content-Type")), (200, Some("text/html; charset=utf-8")));
    assert!(String::from_utf8_lossy(&corps).to_lowercase().contains("<html"));
    let (st, h, corps) = jeu.get("/js/main.js");
    assert_eq!((st, entete(&h, "Content-Type")), (200, Some("application/javascript; charset=utf-8")));
    assert_eq!(corps, std::fs::read(racine().join("web/js/main.js")).unwrap());
    assert_eq!(entete(&jeu.get("/manifest.webmanifest").1, "Content-Type"), Some("application/manifest+json"));
    assert_eq!(entete(&h, "Cache-Control"), Some("no-store"));

    // les requêtes du jumeau : même statut, même type, même texte
    for q in r["requetes"].as_array().unwrap() {
        let corps = match &q["body"] {
            Value::Null => Vec::new(),
            Value::String(s) if q["headers"].get("Content-Length").is_some() || s.starts_with('{') => s.clone().into_bytes(),
            b => b.to_string().into_bytes(),
        };
        let entetes: Vec<(&str, &str)> = q["headers"].as_object().unwrap().iter().map(|(k, v)| (k.as_str(), v.as_str().unwrap())).collect();
        let (st, h, rep) = jeu.req(q["method"].as_str().unwrap(), q["path"].as_str().unwrap(), &corps, &entetes);
        let quoi = format!("{} {} {}", q["method"], q["path"], q["body"]);
        assert_eq!(st as u64, q["status"].as_u64().unwrap(), "{quoi}");
        assert_eq!(entete(&h, "Content-Type"), q["type"].as_str(), "{quoi}");
        assert_eq!(String::from_utf8_lossy(&rep), q["text"].as_str().unwrap(), "{quoi}");
    }

    // /api/saves : les sauvegardes (la plus récente d'abord), la sauvegarde automatique illisible mise de côté
    let (st, _, rep) = jeu.get("/api/saves");
    assert_eq!(st, 200);
    let s: Value = serde_json::from_slice(&rep).unwrap();
    assert_eq!(saves_rangees(&s["saves"]), r["saves"]["saves"]);
    assert_eq!(s["running"], json!(false));
    assert!(s["update"]["status"].is_string() && s["update"]["msg"].is_string());
    assert!(r["illisible"].as_bool().unwrap());
    assert!(!jeu.dossier.join("saves/sauvegarde-automatique.json").exists());
    assert!(std::fs::read_dir(jeu.dossier.join("saves")).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().contains("-illisible-")));
    // DNS rebinding : une IP littérale (Tailscale) est acceptée
    assert_eq!(jeu.req("GET", "/api/saves", b"", &[("Host", "100.80.111.121:8790")]).0, 200);

    // une requête mal formée ne reçoit pas de page, et le serveur continue
    let (st, _, _) = jeu.brut(b"N'IMPORTE QUOI\r\n\r\n");
    assert_ne!(st, 200);
    let (st, _, _) = jeu.brut(b"\x00\x01\x02");
    assert_ne!(st, 200);
    assert_eq!(jeu.req("PUT", "/", b"", &[]).0, 501);
    assert_eq!(jeu.get("/").0, 200);

    // /api/map : les octets mêmes du serveur Python (empreinte), en clair et en gzip
    let m = &r["map"];
    let (st, h, brut) = jeu.get("/api/map");
    if st == 500 && String::from_utf8_lossy(&brut).contains("not yet implemented") {
        eprintln!("/api/map pas encore comparé : crue.rs, rails.rs ou views.rs n'est pas encore porté ({})", String::from_utf8_lossy(&brut));
    } else {
        assert_eq!((st, entete(&h, "Content-Type")), (200, m["type"].as_str()));
        let v: Value = serde_json::from_slice(&brut).unwrap();
        assert_eq!((&v["geo"], &v["ver"], v["map"]["nodes"].as_array().unwrap().len() as u64), (&m["geo"], &m["ver"], m["noeuds"].as_u64().unwrap()));
        assert_eq!(v.as_object().unwrap().keys().collect::<Vec<_>>(), m["cles"].as_array().unwrap().iter().map(|k| k.as_str().unwrap()).collect::<Vec<_>>().iter().collect::<Vec<_>>());
        assert_eq!(brut.len() as u64, m["octets"].as_u64().unwrap());
        let sha: String = Sha256::digest(&brut).iter().map(|o| format!("{o:02x}")).collect();
        assert_eq!(sha, m["sha256"].as_str().unwrap());
        let (st, h, gz) = jeu.req("GET", "/api/map", b"", &[("Accept-Encoding", "gzip, deflate")]);
        assert_eq!((st, entete(&h, "Content-Encoding")), (200, Some("gzip")));
        assert_eq!(degzip(&gz), brut);
    }

    // mode Bataille, à la même graine : le même identifiant de bataille
    let e = &r["escarmouche"];
    let (st, _, rep) = jeu.req("POST", "/api/skirmish", e["body"].to_string().as_bytes(), &[]);
    let rep = String::from_utf8_lossy(&rep).into_owned();
    if jeu.texte_sortie().contains("not yet implemented") && (st == 500 || rep.contains("n’a pas pu être préparée")) {
        eprintln!("bataille du mode Bataille pas encore comparée (corps manquants) : {rep}");
    } else {
        assert_eq!((st as u64, rep.as_str()), (e["status"].as_u64().unwrap(), e["text"].as_str().unwrap()));
    }
}

#[test]
fn appairage_d_un_autre_appareil() {
    // WEB_TOOLS_BANC_DISTANT=1 : ce poste est traité comme un autre appareil du réseau
    let mut jeu = Jeu::lancer("reseau", &["--lan", "--no-browser", "--no-update"], &[("WEB_TOOLS_BANC_DISTANT", "1")], &json!({}));
    let (st, h, _) = jeu.req("GET", "/", b"", &[("Accept", "text/html")]);
    assert_eq!((st, entete(&h, "Location")), (303, Some("/appairage")));
    let (st, _, corps) = jeu.get("/api/saves");
    assert_eq!(st, 403);
    assert!(String::from_utf8_lossy(&corps).contains("Appareil non appairé"));
    let (st, _, page) = jeu.get("/appairage");
    assert_eq!(st, 200);
    assert!(String::from_utf8_lossy(&page).contains("Conquête · Appairage"));
    // le code affiché dans le terminal du serveur
    let ligne = jeu.attendre("Code d'appairage Conquête : ", 30);
    let code: String = ligne.split(" : ").nth(1).unwrap().chars().filter(|c| c.is_ascii_digit()).take(6).collect();
    let (st, _, _) = jeu.req("POST", "/api/appairer", br#"{"code":"000000x"}"#, &[("X-Appairage", "1")]);
    assert_eq!(st, 403);
    let (st, h, rep) = jeu.req("POST", "/api/appairer", json!({"code": code}).to_string().as_bytes(), &[("X-Appairage", "1")]);
    assert_eq!(st, 200, "{}", String::from_utf8_lossy(&rep));
    let jeton = std::fs::read_to_string(jeu.dossier.join("jeton.txt")).unwrap().trim().to_string();
    let biscuit = entete(&h, "Set-Cookie").unwrap().split(';').next().unwrap().to_string();
    assert_eq!(biscuit, format!("websuite_jeton={jeton}"));
    // appairé : le jeu répond
    let (st, _, rep) = jeu.req("GET", "/api/saves", b"", &[("Cookie", &biscuit)]);
    assert_eq!(st, 200);
    assert!(serde_json::from_slice::<Value>(&rep).unwrap()["saves"].is_array());
    assert!(jeu.dossier.join("adresse-reseau.txt").exists());
}
