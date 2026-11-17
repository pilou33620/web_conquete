//! Banc d'essai du serveur : portage de tests/test_serveur.py. Un vrai serveur HTTP (l'exécutable `conquete`, lancé
//! sur un port libre dans un dossier temporaire, comme tests/serveur.rs), des requêtes comme celles du navigateur ou
//! d'un appareil du réseau local, et des sauvegardes dans un dossier temporaire (les vraies ne sont pas touchées).
//!
//! POURQUOI CE BANC EXISTE. Le serveur est ouvert au réseau local (iPad, Raspberry Pi) : une requête mal formée ne
//! doit ni couper la connexion sans réponse, ni arrêter la partie, ni sortir du dossier web/, et une sauvegarde ne doit
//! jamais être perdue. Bugs déjà rattrapés, à ne pas revoir :
//! - une commande d'escarmouche mal formée coupait la connexion (« Serveur injoignable ») ;
//! - /api/quit arrêtait la partie sans sauvegarder, depuis n'importe quel appareil du réseau ;
//! - une sauvegarde automatique illisible au démarrage était écrasée au mois suivant ;
//! - une sauvegarde manuelle nommée « sauvegarde-automatique » était écrasée au mois suivant.
//!
//! Le Python lit la partie du serveur (`server.APP.game`) ; ici, le serveur est un autre processus : ce qu'il faut
//! savoir de la partie (numéros d'armées, de places) se lit sur /api/map et /api/state, ou sur la même partie refaite
//! à côté (même département, même graine). Ce que tests/serveur.rs vérifie déjà n'est pas refait :
//! - Http.test_page_d_accueil, Http.test_hors_du_dossier_web_refuse : serveur.rs, `serveur_local` (« / » ; les
//!   requêtes du jumeau : /../server.py, /%2e%2e/server.py) ;
//! - Garde.test_nom_inconnu_et_autre_appareil : serveur.rs, `serveur_local` (Host inconnu : 403 ; ce poste : 200) et
//!   `appairage_d_un_autre_appareil` (autre appareil : 303 vers /appairage, /api/saves : 403) ;
//! - Sauvegardes.test_sauvegarde_illisible_mise_de_cote : serveur.rs, `serveur_local` (la sauvegarde automatique
//!   illisible mise de côté au démarrage).

mod fabrique_campagne;

use conquete::engine::Game;
use conquete::geo::GeoMap;
use conquete::py::{json, Val};
use conquete::rails as RL;
use conquete::serveur::{self as SV, App, Reseau, AUTOSAVE};
use conquete::views as V;
use conquete::{dict, list};
use fabrique_campagne::{armee, geo, partie, GEO};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::rc::Rc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

// ------------------------------------------------------------------ le serveur (repris de tests/serveur.rs)

fn racine() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap()
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
}

impl Drop for Jeu {
    fn drop(&mut self) {
        let _ = self.proc.kill();
        let _ = self.proc.wait();
        let _ = std::fs::remove_dir_all(&self.dossier);
    }
}

impl Jeu {
    fn lancer(nom: &str) -> Jeu {
        let dossier = std::env::temp_dir().join(format!("conquete-bancs-serveur-{nom}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dossier);
        copier(&racine().join("web"), &dossier.join("web"));
        std::fs::create_dir_all(dossier.join("saves")).unwrap();
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let mut proc = Command::new(env!("CARGO_BIN_EXE_conquete"))
            .args(["--local", "--no-browser", "--no-update", "--port", &port.to_string()])
            .current_dir(&dossier)
            .env("CONQUETE_DATA", racine().join("game/data"))
            .env("WEB_TOOLS_JETON_FICHIER", dossier.join("jeton.txt"))
            .env("WEB_TOOLS_HTTP", "1")
            .env("WEB_CONQUETE_NOLOG", "1")
            .env("RUST_BACKTRACE", "0")
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
        let mut jeu = Jeu { proc, port, dossier, sortie };
        jeu.attendre("est prêt", 600);
        jeu
    }

    fn attendre(&mut self, texte: &str, secondes: u64) {
        let fin = Instant::now() + Duration::from_secs(secondes);
        loop {
            if self.sortie.lock().unwrap().iter().any(|l| l.contains(texte)) {
                return;
            }
            if let Ok(Some(s)) = self.proc.try_wait() {
                panic!("le serveur s'est arrêté ({s}) :\n{}", self.sortie.lock().unwrap().join("\n"));
            }
            assert!(Instant::now() < fin, "« {texte} » attendu :\n{}", self.sortie.lock().unwrap().join("\n"));
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// Une requête brute : (statut, corps). Statut 0 : connexion fermée sans réponse.
    fn brut(&self, octets: &[u8]) -> (u16, Vec<u8>) {
        let mut c = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        c.set_read_timeout(Some(Duration::from_secs(120))).unwrap();
        c.write_all(octets).unwrap();
        let _ = c.shutdown(std::net::Shutdown::Write);
        let mut r = Vec::new();
        let _ = c.read_to_end(&mut r);
        let Some(i) = r.windows(4).position(|w| w == b"\r\n\r\n") else { return (0, r) };
        let tete = String::from_utf8_lossy(&r[..i]).into_owned();
        let statut = tete.lines().next().unwrap().split(' ').nth(1).unwrap().parse().unwrap();
        (statut, r[i + 4..].to_vec())
    }

    /// `req(method, path, body=None, headers=None)` : (statut, texte) ; le corps part en JSON
    /// (Content-Type: application/json, sauf en-tête contraire).
    fn req(&self, methode: &str, chemin: &str, corps: &[u8], entetes: &[(&str, &str)]) -> (u16, String) {
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
        let (st, b) = self.brut(&o);
        (st, String::from_utf8_lossy(&b).into_owned())
    }

    fn get(&self, chemin: &str) -> (u16, String) {
        self.req("GET", chemin, b"", &[])
    }

    fn post(&self, chemin: &str, corps: &Value) -> (u16, String) {
        self.req("POST", chemin, corps.to_string().as_bytes(), &[])
    }

    /// `cmd(body)` : la réponse de /api/cmd (statut 200 exigé).
    fn cmd(&self, corps: Value) -> Value {
        let (st, txt) = self.post("/api/cmd", &corps);
        assert_eq!(st, 200, "{txt}");
        serde_json::from_str(&txt).unwrap()
    }

    fn etat(&self) -> Value {
        serde_json::from_str(&self.get("/api/state?since=0").1).unwrap()
    }

    /// `nouvelle_partie()` : la Gironde, graine 1 ; rend la même partie refaite à côté (pour en lire les numéros).
    fn nouvelle_partie(&self) -> Game {
        let (st, txt) = self.post("/api/new", &json!({"dept": "33", "seed": 1}));
        assert_eq!(st, 200, "{txt}");
        Game::new(geo(conquete::geo::VERSION), "33", &Val::from("normal"), &Val::from(1), &Val::from("1790"))
    }
}

/// L'armée du joueur dans la vue (/api/state).
fn vue_armee(st: &Value, aid: &str) -> Value {
    st["armies"].as_array().unwrap().iter().find(|x| x["id"] == aid).cloned().unwrap()
}

// ================================================================== Http

#[test]
fn arrivee_estimee_sans_ordre() {
    let jeu = Jeu::lancer("eta");
    let g = jeu.nouvelle_partie();
    let a = armee(&g);
    let aid = a.ats("id");
    let r = jeu.cmd(json!({"cmd": "eta", "army": aid, "node": g.capital_of("24").i(), "mode": "route"}));
    assert_eq!(r["ok"], json!(true));
    assert!(r["tn"].is_i64(), "{r}");
    assert_eq!(vue_armee(&jeu.etat(), &aid)["path"], json!([]), "rien n'est ordonné");
    assert!(jeu.cmd(json!({"cmd": "eta", "army": "a999", "x": 1, "y": 1}))["tn"].is_null());
}

#[test]
fn chantier_de_voie_ferree() {
    let jeu = Jeu::lancer("rails");
    let g = jeu.nouvelle_partie();
    let cap = g.capital_of("33").i();
    let r = jeu.cmd(json!({"cmd": "rail_build", "node": cap, "section": "0-5"}));
    assert_eq!(r["ok"], json!(false), "sans la technologie");
    assert_eq!(jeu.cmd(json!({"cmd": "rail_build", "node": cap, "section": ["x"]}))["ok"], json!(false));
    let (_st, txt) = jeu.get("/api/map");
    assert!(txt.contains("\"rails\""));
    let v: Value = serde_json::from_str(&txt).unwrap();
    let secs = &v["map"]["rails"]["sections"];
    assert!(secs.as_array().map(Vec::len).or(secs.as_object().map(|o| o.len())).unwrap() > 50);
}

#[test]
fn autre_site_refuse() {
    let jeu = Jeu::lancer("csrf");
    jeu.nouvelle_partie();
    let avant = jeu.get("/api/state?since=0").1;
    // formulaire ou fetch « simple » d'un autre site (CSRF) : pas de JSON, refusé
    let (st, _) = jeu.req("POST", "/api/new", json!({"dept": "33"}).to_string().as_bytes(), &[("Content-Type", "text/plain")]);
    assert_eq!(st, 415);
    assert_eq!(jeu.get("/api/state?since=0").1, avant, "la partie en cours est intacte");
    // DNS rebinding : nom inconnu refusé, IP Tailscale acceptée
    assert_eq!(jeu.req("GET", "/api/saves", b"", &[("Host", "evil.example")]).0, 403);
    assert_eq!(jeu.req("GET", "/api/saves", b"", &[("Host", "100.80.111.121:8790")]).0, 200);
}

#[test]
fn routes_supprimees() {
    let jeu = Jeu::lancer("routes");
    jeu.nouvelle_partie();
    assert_eq!(jeu.post("/api/quit", &json!({})).0, 404);
    assert_eq!(jeu.get("/api/info").0, 404);
    let s: Value = serde_json::from_str(&jeu.get("/api/saves").1).unwrap();
    assert_eq!(s["running"], json!(true), "la partie tourne toujours");
}

#[test]
fn requetes_mal_formees_recoivent_une_reponse() {
    let jeu = Jeu::lancer("malformees");
    jeu.nouvelle_partie();
    for corps in [
        json!("x"),
        json!([]),
        json!({}),
        json!({"cmd": "move", "army": "a1", "x": "nan"}),
        json!({"cmd": "move", "army": [], "x": 1e300}),
        json!({"cmd": "tac", "sub": "deploy", "bid": "esc0", "x": "a"}),
    ] {
        assert!(jeu.cmd(corps.clone()).is_object(), "{corps}");
    }
    let (st, _) = jeu.req("POST", "/api/cmd", b"{}", &[("Content-Length", "abc")]);
    assert!([200, 400, 404].contains(&st), "une taille illisible reçoit une réponse");
}

#[test]
fn arrivee_devant_une_ville() {
    // (évolution du 18/10/2026) : l'armée s'arrête devant la ville, l'état envoie le choix, la commande le transmet
    let jeu = Jeu::lancer("arrivee");
    let g = jeu.nouvelle_partie();
    let a = armee(&g);
    let aid = a.ats("id");
    let mer = g.geo.nodes.iter().enumerate().filter(|(_, gn)| gn.at("name") == "Mérignac").map(|(i, _)| i).last().unwrap();
    let r = jeu.cmd(json!({"cmd": "move", "army": aid, "node": mer, "mode": "route"}));
    assert_eq!(r["ok"], json!(true), "{r}");
    assert!(r["msg"].as_str().unwrap().contains("choisir"));
    let d = vue_armee(&jeu.etat(), &aid);
    assert_eq!(d["ask"]["n"], json!(mer));
    assert_eq!(d["ask"]["c"]["assaut"], json!(""), "l’assaut est toujours permis");
    assert!(d["ask"]["c"].get("ordres").is_none() && d["ask"]["c"].get("manuel").is_none(), "plus de champ de bataille");
    let b = g.armies.values().into_iter().find(|x| x.at("owner") != g.player).unwrap().ats("id");
    for corps in [
        json!({"cmd": "arrive", "army": aid, "value": "piller"}),
        json!({"cmd": "arrive", "army": b, "value": "attendre"}),
        json!({"cmd": "arrive", "army": [], "value": {}}),
        json!({"cmd": "arrive", "army": aid}),
    ] {
        assert_eq!(jeu.cmd(corps.clone())["ok"], json!(false), "{corps}");
    }
    let r = jeu.cmd(json!({"cmd": "tour", "action": "go"}));
    assert_eq!(r["ok"], json!(false), "« Tour suivant » attend le choix");
    assert!(r["msg"].as_str().unwrap().contains("Mérignac"));
    assert_eq!(jeu.cmd(json!({"cmd": "arrive", "army": aid, "value": "attendre"}))["ok"], json!(true));
    assert!(vue_armee(&jeu.etat(), &aid).get("ask").is_none());
}

/// `server.App.__new__(server.App)` : une App sans préparer la carte ni charger de sauvegarde.
fn app_vide() -> App {
    App {
        geos: HashMap::new(),
        static_: HashMap::new(),
        geo: GEO(),
        game: None,
        reseau: Arc::new(Mutex::new(Reseau::default())),
        _auto_key: None,
    }
}

#[test]
fn pas_d_ordre_de_marche_pendant_le_tour_des_ia() {
    // (le Python pose g.tour['end'] dans la partie du serveur, ce qu'une requête ne fait pas : ici, la commande passe
    // par App::command, ce que /api/cmd appelle, sur une partie qu'on tient)
    let _r = racine_temp();
    let mut app = app_vide();
    app.game = Some(Box::new(partie()));
    let (a, t) = {
        let g = app.game.as_ref().unwrap();
        (armee(g), g.t)
    };
    app.game.as_ref().unwrap().tour.set("end", t + 20.0); // le tour des IA a commencé
    for c in ["move", "retreat"] {
        let r = app.command(&dict! {"cmd" => c, "army" => a.at("id"), "x" => a.atf("x") + 30.0, "y" => a.at("y")});
        assert!(!r.atb("ok"), "{c}");
        assert!(r.ats("msg").contains("tour des IA"), "{c}");
    }
    app.game.as_ref().unwrap().tour.set("end", Val::None);
}

#[test]
fn nom_reserve_a_la_sauvegarde_automatique() {
    let jeu = Jeu::lancer("autosave");
    jeu.nouvelle_partie();
    let (_st, txt) = jeu.post("/api/save", &json!({"name": AUTOSAVE}));
    assert_eq!(serde_json::from_str::<Value>(&txt).unwrap()["ok"], json!(true), "{txt}");
    assert!(jeu.dossier.join("saves").join(format!("{AUTOSAVE}-1.json")).exists());
    assert!(!jeu.dossier.join("saves").join(format!("{AUTOSAVE}.json")).exists());
}

// ================================================================== Sauvegardes
// (`server.SAVES` pointé sur un dossier temporaire : ici, la racine du serveur (serveur::ROOT, d'où SAVES) est fixée
// une fois pour toutes, au premier appel, sur un dossier temporaire qui a son web/index.html ; les essais qui écrivent
// des sauvegardes passent l'un après l'autre et vident saves/ d'abord)

/// La racine du serveur dans ce processus : un dossier temporaire (jamais la racine du dépôt et ses vraies
/// sauvegardes). Rend le verrou des sauvegardes, saves/ vidé.
fn racine_temp() -> std::sync::MutexGuard<'static, ()> {
    static RACINE: OnceLock<PathBuf> = OnceLock::new();
    static VERROU: Mutex<()> = Mutex::new(());
    let r = RACINE.get_or_init(|| {
        let d = Path::new(env!("CARGO_TARGET_TMPDIR")).join("bancs_serveur");
        std::fs::create_dir_all(d.join("web")).unwrap();
        std::fs::write(d.join("web/index.html"), "<html></html>").unwrap();
        std::env::set_current_dir(&d).unwrap();
        d
    });
    assert_eq!(SV::ROOT(), r.as_path(), "la racine du serveur est le dossier temporaire");
    let garde = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    let _ = std::fs::remove_dir_all(SV::SAVES());
    std::fs::create_dir_all(SV::SAVES()).unwrap();
    garde
}

#[test]
fn ecriture_puis_lecture() {
    let _r = racine_temp();
    let mut app = app_vide();
    app.game = Some(Box::new(Game::new(GEO(), "33", &Val::from("normal"), &Val::from(1), &Val::from("1790"))));
    app.write_save(AUTOSAVE, true).unwrap();
    let t = std::fs::read_to_string(SV::SAVES().join(format!("{AUTOSAVE}.json"))).unwrap();
    assert_eq!(json::loads(&t).unwrap().at("meta").at("player"), "33");
    assert_eq!(app.list_saves().iter().map(|s| s.ats("name")).collect::<Vec<_>>(), vec![AUTOSAVE.to_string()]);
}

/// base64.b64decode
fn b64decode(s: &str) -> Vec<u8> {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let (mut acc, mut n) = (0u32, 0);
    for c in s.bytes().filter(|&c| c != b'=') {
        acc = acc << 6 | A.iter().position(|&x| x == c).unwrap() as u32;
        n += 6;
        if n >= 8 {
            n -= 8;
            out.push((acc >> n) as u8);
        }
    }
    out
}

/// Une sauvegarde d'avant les versions de la géographie (sans « geo ») se charge sur la carte d'alors
/// (game/data/geo_v1.json) : ses armées restent sur leurs routes, la crue y coupe les mêmes routes (27), et la page
/// reçoit cette carte.
#[test]
fn une_ancienne_sauvegarde_garde_sa_carte() {
    use sha1::{Digest, Sha1};
    let _r = racine_temp();
    let mut app = app_vide();
    app.geos.insert(GEO().version, GEO());
    let ancienne = app.geo_for(1);
    // (ce que la page reçoit, lieux, arêtes, grilles, rivières, rails, et les cases des routes : celle d'avant le lot)
    // (depuis toute la France, cellnode a deux octets par case et la liste des départements jouables s'ajoute : ramenés à
    // l'ancienne forme, le contenu doit être le même)
    let p = ancienne.client_payload().copy();
    p.pop("playable");
    let cn = b64decode(p.at("cellnode").s());
    let octets: Vec<u8> = cn
        .chunks(2)
        .map(|c| u16::from_ne_bytes([c[0], c[1]]))
        .map(|v| if v == 0xFFFF { 255 } else { u8::try_from(v).expect("ValueError: bytes must be in range(0, 256)") })
        .collect();
    p.set("cellnode", conquete::geo::b64encode(&octets));
    let texte = json::dumps_avec(&list![&p, RL::client_payload(&ancienne)], json::Ecriture { ascii: true, sort_keys: true, ..Default::default() });
    let mut h = Sha1::new();
    h.update(texte.as_bytes());
    h.update(&ancienne.road);
    let empreinte: String = h.finalize().iter().map(|o| format!("{o:02x}")).collect();
    assert_eq!(empreinte, "36421fef2a39cf909b5f075799b574936aa8a11f", "la carte des anciennes parties ne change pas");
    let mut g = Game::new(ancienne.clone(), "33", &Val::from("normal"), &Val::from(1), &Val::from("1790"));
    let a = armee(&g);
    let nm: HashMap<String, i64> = ancienne.nodes.iter().map(|n| (n.ats("name"), n.ati("id"))).collect();
    let (bx, lb) = (nm["Bordeaux"], nm["Libourne"]);
    let e = ancienne.edges.iter().find(|e| (e.at("a") == bx && e.at("b") == lb) || (e.at("a") == lb && e.at("b") == bx)).unwrap();
    a.update(&dict! {"state" => "move", "at_node" => Val::None, "edge" => dict! {"e" => e.at("id"), "frm" => e.at("a"), "pos" => 5.0},
        "path" => list![dict! {"kind" => "road", "e" => e.at("id"), "frm" => e.at("a"), "to" => e.at("b"), "pos" => 5.0}]});
    let (x, y) = g.edge_xy(&e, e.ati("a"), 5.0);
    a.set("x", x);
    a.set("y", y);
    g.flood_until = g.t + 30.0;
    let d = json::loads(&json::dumps(&V::to_dict(&mut g))).unwrap();
    d.del("geo"); // (le format d'avant)
    std::fs::write(SV::SAVES().join("ancienne.json"), json::dumps(&dict! {"meta" => dict! {}, "game" => &d})).unwrap();
    assert!(V::from_dict(GEO(), &d).is_err(), "jamais sur la carte des nouvelles parties");
    assert_eq!(app.load(&Val::from("ancienne")).at("geo"), 1, "la page sait qu’elle doit prendre la carte de la partie");
    let g2 = app.game.as_deref_mut().unwrap();
    assert!(Rc::ptr_eq(&g2.geo, &ancienne));
    let a2 = g2.armies.at(a.at("id"));
    assert_eq!(a2.at("edge"), dict! {"e" => e.at("id"), "frm" => e.at("a"), "pos" => 5.0});
    assert_eq!((a2.atf("x"), a2.atf("y")), g2.edge_xy(&g2.geo.edges.at(e.at("id")), e.ati("a"), 5.0));
    assert_eq!(g2.cut_edges().len(), 27);
    assert_eq!(V::to_dict(g2).at("geo"), 1, "resauvegardée, elle garde sa carte");
    let geo2: Rc<GeoMap> = g2.geo.clone();
    let brut = app.payload(&geo2).0;
    assert_eq!(json::loads(std::str::from_utf8(&brut).unwrap()).unwrap().at("geo"), 1, "la page reçoit la carte de la partie");
}

// ================================================================== Mode Europe (géographie 5, SPEC-FRANCE.md étape 2)

/// Le contrat de la page : /api/map?geo=, /api/new avec « geo » (/api/skirmish n'existe plus), le camp d'une autre carte refusé, la
/// sauvegarde d'une partie d'Europe rechargée sur sa carte.
#[test]
fn mode_europe() {
    let jeu = Jeu::lancer("europe");
    let carte = |chemin: &str| -> (u16, Value) {
        let (st, txt) = jeu.get(chemin);
        (st, serde_json::from_str(&txt).unwrap())
    };
    // sans partie : la carte par défaut, la France ; les deux modes sont annoncés
    let (st, fr) = carte("/api/map");
    assert_eq!((st, &fr["geo"], &fr["km_case"]), (200, &json!(4), &json!(1)));
    assert_eq!(fr["modes"], json!([{"geo": 4, "nom": "France", "mot": "département"}, {"geo": 5, "nom": "Europe", "mot": "pays"}]));
    assert_eq!(fr["rules"]["factions"].as_object().unwrap().len(), 89);
    assert_eq!(carte("/api/map?geo=4").1["geo"], json!(4));
    // la carte d'Europe, faite à la première demande
    let t = Instant::now();
    let (st, eu) = carte("/api/map?geo=5");
    eprintln!("/api/map?geo=5, première demande : {:.1} s", t.elapsed().as_secs_f64());
    assert_eq!((st, &eu["geo"], &eu["km_case"], &eu["modes"]), (200, &json!(5), &json!(5), &fr["modes"]));
    assert_eq!(eu.as_object().unwrap().keys().collect::<Vec<_>>(), fr.as_object().unwrap().keys().collect::<Vec<_>>());
    assert_eq!((eu["map"]["W"].as_i64(), eu["map"]["H"].as_i64(), eu["map"]["nodes"].as_array().unwrap().len()), (Some(867), Some(733), 1258));
    let camps = eu["rules"]["factions"].as_object().unwrap();
    assert!(camps.len() == 32 && camps.contains_key("RU") && !camps.contains_key("33"));
    assert_eq!(eu["rules"]["scenarios"]["1700"]["title"], json!("Europe, 1700"));
    assert_eq!(eu["rules"]["scenarios"]["1700"]["word"], json!("pays"));
    assert_eq!(eu["map"]["playable"].as_array().unwrap().len(), 32);
    assert!(eu.get("skirmish").is_none() && fr.get("skirmish").is_none(), "le mode Bataille n'est plus proposé");
    // seules les cartes des nouvelles parties se demandent
    for mauvais in ["/api/map?geo=3", "/api/map?geo=1", "/api/map?geo=6", "/api/map?geo=europe", "/api/map?geo=5.0"] {
        assert_eq!(jeu.get(mauvais).0, 400, "{mauvais}");
    }
    assert_eq!(carte("/api/map?geo=").1["geo"], json!(4), "un paramètre vide ne demande rien");
    // une partie : le camp doit être de la carte
    let nouvelle = |corps: Value| -> (u16, Value) {
        let (st, txt) = jeu.post("/api/new", &corps);
        (st, serde_json::from_str(&txt).unwrap())
    };
    assert_eq!(nouvelle(json!({"dept": "33", "geo": 5})).0, 400, "un département sur la carte d'Europe");
    assert_eq!(nouvelle(json!({"dept": "FR"})).0, 400, "un pays sur la carte de France");
    assert_eq!(nouvelle(json!({"dept": "FR", "geo": 4})).0, 400);
    assert_eq!(nouvelle(json!({"dept": "FR", "geo": 3})).0, 400, "une carte figée");
    assert_eq!(nouvelle(json!({"dept": "FR", "geo": "5"})).0, 400);
    let s: Value = serde_json::from_str(&jeu.get("/api/saves").1).unwrap();
    assert_eq!(s["running"], json!(false), "un refus ne crée pas de partie");
    assert_eq!(nouvelle(json!({"dept": "ML", "geo": 5, "seed": 3, "scenario": "1700"})), (200, json!({"ok": true, "geo": 5})));
    let st = jeu.etat();
    assert_eq!((&st["geo"], &st["word"]), (&json!(5), &json!("pays")));
    assert_eq!(carte("/api/map").1["geo"], json!(5), "la carte de la partie en cours");
    assert_eq!(carte("/api/map?geo=4").1["geo"], json!(4), "l'écran de départ peut toujours demander l'autre");
    // un mois de jeu, puis la sauvegarde
    assert_eq!(jeu.cmd(json!({"cmd": "tour", "action": "go"}))["ok"], json!(true));
    let (_st, txt) = jeu.post("/api/save", &json!({"name": "malte"}));
    assert_eq!(serde_json::from_str::<Value>(&txt).unwrap()["ok"], json!(true), "{txt}");
    assert_eq!(nouvelle(json!({"dept": "33", "seed": 1})), (200, json!({"ok": true, "geo": 4})));
    assert_eq!(carte("/api/map").1["geo"], json!(4));
    let (_st, txt) = jeu.post("/api/load", &json!({"name": "malte"}));
    let r: Value = serde_json::from_str(&txt).unwrap();
    assert_eq!((&r["ok"], &r["geo"]), (&json!(true), &json!(5)), "{txt}");
    assert_eq!(jeu.etat()["geo"], json!(5));
    // le mode Bataille et le champ de bataille ne sont plus servis (SPEC-BATAILLE.md)
    let unites = json!({"ligne": 2, "cavalerie": 1, "artillerie": 1});
    assert_eq!(jeu.post("/api/skirmish", &json!({"me": "PR", "foe": "AU", "geo": 5, "era": "1790", "seed": 4, "units": unites})).0, 404);
    assert_eq!(jeu.get("/api/tactic_map?bid=esc0").0, 404);
    assert_eq!(jeu.get("/api/tactic?bid=esc0").0, 404);
}

/// Une partie d'Europe reprend au redémarrage du serveur (sauvegarde automatique), sur sa carte.
#[test]
fn une_partie_d_europe_reprend_au_redemarrage() {
    let _r = racine_temp();
    let europe = geo(conquete::geo::VERSION_EUROPE);
    let mut app = app_vide();
    app.geos.insert(5, europe.clone());
    app.game = Some(Box::new(Game::new(europe.clone(), "SE", &Val::from("normal"), &Val::from(2), &Val::from("1700"))));
    let avant = V::to_dict(app.game.as_deref_mut().unwrap());
    app.write_save(AUTOSAVE, true).unwrap();
    let mut apres = app_vide(); // (le serveur relancé : sa carte par défaut, aucune partie)
    apres.geos.insert(5, europe.clone());
    apres.load_autosave();
    let g = apres.game.as_deref_mut().expect("la partie n'a pas été reprise");
    assert_eq!((g.geo.version, g.player.as_str()), (5, "SE"));
    // (le chargement complète la sauvegarde, emplacements des places, revenus du jour : on compare ce qui fait la partie)
    let apres_d = V::to_dict(g);
    for k in ["player", "seed", "t", "uid", "seq", "events", "scenario", "geo", "diplo", "market", "tour"] {
        assert_eq!(json::dumps(&apres_d.at(k)), json::dumps(&avant.at(k)), "{k}");
    }
    let places = |d: &Val| d.at("nodes").iter().map(|n| (n.ats("owner"), n.atf("pop"), n.atf("milice"), n.at("garrison").len())).collect::<Vec<_>>();
    assert_eq!(places(&apres_d), places(&avant));
    assert_eq!(apres_d.at("armies").keys(), avant.at("armies").keys());
    let geo2 = g.geo.clone();
    let brut = apres.payload(&geo2).0;
    let p = json::loads(std::str::from_utf8(&brut).unwrap()).unwrap();
    assert_eq!((p.ati("geo"), p.ati("km_case"), p.at("rules").at("factions").len()), (5, 5, 32));
}
