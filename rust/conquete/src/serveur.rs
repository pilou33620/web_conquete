//! Porte server.py : le serveur local du jeu (Conquête, Aquitaine 1790).
//!
//! Lancement :  conquete            (puis ouvrir http://127.0.0.1:8790)
//! Options   :  --port 8790  --lan  --local  --no-browser  --browser  --no-update
//! Au démarrage, le jeu cherche une mise à jour sur GitHub (installé avec git clone) et se relance si besoin.
//! Sur un Raspberry Pi (ou un Linux sans écran), le jeu s'ouvre tout seul au réseau local,
//! n'essaie pas de lancer de navigateur et affiche son adresse réseau.
//!
//! Ce qui change avec le portage :
//! - HTTP, HTTPS et l'appairage (appairage.py) viennent de la caisse commune des web tools (`web_tools_commun`) :
//!   même jeton (~/.web_tools/jeton-reseau.txt), même cookie, même page du code, même CA ;
//! - le moteur tient ses objets dans des `Val` (références partagées, un seul fil) : un seul fil, celui du jeu,
//!   tient l'`App` (partie, escarmouche, cartes). Il fait avancer le temps de jeu et traite les requêtes que les
//!   fils du serveur HTTP lui passent par un canal, une à la fois : c'est le verrou (`self.lock`) du Python.
//!   Les fichiers de web/ et la compression gzip restent dans les fils du serveur HTTP.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{ToSocketAddrs, UdpSocket};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::rc::Rc;
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, UNIX_EPOCH};

use web_tools_commun::appairage::{self, Garde};
use web_tools_commun::serveur::{params, Reponse, Requete, Serveur};

use crate::army_actions as AA;
use crate::cities as CT;
use crate::crue as CR;
use crate::diplomacy as D;
use crate::engine::Game;
use crate::events as EV;
use crate::geo::{GeoMap, VERSION as GEO_VERSION, VERSION_EUROPE};
use crate::py::{self, json, Val};
use crate::rails as RL;
use crate::rules as R;
use crate::tactics::bridge as TB;
use crate::tactics::skirmish as SK;
use crate::turns as TT;
use crate::views as V;
use crate::{dict, list};

/// La racine du jeu (dossier de web/, saves/, game/data) : le répertoire courant s'il contient web/index.html,
/// sinon le premier dossier au-dessus de l'exécutable qui le contient (rust/target/… → la racine du dépôt), sinon le
/// répertoire courant. (ROOT du Python : le dossier de server.py.)
pub fn ROOT() -> &'static Path {
    static R: OnceLock<PathBuf> = OnceLock::new();
    R.get_or_init(|| {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let jeu = |d: &Path| d.join("web").join("index.html").is_file();
        if jeu(&cwd) {
            return cwd;
        }
        let exe = std::env::current_exe().ok().and_then(|e| std::fs::canonicalize(e).ok());
        exe.and_then(|e| e.ancestors().find(|d| jeu(d)).map(Path::to_path_buf)).unwrap_or(cwd)
    })
}
pub fn WEB() -> PathBuf {
    ROOT().join("web")
}
pub fn SAVES() -> PathBuf {
    ROOT().join("saves")
}
pub fn ADDR_FILE() -> PathBuf {
    ROOT().join("adresse-reseau.txt")
}
pub const AUTOSAVE: &str = "sauvegarde-automatique";

/// Ce que l'`App` et la surveillance du réseau partagent (app.port, app.lan, app.ips du Python) : la surveillance
/// tourne dans son propre fil, l'`App` dans celui du jeu.
#[derive(Clone, Default)]
pub struct Reseau {
    pub port: u16,
    pub lan: bool,
    pub ips: Vec<String>,
}

pub struct App {
    pub geos: HashMap<i64, Rc<GeoMap>>,
    /// /api/map de chaque carte (brut, compressé) : `self.static` du Python.
    pub static_: HashMap<i64, (Arc<Vec<u8>>, Arc<Vec<u8>>)>,
    pub geo: Rc<GeoMap>,
    pub game: Option<Box<Game>>,
    pub skirmish: Option<Box<Game>>, // mode Bataille : une partie jetable, à côté de la campagne (game/tactics/skirmish.py)
    pub reseau: Arc<Mutex<Reseau>>,
    pub _auto_key: Option<(usize, i64, i64, bool)>,
}

/// Les cartes des nouvelles parties (R::MODES) : la France (4), l'Europe (5).
fn modes() -> Vec<i64> {
    R::MODES().iter().map(|m| m.ati("geo")).collect()
}

/// Rend le message d'une exception (panique) du moteur : « KeyError: 'node' », « not yet implemented »…
fn message(p: &(dyn std::any::Any + Send)) -> String {
    p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_default()
}

impl App {
    pub fn new(reseau: Arc<Mutex<Reseau>>) -> App {
        let t0 = Instant::now();
        println!("Préparation de la carte de l'Aquitaine…");
        let geo = Rc::new(GeoMap::new(GEO_VERSION));
        let mut app = App {
            geos: HashMap::new(),
            static_: HashMap::new(),
            geo: geo.clone(),
            game: None,
            skirmish: None,
            reseau,
            _auto_key: None,
        };
        app.geos.insert(GEO_VERSION, geo.clone()); // la carte des nouvelles parties
        CR::spans(&geo); // les routes que la crue coupe : calculées ici (environ 1 s) plutôt qu'au premier état en crue
        let nw = geo.edges.iter().filter(|e| e.get("kind") == "water").count();
        println!(
            "Carte prête ({:.1} s) : {} villes et villages, {} routes, {} tronçons navigables.",
            t0.elapsed().as_secs_f64(),
            geo.nodes.len(),
            geo.edges.len() - nw,
            nw
        );
        app.payload(&geo);
        let _ = std::fs::create_dir_all(SAVES());
        app.load_autosave();
        app
    }

    /// La carte d'une géographie (une ancienne partie garde la sienne : geo.py), faite au premier besoin.
    pub fn geo_for(&mut self, v: i64) -> Rc<GeoMap> {
        // (un seul fil tient l'App : la carte n'est faite qu'une fois, même si deux appareils chargent en même temps)
        if !self.geos.contains_key(&v) {
            let geo = Rc::new(GeoMap::new(v));
            self.geos.insert(v, geo.clone());
            CR::spans(&geo); // les routes que la crue coupe : calculées ici (environ 1 s) plutôt qu'au premier état en crue
        }
        self.geos[&v].clone()
    }

    /// /api/map pour cette carte (brut, compressé), calculé une fois.
    pub fn payload(&mut self, geo: &GeoMap) -> (Arc<Vec<u8>>, Arc<Vec<u8>>) {
        if !self.static_.contains_key(&geo.version) {
            let map = geo.client_payload().copy();
            map.set("rails", RL::client_payload(geo));
            // (chaque carte a ses camps, ses textes et ses places de bataille ; modes : les cartes des nouvelles parties,
            // pour l'écran de départ ; km_case : ce que vaut une case, 1 ou 5 km)
            let payload = dict! {"map" => map, "rules" => V::rules_payload_carte(geo.version == VERSION_EUROPE), "skirmish" => SK::options(geo),
                "ver" => UPDATE.lock().unwrap().version.clone(), "geo" => geo.version, "modes" => R::MODES(),
                "km_case" => py::int(geo.km_case)};
            let raw = json::dumps_compact(&payload).into_bytes();
            let gz = gzip(&raw, 6);
            self.static_.insert(geo.version, (Arc::new(raw), Arc::new(gz)));
        }
        self.static_[&geo.version].clone()
    }

    /// La boucle du temps de jeu, et les requêtes qui arrivent entre deux pas (un seul fil : le verrou du Python).
    pub fn loop_(&mut self, demandes: mpsc::Receiver<Demande>) {
        let mut last = Instant::now();
        loop {
            let g = self.game.as_deref();
            // tour des IA en cours : il se calcule d'un coup, par tranches (turns.BUDGET), sans attendre entre elles
            let pause = if g.is_some_and(|g| g.tour.at("on").truthy() && g.tour.at("end").is_some() && g.speed_idx != 0) { 0.02 } else { 0.1 };
            let fin = Instant::now() + Duration::from_secs_f64(pause);
            loop {
                let reste = fin.saturating_duration_since(Instant::now());
                match demandes.recv_timeout(reste) {
                    Ok(d) => self.repondre(d),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            let now = Instant::now();
            let dt = (now - last).as_secs_f64().min(0.3);
            last = now;
            if let Some(sk) = self.skirmish.as_deref_mut() {
                if catch_unwind(AssertUnwindSafe(|| SK::tick(sk, dt))).is_err() {
                    sk.tactical = None;
                }
            }
            if let Some(g) = self.game.as_deref_mut() {
                let ok = catch_unwind(AssertUnwindSafe(|| {
                    TB::tick(g, dt); // bataille tactique en cours (pas fixes, ×0 à ×4)
                    g.advance(dt);
                }))
                .is_ok()
                    && catch_unwind(AssertUnwindSafe(|| self.autosave_tick())).is_ok();
                if !ok {
                    if let Some(g) = self.game.as_deref_mut() {
                        g.speed_idx = 0;
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------ commandes
    fn _node(g: &Game, v: &Val) -> Result<i64, String> {
        let nid = _int(v)?;
        if !g.valid_node(&Val::from(nid)) {
            return Err("lieu inconnu".into());
        }
        Ok(nid)
    }

    fn _num(v: &Val) -> Result<f64, String> {
        let x = _float(v)?;
        if !x.is_finite() {
            return Err("nombre invalide".into());
        }
        Ok(x)
    }

    pub fn command(&mut self, body: &Val) -> Val {
        match catch_unwind(AssertUnwindSafe(|| self.command_(body))) {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => dict! {"ok" => false, "msg" => format!("Commande invalide ({e}).")},
            Err(p) => {
                // (KeyError, ValueError, TypeError, OverflowError, IndexError) du Python ; le reste : erreur interne
                let m = message(&*p);
                match ["KeyError: ", "ValueError: ", "TypeError: ", "OverflowError: ", "IndexError: "].iter().find_map(|k| m.strip_prefix(k)) {
                    Some(e) => dict! {"ok" => false, "msg" => format!("Commande invalide ({e}).")},
                    None => dict! {"ok" => false, "msg" => "Erreur interne : commande ignorée."},
                }
            }
        }
    }

    fn command_(&mut self, body: &Val) -> Result<Val, String> {
        if body.is_dict() && body.get("cmd") == "tac" && SK::owns(self.skirmish.as_deref(), &body.get("bid")) {
            let res = TB::command(self.skirmish.as_deref_mut().unwrap(), body); // mode Bataille (une commande mal formée reçoit aussi une réponse)
            if body.get("sub") == "close" {
                self.skirmish = None;
            }
            return Ok(res);
        }
        let Some(g) = self.game.as_deref_mut() else {
            return Ok(dict! {"ok" => false, "msg" => "Aucune partie en cours."});
        };
        if !body.is_dict() {
            return Ok(dict! {"ok" => false, "msg" => "Commande invalide."});
        }
        let p = g.player.clone();
        let p = p.as_str();
        let c = body.get("cmd");
        let c = if c.is_str() { c.s().to_string() } else { String::new() };
        let c = c.as_str();
        let a = body.get("army");
        let st = |v: Val| format!("{v}"); // str(v)
        let num_ou_rien = |v: Val| -> Result<Val, String> { Ok(if v.is_none() { Val::None } else { Val::from(Self::_num(&v)?) }) };
        if c == "speed" {
            if g.over.truthy() {
                return Ok(dict! {"ok" => false, "msg" => "La partie est terminée."});
            }
            if g.tour.at("on").truthy() {
                // tour par tour : tout passe par « tour » (le tour des IA ne s'arrête pas à la main)
                return Ok(dict! {"ok" => false, "msg" => "Tour par tour : touchez « Tour suivant » en haut."});
            }
            let n = R::SPEEDS().len() as i64 - 1;
            let v = 0.max(n.min(py::int(Self::_num(&body.get_or("value", 0))?)));
            let (ok, why) = TB::on_speed(g, v); // une bataille attend le joueur : la campagne reste figée
            if !ok {
                return Ok(dict! {"ok" => false, "msg" => why});
            }
            g.speed_idx = v;
            return Ok(dict! {"ok" => true});
        }
        if c == "tour" {
            // tour suivant, continuer, temps réel (game/turns.py)
            if st(body.get("action")) == "go" {
                let (ok, why) = TB::on_speed(g, 1); // pas de mois qui reprend tant qu'une bataille attend ou se livre
                if !ok {
                    return Ok(dict! {"ok" => false, "msg" => why});
                }
            }
            return Ok(Self::_r(TT::command(g, &st(body.get("action")), &body.get("value"))));
        }
        if c == "tac" {
            return Ok(TB::command(g, body)); // batailles tactiques (choix, déploiement, ordres, vitesse…)
        }
        if ["retreat", "split", "merge", "split_type", "garrison", "move", "path"].contains(&c) && TB::army_locked(g, &a) {
            return Ok(dict! {"ok" => false, "msg" => "Cette armée se bat sur le champ de bataille : donnez-y vos ordres."});
        }
        if ["move", "path", "assault", "arrive"].contains(&c) {
            // tour par tour : les ordres de marche se donnent pendant son tour
            if let Some(why) = TT::lock_reason(g) {
                return Ok(dict! {"ok" => false, "msg" => why});
            }
        }
        if c == "eta" {
            // arrivée estimée d'une marche, sans donner l'ordre (bulle de l'ordre de marche)
            let (x, y, node) = (body.get("x"), body.get("y"), body.get("node"));
            let node = if node.is_none() { Val::None } else { Val::from(Self::_node(g, &node)?) };
            let (tn, why) = TT::preview(g, p, &a, &num_ou_rien(x)?, &num_ou_rien(y)?, &node, &body.get("mode").or("route"));
            return Ok(dict! {"ok" => true, "tn" => tn, "why" => why});
        }
        if c == "move" {
            let (x, y) = (body.get("x"), body.get("y"));
            let node = body.get("node");
            let tr = body.get("tr");
            let kw = dict! {"x" => num_ou_rien(x)?, "y" => num_ou_rien(y)?,
                "node" => if node.is_none() { Val::None } else { Val::from(Self::_node(g, &node)?) },
                "mode" => body.get("mode"), "tr" => if tr.is_none() { Val::None } else { Val::from(tr.truthy()) },
                "force" => body.getb("force")};
            let res = g.order_move(p, &a, &kw);
            return Ok(Self::_marched(g, &a, res));
        }
        if c == "path" {
            let tr = body.get("tr");
            let tr = if tr.is_none() { Val::None } else { Val::from(tr.truthy()) };
            let res = g.order_path(p, &a, &body.get("pts").or(list![]), &tr, body.getb("force"));
            return Ok(Self::_marched(g, &a, res));
        }
        if c == "army_act" {
            return Ok(Self::_r(AA::command(g, p, &a, &body.get("value"))));
        }
        if c == "conduct" {
            let ar = g.armies.get(&a);
            if ar.truthy() && ar.at("owner") == p {
                ar.set("tr", body.getb("value"));
                return Ok(dict! {"ok" => true, "msg" => if ar.atb("tr") { "L’armée traversera sans combattre en chemin." }
                    else { "L’armée ralliera ou attaquera les places sur sa route." }});
            }
            return Ok(dict! {"ok" => false, "msg" => "Armée introuvable."});
        }
        if c == "stance" {
            return Ok(Self::_r(g.set_stance(p, &a, &body.get("value"))));
        }
        if c == "retreat" {
            let ar = g.armies.get(&a);
            if g.tour.at("on").truthy() && g.tour.at("end").is_some() && ar.truthy() && ar.at("state") != "battle" {
                return Ok(dict! {"ok" => false, "msg" => "C'est le tour des IA : seule une armée au combat peut se replier."});
            }
            let res = g.order_retreat(p, &a);
            TT::settle(g);
            return Ok(Self::_r(res));
        }
        if c == "arrive" {
            // devant une place : le choix du joueur (fenêtre d'arrivée)
            let ar = if a.is_str() { g.armies.get(&a) } else { Val::None };
            let res = AA::choose(g, p, &ar, &st(body.get("value")));
            let out = Self::_r(res);
            if out.getb("ok") && ar.truthy() && g.tactical.as_ref().is_some_and(|tb| ar.get("battle") == tb.bid.as_str()) {
                out.set("bid", ar.at("battle")); // « Commander la bataille » : le champ de bataille s'ouvre
            }
            TT::settle(g); // après un choix sans combat, l'armée reprend sa route
            return Ok(out);
        }
        if c == "assault" {
            let res = g.assault(p, &a);
            TT::settle(g); // l'assaut se livre tout de suite : une bataille s'engage
            return Ok(Self::_r(res));
        }
        let r = match c {
            "garrison" => g.to_garrison(p, &a),
            "split" => g.split(p, &a, &body.get_or("regs", list![])),
            "merge" => g.merge(p, &a, &body.get("other")),
            "talent" => g.choisir_talent(p, &a, &st(body.get_or("value", ""))), // le talent choisi à une promotion (SPEC-GENERAUX.md)
            "nommer" => g.nommer(p, &a, &st(body.get_or("gen", ""))), // un général de la réserve à la tête de l'armée (SPEC-GENERAUX.md)
            "split_type" => g.split_by_type(p, &a, &body.get("value")),
            "spy" => {
                let nid = Self::_node(g, &body.at("node"))?;
                g.spy(p, nid, &body.get("value"))
            }
            "tax" => g.set_tax(p, &body.get_or("value", 0.5)),
            "tarif" => g.set_tarif(p, &body.get("value")), // douane (SPEC-MERCENAIRES.md)
            "douaniers" => g.set_douaniers(p, &body.get("value")),
            "form" => {
                let nid = Self::_node(g, &body.at("node"))?;
                g.form_army(p, nid, &body.get_or("regs", list![]), &body.get("into"))
            }
            "take" => {
                let nid = Self::_node(g, &body.at("node"))?;
                g.form_army(p, nid, &body.get_or("regs", list![]), &a)
            }
            "recruit" => {
                let nid = Self::_node(g, &body.at("node"))?;
                g.recruit(p, nid, &body.get("unit"))
            }
            "build" => {
                let nid = Self::_node(g, &body.at("node"))?;
                g.build(p, nid, &body.get("what"))
            }
            // voie ferrée (game/rails.py)
            "rail_build" => {
                let s = body.get("section");
                if s.is_str() { RL::start(g, p, s.s()) } else { (false, "Tronçon inconnu.".to_string()) }
            }
            // villes : emplacements et politique (game/cities.py)
            "slot_build" => {
                let nid = Self::_node(g, &body.at("node"))?;
                CT::slot_build(g, p, nid, &st(body.get("chain")))
            }
            "slot_demolish" => {
                let nid = Self::_node(g, &body.at("node"))?;
                CT::demolish(g, p, nid, &st(body.get("chain")))
            }
            "policy" => {
                let nid = Self::_node(g, &body.at("node"))?;
                CT::set_policy(g, p, nid, &st(body.get("value")), body.getb("all"))
            }
            "research" => g.research(p, &body.get("tech")),
            "slider" => g.set_slider(p, &body.get_or("value", 0.5)),
            "market" => g.market_trade(p, &body.get("res"), &body.get_or("qty", 0), &body.get("side")),
            "mode" => {
                let ar = g.armies.get(&a);
                let v = body.get("value");
                if ar.truthy() && ar.at("owner") == p && (v == "route" || v == "champs") {
                    ar.set("mode", body.at("value"));
                    return Ok(dict! {"ok" => true});
                }
                return Ok(dict! {"ok" => false, "msg" => "Armée introuvable."});
            }
            "event" => {
                let choice = py::int(Self::_num(&body.get_or("choice", -1))?);
                EV::resolve(g, &st(body.get("id")), choice, false)
            }
            "rearm" => {
                let node = body.get("node");
                let nid = if node.is_none() { Val::None } else { Val::from(Self::_node(g, &node)?) };
                g.modernize(p, &if node.is_none() { a.clone() } else { Val::None }, &nid)
            }
            "enroll" => {
                let frm = body.get("from");
                if !g.factions.has(&frm) && frm != R::NEUTRAL {
                    return Ok(dict! {"ok" => false, "msg" => "Origine inconnue."});
                }
                g.enroll(p, frm.s())
            }
            "rename" => {
                let ar = g.armies.get(&a);
                let name: String = st(body.get_or("value", "")).chars().take(40).collect();
                let name = name.trim();
                if ar.truthy() && ar.at("owner") == p && !name.is_empty() {
                    ar.set("name", name);
                    return Ok(dict! {"ok" => true});
                }
                return Ok(dict! {"ok" => false, "msg" => "Nom invalide."});
            }
            "diplo" => {
                let give = body.get("give");
                let get = body.get("get");
                let (ok, msg) = D::act(g, p, &body.get("to"), &body.get("action"), &body.get_or("amount", 0),
                    &if give.truthy() { give.to_tuple() } else { Val::None }, &if get.truthy() { get.to_tuple() } else { Val::None });
                return Ok(dict! {"ok" => ok == Some(true), "msg" => msg, "pending" => ok.is_none()});
            }
            "answer" => D::answer(g, &body.get("id"), body.getb("accept")),
            _ => return Ok(dict! {"ok" => false, "msg" => "Commande inconnue."}),
        };
        Ok(Self::_r(r))
    }

    /// Ordre de marche : en tour par tour, l'armée part tout de suite. Le message dit où elle en est.
    fn _marched(g: &mut Game, aid: &Val, res: impl Res) -> Val {
        let out = Self::_r(res);
        if !out.getb("ok") || !g.tour.at("on").truthy() {
            return out;
        }
        let used = TT::settle(g);
        let a = g.armies.get(aid);
        if used.has(aid) && a.is_some() {
            let left = TT::march_left(g, &a);
            if a.at("state") == "battle" {
                out.set("msg", "Au contact de l’ennemi : la bataille s’engage.");
            } else if a.getb("ask") {
                out.set("msg", format!("Devant {} : à vous de choisir.", AA::place(g, a.at("ask").ati("node"))));
            } else if a.atb("path") {
                let eta = TT::eta(g, &a, &Val::None);
                let quand = if eta == Some(1) { "au prochain tour".to_string() } else { format!("dans {} tours", Val::from(eta)) };
                out.set("msg", format!("En marche : l’armée a fini sa marche du tour, arrivée {quand} (estimation)."));
            } else if a.at("state") == "siege" {
                out.set("msg", "Arrivée : le siège commence.");
            } else {
                out.set("msg", format!("Arrivée à destination{}", if left > 0.5 { " : elle peut encore marcher ce tour." } else { ", sa marche du tour est finie." }));
            }
        }
        out
    }

    fn _r(res: impl Res) -> Val {
        let (ok, msg) = res.parts();
        if ok.is_none() {
            // l'ordre attend la confirmation du joueur (incident diplomatique…)
            return dict! {"ok" => false, "confirm" => msg};
        }
        if ok.truthy() && msg.is_str() {
            let m = msg.s();
            if (m.starts_with('a') || m.starts_with('r')) && m.len() > 1 && m[1..].chars().all(|c| c.is_ascii_digit()) {
                return dict! {"ok" => true, "id" => msg};
            }
        }
        dict! {"ok" => ok.truthy(), "msg" => msg}
    }

    // ------------------------------------------------------------------ sauvegardes
    pub fn list_saves(&self) -> Val {
        let out = list![];
        let mut noms: Vec<String> = std::fs::read_dir(SAVES())
            .map(|d| d.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect())
            .unwrap_or_default();
        noms.sort();
        for fn_ in noms {
            if !fn_.ends_with(".json") {
                continue;
            }
            let path = SAVES().join(&fn_);
            // (seul « meta » est gardé : le reste de la sauvegarde n'est pas converti)
            let meta = std::fs::read(&path)
                .ok()
                .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                .and_then(|v| v.get("meta").map(json::de_serde))
                .filter(|m| m.is_dict())
                .unwrap_or_else(Val::dict);
            let mtime = std::fs::metadata(&path).and_then(|m| m.modified()).map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64()).unwrap_or(0.0);
            let s = dict! {"name" => &fn_[..fn_.len() - 5], "mtime" => mtime};
            s.update(&meta);
            out.push(s);
        }
        out.sort_by_key(|s| -s.atf("mtime"));
        out
    }

    pub fn save(&mut self, name: &Val) -> Val {
        let name = if name.is_str() { name.s() } else { "" }; // une requête bricolée peut envoyer autre chose qu'un nom
        let name: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || "_- àâäéèêëîïôöùûüç".contains(*c)).collect();
        let name: String = name.trim().chars().take(40).collect();
        let mut name = if name.is_empty() { "partie".to_string() } else { name };
        if name.to_lowercase() == AUTOSAVE {
            name += "-1"; // sinon la prochaine sauvegarde automatique l'écraserait
        }
        if self.game.is_none() {
            return dict! {"ok" => false, "msg" => "Aucune partie à sauvegarder."};
        }
        if let Err(e) = self.write_save(&name, false) {
            return dict! {"ok" => false, "msg" => format!("Sauvegarde impossible ({}).", strerror(&e))};
        }
        dict! {"ok" => true, "msg" => format!("Partie sauvegardée : « {name} ».")}
    }

    pub fn write_save(&mut self, name: &str, auto: bool) -> std::io::Result<()> {
        let g = self.game.as_deref_mut().unwrap();
        let meta = dict! {"player" => g.player.as_str(), "faction" => g.fname(&g.player.clone()), "date" => g.date_str(&Val::None),
            "t" => g.t, "difficulty" => g.difficulty.as_str(), "auto" => auto};
        let data = dict! {"meta" => meta, "game" => V::to_dict(g)};
        let path = SAVES().join(format!("{name}.json"));
        let tmp = SAVES().join(format!("{name}.json.tmp"));
        // json.dumps(data, ensure_ascii=False) : séparateurs « , » et « : » suivis d'une espace, comme le Python
        let txt = json::dumps_avec(&data, json::Ecriture::default());
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(txt.as_bytes())?;
        f.flush()?;
        f.sync_all()?; // vraiment sur la carte SD avant de remplacer l'ancienne (coupure de courant)
        drop(f);
        std::fs::rename(&tmp, &path) // écriture atomique : une coupure de courant ne corrompt pas la sauvegarde
    }

    /// Sauvegarde automatique au début de chaque mois de jeu (et à la fin de la partie).
    pub fn autosave_tick(&mut self) {
        let g = self.game.as_deref().unwrap();
        let d = g.date(&Val::None);
        let key = (g as *const Game as usize, d.year, d.month, g.over.truthy());
        if self._auto_key.is_none_or(|k| k.0 != key.0) {
            self._auto_key = Some(key);
            return;
        }
        if Some(key) != self._auto_key {
            self._auto_key = Some(key);
            if let Err(e) = self.write_save(AUTOSAVE, true) {
                eprintln!("{e}");
            }
        }
    }

    pub fn load_autosave(&mut self) {
        let path = SAVES().join(format!("{AUTOSAVE}.json"));
        if !path.exists() {
            return;
        }
        let lu = catch_unwind(AssertUnwindSafe(|| -> Result<(), String> {
            let data = json::loads(&std::fs::read_to_string(&path).map_err(|e| e.to_string())?)?;
            if data.at("game").get("over").truthy() {
                return Ok(());
            }
            let geo = self.geo_for(data.at("game").get_or("geo", 1).i());
            self.game = Some(Box::new(V::from_dict(geo, &data.at("game"))?));
            println!("Partie reprise depuis la sauvegarde automatique ({}, {}).", data.at("meta").get("faction"), data.at("meta").get("date"));
            Ok(())
        }));
        let erreur = match lu {
            Ok(Ok(())) => return,
            Ok(Err(e)) => e,
            Err(p) => message(&*p),
        };
        eprintln!("{erreur}");
        // mise de côté, pour que la prochaine sauvegarde automatique ne l'écrase pas (rechargeable une fois réparé)
        let keep = SAVES().join(format!("{AUTOSAVE}-illisible-{}.json", chrono::Local::now().format("%Y%m%d-%H%M%S")));
        match std::fs::rename(&path, &keep) {
            Ok(()) => println!("Sauvegarde automatique illisible, mise de côté : {}", keep.file_name().unwrap().to_string_lossy()),
            Err(e) => eprintln!("{e}"),
        }
    }

    pub fn load(&mut self, name: &Val) -> Val {
        if !name.is_str() || name.s().trim().is_empty() {
            return dict! {"ok" => false, "msg" => "Sauvegarde introuvable."};
        }
        let name = name.s();
        let base = name.rsplit(if cfg!(windows) { &['/', '\\'][..] } else { &['/'][..] }).next().unwrap_or(""); // os.path.basename
        let path = SAVES().join(format!("{base}.json"));
        if !path.exists() {
            return dict! {"ok" => false, "msg" => "Sauvegarde introuvable."};
        }
        let lu = catch_unwind(AssertUnwindSafe(|| -> Result<Game, String> {
            let data = json::loads(&std::fs::read_to_string(&path).map_err(|e| e.to_string())?)?;
            let geo = self.geo_for(data.at("game").get_or("geo", 1).i());
            V::from_dict(geo, &data.at("game"))
        }));
        let game = match lu {
            Ok(Ok(g)) => g,
            Ok(Err(e)) => {
                eprintln!("{e}");
                return dict! {"ok" => false, "msg" => "Sauvegarde illisible ou abîmée."};
            }
            Err(_) => return dict! {"ok" => false, "msg" => "Sauvegarde illisible ou abîmée."},
        };
        let v = game.geo.version;
        self.game = Some(Box::new(game));
        dict! {"ok" => true, "msg" => format!("Partie « {name} » chargée."), "geo" => v}
    }

    // ------------------------------------------------------------------ requêtes (do_GET, do_POST du Python)
    fn repondre(&mut self, d: Demande) {
        let rendu = catch_unwind(AssertUnwindSafe(|| self.traiter(&d))).unwrap_or_else(|p| {
            // (le Python coupait la connexion sans réponse ; ici le navigateur reçoit une erreur 500)
            Rendu::Json(500, json::dumps_compact(&dict! {"ok" => false, "msg" => format!("Erreur interne ({}).", message(&*p))}).into_bytes())
        });
        let _ = d.reponse.send(rendu);
    }

    fn traiter(&mut self, d: &Demande) -> Rendu {
        let json_ = |obj: Val, code: u16| Rendu::Json(code, json::dumps_compact(&obj).into_bytes());
        let ver = || Val::from(UPDATE.lock().unwrap().version.clone());
        let since = || q(&d.requete, "since").and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(0);
        if !d.post {
            let path = d.chemin.as_str();
            if path == "/api/map" {
                // (?geo=4 ou 5 : la carte d'un mode de jeu, pour l'écran de départ ; sinon celle de la partie en cours, ou la
                // carte par défaut. La carte d'Europe se fait à la première demande.)
                let geo = match q(&d.requete, "geo") {
                    Some(v) => match v.trim().parse::<i64>() {
                        Ok(v) if modes().contains(&v) => self.geo_for(v),
                        _ => return json_(dict! {"ok" => false, "msg" => "Carte inconnue."}, 400),
                    },
                    None => self.game.as_ref().map(|g| g.geo.clone()).unwrap_or_else(|| self.geo.clone()), // (la carte de la partie en cours)
                };
                let (raw, gz) = self.payload(&geo);
                return Rendu::Carte(raw, gz);
            }
            if path == "/api/state" {
                let since = since();
                let Some(g) = self.game.as_deref_mut() else {
                    return json_(dict! {"game" => Val::None, "ver" => ver()}, 200);
                };
                let st = V::player_state(g, since);
                st.set("geo", g.geo.version); // (la page recharge la carte de la partie)
                st.set("ver", ver()); // le client recharge la page si le serveur a changé de version
                return json_(st, 200);
            }
            if path == "/api/tactic" || path == "/api/tactic_map" {
                let bid = Val::from(q(&d.requete, "bid").unwrap_or_default());
                let since = since();
                // mode Bataille, ou campagne
                let g = if SK::owns(self.skirmish.as_deref(), &bid) { self.skirmish.as_deref_mut() } else { self.game.as_deref_mut() };
                let Some(g) = g else {
                    return json_(dict! {"ok" => false, "msg" => "Aucune partie en cours."}, 404);
                };
                let st = if path == "/api/tactic" { TB::battle_view(g, &bid, since) } else { TB::map_view(g, &bid) };
                if st.is_none() {
                    return json_(dict! {"ok" => false, "msg" => "Aucune bataille tactique."}, 404);
                }
                return json_(st, 200);
            }
            if path == "/api/saves" {
                return json_(dict! {"saves" => self.list_saves(), "running" => self.game.is_some(),
                    "update" => UPDATE.lock().unwrap().val()}, 200);
            }
            return json_(dict! {"ok" => false, "msg" => "Route inconnue."}, 404);
        }
        let path = d.chemin.as_str();
        let body = std::str::from_utf8(&d.corps).ok().and_then(|t| json::loads(t).ok()).filter(Val::is_dict).unwrap_or_else(Val::dict);
        if path == "/api/load" {
            return json_(self.load(&body.get("name")), 200);
        }
        if path == "/api/new" || path == "/api/skirmish" {
            // (geo : la carte du mode choisi, 4 sans rien dire, 5 pour l'Europe)
            let v = body.get("geo");
            if v.is_some() && !(matches!(v, Val::Int(_)) && modes().contains(&v.i())) {
                return json_(dict! {"ok" => false, "msg" => "Carte inconnue."}, 400);
            }
        }
        let geo_du_corps = |app: &mut App| if body.get("geo").is_some() { app.geo_for(body.at("geo").i()) } else { app.geo.clone() };
        if path == "/api/new" {
            let dept = body.get("dept");
            // (le camp doit être de cette carte : un pays sur celle d'Europe, un département sur celle de France ; un refus
            // ne fait pas préparer la carte)
            let europe = body.get("geo") == VERSION_EUROPE;
            let inconnu = || json_(dict! {"ok" => false, "msg" => if europe { "Pays inconnu." } else { "Département inconnu." }}, 400);
            if !R::FACTIONS().has(&dept) || R::PAYS_EUROPE().has(&dept) != europe {
                return inconnu();
            }
            let geo = geo_du_corps(self);
            if !geo.playable_codes.has(&dept) {
                return inconnu();
            }
            let seed = if body.getb("seed") { _int(&body.at("seed")).map(Val::from).unwrap_or(Val::None) } else { Val::None };
            self.game = Some(Box::new(Game::new(geo.clone(), dept.s(), &body.get_or("difficulty", "normal"), &seed, &body.get_or("scenario", "1790"))));
            return json_(dict! {"ok" => true, "geo" => geo.version}, 200);
        }
        if path == "/api/skirmish" {
            // mode Bataille : une bataille isolée, sans campagne
            let geo = geo_du_corps(self);
            let (sk, bid) = match catch_unwind(AssertUnwindSafe(|| SK::new(geo, &body))) {
                Ok(r) => r,
                Err(_) => return json_(dict! {"ok" => false, "msg" => "La bataille n’a pas pu être préparée."}, 200),
            };
            let Some(sk) = sk else {
                return json_(dict! {"ok" => false, "msg" => bid}, 200);
            };
            self.skirmish = Some(Box::new(sk));
            return json_(dict! {"ok" => true, "bid" => bid}, 200);
        }
        if path == "/api/cmd" {
            return json_(self.command(&body), 200);
        }
        if path == "/api/save" {
            return json_(self.save(&body.get("name")), 200);
        }
        json_(dict! {"ok" => false, "msg" => "Route inconnue."}, 404)
    }
}

/// Les trois formes de résultat des ordres du moteur ((bool, texte), (bool ou None, texte), (bool, texte ou None)) :
/// `ok, msg = res` du Python.
pub trait Res {
    fn parts(self) -> (Val, Val);
}
impl Res for (bool, String) {
    fn parts(self) -> (Val, Val) {
        (Val::from(self.0), Val::from(self.1))
    }
}
impl Res for (Option<bool>, String) {
    fn parts(self) -> (Val, Val) {
        (Val::from(self.0), Val::from(self.1))
    }
}
impl Res for (bool, Option<String>) {
    fn parts(self) -> (Val, Val) {
        (Val::from(self.0), Val::from(self.1))
    }
}

/// `int(v)` de Python (ValueError, TypeError, OverflowError : le message de Python).
fn _int(v: &Val) -> Result<i64, String> {
    match v {
        Val::Int(i) => Ok(*i),
        Val::Bool(b) => Ok(*b as i64),
        Val::Float(f) if f.is_nan() => Err("cannot convert float NaN to integer".into()),
        Val::Float(f) if f.is_infinite() => Err("cannot convert float infinity to integer".into()),
        Val::Float(f) => Ok(py::int(*f)),
        Val::Str(s) => s.trim().replace('_', "").parse::<i64>().map_err(|_| format!("invalid literal for int() with base 10: {}", v.repr())),
        _ => Err(format!("int() argument must be a string, a bytes-like object or a real number, not '{}'", v.type_name())),
    }
}

/// `float(v)` de Python.
fn _float(v: &Val) -> Result<f64, String> {
    match v {
        Val::Int(_) | Val::Bool(_) | Val::Float(_) => Ok(v.f()),
        Val::Str(s) => s.trim().replace('_', "").parse::<f64>().map_err(|_| format!("could not convert string to float: {}", v.repr())),
        _ => Err(format!("float() argument must be a string or a real number, not '{}'", v.type_name())),
    }
}

/// `e.strerror or e` : le message du système sans « (os error N) ».
fn strerror(e: &std::io::Error) -> String {
    let t = e.to_string();
    t.split(" (os error").next().unwrap_or(&t).to_string()
}

/// Première valeur non vide du paramètre (parse_qs du Python ignore les valeurs vides).
fn q(requete: &str, nom: &str) -> Option<String> {
    params(requete).into_iter().find(|(k, v)| k == nom && !v.is_empty()).map(|(_, v)| v)
}

fn gzip(raw: &[u8], niveau: u32) -> Vec<u8> {
    let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::new(niveau));
    e.write_all(raw).unwrap();
    e.finish().unwrap()
}

/// Une requête que le fil du jeu traite (chemin, requête, corps JSON brut) et le canal de sa réponse.
pub struct Demande {
    pub post: bool,
    pub chemin: String,
    pub requete: String,
    pub corps: Vec<u8>,
    pub reponse: mpsc::SyncSender<Rendu>,
}

/// La réponse du fil du jeu : un JSON (code, texte), ou /api/map (brut, compressé, calculés une fois).
pub enum Rendu {
    Json(u16, Vec<u8>),
    Carte(Arc<Vec<u8>>, Arc<Vec<u8>>),
}

/// Derniers corps JSON compressés (quelques-uns : un par navigateur) : un état identique, partie en pause et
/// navigateur qui interroge le serveur 4 fois par seconde, n'est pas recompressé.
pub struct GzipCache {
    n: usize,
    d: Mutex<Vec<(Vec<u8>, Arc<Vec<u8>>)>>,
}

impl GzipCache {
    pub const fn new(n: usize) -> Self {
        GzipCache { n, d: Mutex::new(Vec::new()) }
    }

    pub fn compress(&self, raw: &[u8]) -> Arc<Vec<u8>> {
        let gz = self.d.lock().unwrap().iter().find(|(k, _)| k == raw).map(|(_, v)| v.clone());
        if let Some(gz) = gz {
            return gz;
        }
        let gz = Arc::new(gzip(raw, 4));
        let mut d = self.d.lock().unwrap();
        if !d.iter().any(|(k, _)| k == raw) {
            d.push((raw.to_vec(), gz.clone()));
        }
        while d.len() > self.n {
            d.remove(0);
        }
        gz
    }
}

pub static GZ: GzipCache = GzipCache::new(4);

// ---------------------------------------------------------------------- Handler (les fils du serveur HTTP)

fn _send(code: u16, body: Vec<u8>, ctype: &str, gz: Option<Vec<u8>>) -> Reponse {
    match gz {
        Some(gz) => Reponse::new(code, ctype, gz).entete("Content-Encoding", "gzip"),
        None => Reponse::new(code, ctype, body),
    }
}

fn accepte_gzip(r: &Requete) -> bool {
    r.entete("Accept-Encoding").unwrap_or("").contains("gzip")
}

fn _json(r: &Requete, raw: Vec<u8>, code: u16) -> Reponse {
    if raw.len() > 4000 && accepte_gzip(r) {
        let gz = GZ.compress(&raw).to_vec();
        _send(code, raw, "application/json; charset=utf-8", Some(gz))
    } else {
        _send(code, raw, "application/json; charset=utf-8", None)
    }
}

/// Le corps JSON brut ; vide (lu comme {}) si sa taille est illisible ou trop grande.
fn _body(r: &mut Requete) -> Vec<u8> {
    // borne : un corps énorme saturerait la mémoire du Pi
    r.lire_corps(1_000_000).unwrap_or_default()
}

/// Passe la requête au fil du jeu et attend sa réponse.
fn appel(r: &Requete, jeu: &mpsc::Sender<Demande>, post: bool, corps: Vec<u8>) -> Reponse {
    let (tx, rx) = mpsc::sync_channel(1);
    let d = Demande { post, chemin: r.chemin().to_string(), requete: r.requete().to_string(), corps, reponse: tx };
    match jeu.send(d).ok().and_then(|_| rx.recv().ok()) {
        Some(Rendu::Json(code, raw)) => _json(r, raw, code),
        Some(Rendu::Carte(raw, gz)) => {
            if accepte_gzip(r) {
                _send(200, Vec::new(), "application/json; charset=utf-8", Some(gz.to_vec()))
            } else {
                _send(200, raw.to_vec(), "application/json; charset=utf-8", None)
            }
        }
        None => Reponse::texte(500, "Le jeu ne répond plus."),
    }
}

/// mimetypes.guess_type du Python, pour les fichiers de web/ (et .js en application/javascript, comme main()).
/// shortcut: une table des types courants au lieu de /etc/mime.types ; un type manquant part en octet-stream.
fn guess_type(chemin: &Path) -> Option<&'static str> {
    let ext = chemin.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" => "application/javascript",
        "mjs" => "text/javascript",
        "json" => "application/json",
        "webmanifest" => "application/manifest+json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/vnd.microsoft.icon",
        "webp" => "image/webp",
        "txt" => "text/plain",
        "py" => "text/x-python",
        "wasm" => "application/wasm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/x-wav",
        _ => return None,
    })
}

/// Un fichier de web/ (jamais au-dehors : « .. » qui en sortirait est refusé, comme os.path.normpath le faisait).
fn fichier(path: &str) -> Reponse {
    let path = if path == "/" || path.is_empty() { "/index.html" } else { path };
    let mut parts: Vec<&str> = Vec::new();
    for p in path.trim_start_matches('/').split(|c| c == '/' || (cfg!(windows) && c == '\\')) {
        match p {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Reponse::new(404, "text/plain", "Not found");
                }
            }
            p if cfg!(windows) && p.contains(':') => return Reponse::new(404, "text/plain", "Not found"),
            p => parts.push(p),
        }
    }
    let full = parts.iter().fold(WEB(), |c, p| c.join(p));
    if parts.is_empty() || !full.is_file() {
        return Reponse::new(404, "text/plain", "Not found");
    }
    let mut ctype = guess_type(&full).unwrap_or("application/octet-stream").to_string();
    if ctype.starts_with("text/") || ctype == "application/javascript" {
        ctype += "; charset=utf-8";
    }
    match std::fs::read(&full) {
        Ok(b) => _send(200, b, &ctype, None),
        Err(_) => Reponse::new(404, "text/plain", "Not found"),
    }
}

fn do_GET(r: &mut Requete, jeu: &mpsc::Sender<Demande>) -> Reponse {
    let path = r.chemin();
    if ["/api/map", "/api/state", "/api/tactic", "/api/tactic_map", "/api/saves"].contains(&path) {
        return appel(r, jeu, false, Vec::new());
    }
    fichier(path)
}

fn do_POST(r: &mut Requete, jeu: &mpsc::Sender<Demande>) -> Reponse {
    // Exiger du JSON force une requête de contrôle CORS : un autre site ouvert sur le réseau ne peut pas écrire ici.
    let ctype = r.entete("Content-Type").unwrap_or("text/plain").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if ctype != "application/json" {
        return _json(r, json::dumps_compact(&dict! {"ok" => false, "msg" => "JSON attendu."}).into_bytes(), 415);
    }
    let body = _body(r);
    appel(r, jeu, true, body)
}

/// Une requête : le garde (Host, Internet, HTTPS, code d'appairage) avant tout traitement, puis GET ou POST.
pub fn servir(r: &mut Requete, jeu: &mpsc::Sender<Demande>) -> Reponse {
    if let Some(rep) = GARDE().filtrer(r) {
        return rep;
    }
    match r.methode.as_str() {
        "GET" => do_GET(r, jeu),
        "POST" => do_POST(r, jeu),
        m => Reponse::texte(501, &format!("Unsupported method ('{m}')")),
    }
}

/// Adresses IPv4 de la machine sur le réseau local (pour jouer depuis une tablette).
pub fn lan_addresses() -> Vec<String> {
    let mut ips: Vec<String> = Vec::new();
    // aucun paquet n'est envoyé
    if let Some(ip) = UdpSocket::bind("0.0.0.0:0").and_then(|s| s.connect("10.255.255.255:1").and_then(|_| s.local_addr())).ok() {
        ips.push(ip.ip().to_string());
    }
    if cfg!(target_os = "linux") {
        // toutes les interfaces (Wi-Fi et câble) sur Raspberry Pi OS / Debian
        if let Ok((Some(0), out, _)) = lancer(Command::new("hostname").arg("-I"), 2) {
            ips.extend(out.split_whitespace().filter(|ip| ip.contains('.')).map(String::from));
        }
    }
    if let Ok(a) = (appairage::nom_poste().as_str(), 0).to_socket_addrs() {
        ips.extend(a.filter(|a| a.is_ipv4()).map(|a| a.ip().to_string()));
    }
    let mut seen: Vec<String> = Vec::new();
    for ip in ips {
        if !seen.contains(&ip) && !["127.", "169.254.", "0."].iter().any(|p| ip.starts_with(p)) {
            seen.push(ip);
        }
    }
    seen
}

pub fn is_raspberry() -> bool {
    ["/proc/device-tree/model", "/sys/firmware/devicetree/base/model"]
        .iter()
        .any(|p| std::fs::read(p).is_ok_and(|b| b.windows(12).any(|w| w == b"Raspberry Pi")))
}

/// Linux sans écran graphique (Raspberry Pi en SSH, service systemd…), hors Termux sur Android.
pub fn is_headless() -> bool {
    if !cfg!(target_os = "linux") || std::env::var("PREFIX").unwrap_or_default().contains("com.termux") {
        return false;
    }
    let ecran = |v: &str| std::env::var_os(v).is_some_and(|d| !d.is_empty());
    !(ecran("DISPLAY") || ecran("WAYLAND_DISPLAY"))
}

static GARDE_: OnceLock<Garde> = OnceLock::new();

/// Le garde d'accès : posé dans main() selon --lan (avant : inactif, comme `appairage.Garde('Conquête', actif=False)`).
pub fn GARDE() -> &'static Garde {
    GARDE_.get_or_init(|| Garde::new("Conquête", false, None, None))
}

pub fn banner(net: &Reseau, local_url: &str, why: &str) {
    let host = appairage::nom_poste();
    let schema = GARDE().schema();
    let mut lines: Vec<String> = vec![
        String::new(),
        format!("  {}", "=".repeat(62)),
        format!("   Conquête (Aquitaine 1790) est prêt{}", if why.is_empty() { String::new() } else { format!("  [{why}]") }),
        String::new(),
    ];
    if net.lan {
        if !net.ips.is_empty() {
            lines.push("   Pour jouer depuis l'iPad, un téléphone ou un PC du réseau local,".into());
            lines.push("   ouvrez le navigateur à l'une de ces adresses :".into());
            lines.push(String::new());
            for ip in &net.ips {
                lines.push(format!("      {schema}://{ip}:{}", net.port));
            }
            lines.push(format!("      {schema}://{host}.local:{}", net.port));
        } else {
            lines.push("   Réseau pas encore disponible : l'adresse s'affichera dès que".into());
            lines.push("   le Wi-Fi ou le câble sera connecté.".into());
        }
        lines.push(String::new());
        lines.push(format!("   Sur cette machine : {local_url}"));
    } else {
        lines.push(format!("   Ouvrez : {local_url}"));
        lines.push("   (pour jouer depuis l'iPad : relancez avec --lan)".into());
    }
    lines.extend([format!("  {}", "=".repeat(62)), "   (Ctrl+C pour arrêter)".into(), String::new()]);
    println!("{}", lines.join("\n"));
    if net.lan {
        let mut t = String::from("Conquête : adresses pour jouer depuis le réseau local\n\n");
        for ip in &net.ips {
            t += &format!("{schema}://{ip}:{}\n", net.port);
        }
        t += &format!("{schema}://{host}.local:{}\n", net.port);
        let _ = std::fs::write(ADDR_FILE(), t);
    }
}

/// Au démarrage du Raspberry, le Wi-Fi arrive parfois après le jeu : on réaffiche l'adresse dès qu'elle change.
pub fn watch_network(reseau: Arc<Mutex<Reseau>>, local_url: String) {
    loop {
        std::thread::sleep(Duration::from_secs(15));
        let ips = lan_addresses();
        let mut r = reseau.lock().unwrap();
        if ips != r.ips {
            r.ips = ips;
            let net = r.clone();
            drop(r);
            banner(&net, &local_url, "nouvelle adresse réseau");
        }
    }
}

// ---------------------------------------------------------------------- mise à jour automatique
pub const MAJ_ENV: &str = "CONQUETE_MAJ"; // posée lors de la relance après une mise à jour (évite une boucle)

/// état exposé au client (écran de départ) : version = hash court du commit, date = sa date
pub struct Update {
    pub version: Option<String>,
    pub date: Option<String>,
    pub status: String,
    pub msg: String,
    pub news: Vec<String>,
    pub n: i64,
}

impl Update {
    pub fn val(&self) -> Val {
        dict! {"version" => self.version.clone(), "date" => self.date.clone(), "status" => self.status.as_str(),
            "msg" => self.msg.as_str(), "news" => self.news.iter().map(Val::from).collect::<Val>(), "n" => self.n}
    }
}

pub static UPDATE: Mutex<Update> =
    Mutex::new(Update { version: None, date: None, status: String::new(), msg: String::new(), news: Vec::new(), n: 0 });

const NET_ERR: &[&str] = &[
    "could not resolve", "resolve host", "timed out", "timeout", "network is unreachable", "no route to host",
    "connection refused", "connection reset", "connection closed", "failed to connect", "temporary failure",
    "unable to access", "name or service not known", "ssh: connect to host", "could not read from remote",
];
const AUTH_ERR: &[&str] = &[
    "permission denied", "authentication failed", "terminal prompts disabled", "could not read username",
    "could not read password", "repository not found", "host key verification failed",
];

/// subprocess.run(capture_output, timeout) : (code, sortie, erreur) ; code None si la commande a été tuée au bout du
/// délai ; Err si elle n'a pas pu être lancée.
fn lancer(cmd: &mut Command, timeout: u64) -> std::io::Result<(Option<i32>, String, String)> {
    let mut proc = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    let lire = |mut flux: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut tout = Vec::new();
            let _ = flux.read_to_end(&mut tout);
            String::from_utf8_lossy(&tout).into_owned()
        })
    };
    let sortie = lire(Box::new(proc.stdout.take().unwrap()));
    let erreur = lire(Box::new(proc.stderr.take().unwrap()));
    let fin = Instant::now() + Duration::from_secs(timeout);
    let statut = loop {
        if let Some(s) = proc.try_wait()? {
            break Some(s);
        }
        if Instant::now() >= fin {
            let _ = proc.kill();
            let _ = proc.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let (o, e) = (sortie.join().unwrap_or_default(), erreur.join().unwrap_or_default());
    Ok((statut.and_then(|s| s.code()).or(statut.map(|_| -1)), o, e))
}

/// Jamais d'invite de mot de passe : si la clé SSH ou le jeton manque, git échoue tout de suite.
fn _git_env(cmd: &mut Command) {
    cmd.env_remove(MAJ_ENV);
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.env("GCM_INTERACTIVE", "never"); // gestionnaire d'identifiants de Git pour Windows : pas de fenêtre
    cmd.env("LC_ALL", "C"); // messages de git en anglais : plus faciles à reconnaître
    if std::env::var_os("GIT_SSH_COMMAND").is_none() {
        cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=10");
    }
}

/// Lance git dans le dossier du jeu ; renvoie (code, sortie, erreur), code None si git n'a pas répondu.
fn _git(args: &[&str], timeout: u64) -> (Option<i32>, String, String) {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(ROOT());
    _git_env(&mut cmd);
    match lancer(&mut cmd, timeout) {
        Ok((None, _, _)) => (None, String::new(), "timed out".into()),
        Ok((c, o, e)) => (c, o.trim().to_string(), e.trim().to_string()),
        Err(e) => (None, String::new(), e.to_string()),
    }
}

fn _plural(n: i64, mot: &str) -> String {
    format!("{n} {mot}{}", if n > 1 { "s" } else { "" })
}

/// msg : phrase courte montrée aussi sur l'écran de départ ; detail : conseils pour la console seulement.
fn _set_update(status: &str, msg: &str, detail: &str, news: Option<(Vec<String>, i64)>) {
    let mut u = UPDATE.lock().unwrap();
    u.status = status.into();
    u.msg = msg.into();
    if let Some((news, n)) = news {
        u.news = news;
        u.n = n;
    }
    println!("{msg}{}", if detail.is_empty() { String::new() } else { format!("\n   {detail}") });
}

/// shutil.which.
fn which(nom: &str) -> Option<PathBuf> {
    let exts: &[&str] = if cfg!(windows) { &[".exe", ".cmd", ".bat", ""] } else { &[""] };
    std::env::split_paths(&std::env::var_os("PATH")?).flat_map(|d| exts.iter().map(move |e| d.join(format!("{nom}{e}")))).find(|p| p.is_file())
}

/// Relance le serveur après une mise à jour (même PID sous Linux : systemd ne voit rien).
/// Lancé par un script qui reboucle (CONQUETE_RELANCEUR=1, comme les autres web tools) : code de sortie 75, le
/// script recompile ou retélécharge l'exécutable et le relance. Sinon le même exécutable est relancé (web/ et les
/// données sont à jour ; le code du jeu, lui, attend d'être recompilé).
fn _relaunch(info: &serde_json::Value, argv: &[String]) {
    std::env::set_var(MAJ_ENV, info.to_string());
    println!("Redémarrage du jeu avec la nouvelle version…\n");
    let _ = std::io::stdout().flush();
    if std::env::var("CONQUETE_RELANCEUR").as_deref() == Ok("1") {
        // le script qui reboucle relance un nouveau processus : l'annonce passe par un fichier (relu par auto_update)
        let _ = std::fs::write(ROOT().join(".maj-annonce.json"), info.to_string());
        std::process::exit(75);
    }
    let Ok(exe) = std::env::current_exe() else { return };
    let mut cmd = Command::new(exe);
    cmd.args(argv);
    #[cfg(unix)]
    {
        let e = std::os::unix::process::CommandExt::exec(&mut cmd);
        eprintln!("{e}");
    }
    #[cfg(not(unix))]
    {
        // Windows : la fenêtre du .bat attend la fin du nouveau serveur
        std::process::exit(cmd.status().ok().and_then(|s| s.code()).unwrap_or(1));
    }
}

/// Au démarrage : récupère la dernière version sur GitHub (avance rapide seulement) puis relance le jeu.
/// patient : Raspberry Pi / machine sans écran, où le Wi-Fi peut arriver après le service.
pub fn auto_update(enabled: bool, patient: bool, argv: &[String]) {
    let annonce = ROOT().join(".maj-annonce.json");
    let relaunched = std::env::var(MAJ_ENV).ok().or_else(|| std::fs::read_to_string(&annonce).ok());
    let _ = std::fs::remove_file(&annonce);
    std::env::remove_var(MAJ_ENV);
    if which("git").is_none() {
        return _set_update("pas_git", "Mise à jour automatique impossible : git n'est pas installé.", "", None);
    }
    let (code, top, err) = _git(&["rev-parse", "--show-toplevel"], 10);
    let reel = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    if code != Some(0) || reel(Path::new(&top)) != reel(ROOT()) {
        if err.contains("dubious ownership") {
            return _set_update(
                "pas_git",
                "Mise à jour automatique impossible : git refuse ce dossier (autre propriétaire).",
                &format!("Corrigez avec : git config --global --add safe.directory \"{}\"", ROOT().display()),
                None,
            );
        }
        return _set_update("pas_git", "Mise à jour automatique impossible : le jeu n'a pas été installé avec « git clone ».", "", None);
    }

    let version = || {
        let (c, out, _) = _git(&["log", "-1", "--format=%h|%cd", "--date=short"], 10);
        let (h, d) = if c == Some(0) { out.split_once('|').map(|(h, d)| (h.to_string(), d.to_string())).unwrap_or((out.clone(), String::new())) } else { Default::default() };
        let mut u = UPDATE.lock().unwrap();
        u.version = Some(h.clone()).filter(|h| !h.is_empty());
        u.date = Some(d).filter(|d| !d.is_empty());
        h
    };

    let cur = version();
    if let Some(relaunched) = relaunched {
        // nouveau processus après une mise à jour : on l'annonce, sans revérifier
        let (news, n) = serde_json::from_str::<serde_json::Value>(&relaunched)
            .ok()
            .and_then(|info| {
                let (de, a) = (info.get("de")?.as_str()?.to_string(), info.get("a")?.as_str()?.to_string());
                let (c, out, _) = _git(&["log", "--format=%s", "--no-merges", &format!("{de}..{a}")], 10);
                let news: Vec<String> = if c == Some(0) { out.lines().map(String::from).collect() } else { Vec::new() };
                let n = if news.is_empty() { info.get("n").and_then(|n| n.as_i64()).unwrap_or(0) } else { news.len() as i64 };
                Some((news.into_iter().take(15).collect(), n))
            })
            .unwrap_or((Vec::new(), 0));
        let msg = format!("Mise à jour installée : {} (version {cur}).", _plural(n, "nouveauté"));
        return _set_update("mis_a_jour", &msg, "", Some((news, n)));
    }
    if !enabled {
        return _set_update("desactive", &format!("Vérification des mises à jour désactivée (--no-update). Version {cur}."), "", None);
    }
    if _git(&["symbolic-ref", "-q", "HEAD"], 10).0 != Some(0) {
        return _set_update("desactive", &format!("Mise à jour non vérifiée : version figée (HEAD détaché sur {cur})."), "", None);
    }
    let (code, up, _) = _git(&["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], 10);
    if code != Some(0) {
        return _set_update(
            "desactive",
            &format!("Mise à jour non vérifiée : la branche locale ne suit aucune branche de GitHub (version {cur})."),
            "",
            None,
        );
    }

    println!("Recherche d'une mise à jour sur GitHub ({up})…");
    let deadline = Instant::now() + Duration::from_secs(40);
    let reste = || deadline.saturating_duration_since(Instant::now()).as_secs_f64();
    let tries = if patient { 5 } else { 1 };
    for i in 0..tries {
        let (code, _, err) = _git(&["fetch", "--quiet"], reste().clamp(5.0, 25.0) as u64);
        if code == Some(0) {
            break;
        }
        let low = err.to_lowercase();
        let network = !AUTH_ERR.iter().any(|k| low.contains(k)) && (code.is_none() || NET_ERR.iter().any(|k| low.contains(k)));
        if network && i + 1 < tries && reste() > 10.0 {
            println!("GitHub injoignable (réseau pas encore prêt ?) : nouvel essai dans 5 s…");
            std::thread::sleep(Duration::from_secs(5));
            continue;
        }
        let last: String = err.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("pas de réponse").chars().take(160).collect();
        let why = if AUTH_ERR.iter().any(|k| low.contains(k)) {
            "accès refusé par GitHub (clé SSH ou jeton à configurer)"
        } else {
            "GitHub injoignable (pas d'Internet ?)"
        };
        return _set_update(
            "hors_ligne",
            &format!("Mise à jour non vérifiée : {why}. Le jeu démarre avec la version {cur}."),
            &format!("(git : {last})"),
            None,
        );
    }

    let (code, out, _) = _git(&["rev-list", "--count", "HEAD..@{u}"], 10);
    let behind: i64 = if code == Some(0) { out.parse().unwrap_or(0) } else { 0 };
    if behind == 0 {
        return _set_update("a_jour", &format!("Le jeu est à jour (version {cur})."), "", None);
    }

    println!("Nouvelle version disponible ({}) : installation…", _plural(behind, "nouveauté"));
    let old = _git(&["rev-parse", "HEAD"], 10).1;
    let (code, _, err) = _git(&["merge", "--ff-only", "--quiet", "@{u}"], 60);
    if code != Some(0) {
        let ahead = _git(&["rev-list", "--count", "@{u}..HEAD"], 10).1;
        let low = err.to_lowercase();
        let (why, how) = match ahead.parse::<i64>() {
            Ok(n) if n > 0 => (
                format!("cette copie contient {} local(aux) absent(s) de GitHub", _plural(n, "commit")),
                "Pour les combiner avec la nouvelle version : git pull --rebase\n   (ou, pour les abandonner : git reset --hard @{u}), puis relancez le jeu.".to_string(),
            ),
            _ if low.contains("overwritten") || low.contains("local changes") => (
                "des fichiers du jeu ont été modifiés ou ajoutés à la main sur cette machine".to_string(),
                "Voir lesquels : git status. Pour abandonner ces changements : git stash (ou git checkout -- .),\n   puis relancez le jeu.".to_string(),
            ),
            _ => {
                let l: String = err.lines().last().unwrap_or("erreur inconnue").trim().chars().take(160).collect();
                ("git a refusé".to_string(), format!("(git : {l})\n   Essayez « git pull » dans le dossier du jeu."))
            }
        };
        return _set_update(
            "bloque",
            &format!("Mise à jour disponible mais non installée : {why}. Le jeu démarre avec la version {cur}."),
            &how,
            None,
        );
    }

    let new = _git(&["rev-parse", "HEAD"], 10).1;
    println!("Jeu mis à jour de la version {cur} à la version {}. Nouveautés :", version());
    let (c, out, _) = _git(&["log", "--oneline", "--no-decorate", "--no-merges", &format!("{old}..{new}")], 10);
    let lines: Vec<&str> = if c == Some(0) { out.lines().collect() } else { Vec::new() };
    for ln in lines.iter().take(10) {
        println!("   {ln}");
    }
    if lines.len() > 10 {
        println!("   … et {} autres.", lines.len() - 10);
    }
    _relaunch(&serde_json::json!({"de": old, "a": new, "n": behind}), argv);
}

// ---------------------------------------------------------------------- ligne de commande

const USAGE: &str = "usage: conquete [-h] [--host HOST] [--port PORT] [--lan] [--local] [--no-browser] [--browser]\n                [--no-update]";

/// Les options de main() (argparse du Python).
#[derive(Debug, Default, PartialEq)]
pub struct Args {
    pub host: Option<String>,
    pub port: u16,
    pub lan: bool,
    pub local: bool,
    pub no_browser: bool,
    pub browser: bool,
    pub no_update: bool,
}

/// Ok(options), ou Err(code de sortie) après l'aide (0) ou une erreur d'argument (2).
pub fn parse_args(argv: &[String]) -> Result<Args, i32> {
    let mut a = Args { port: 8790, ..Default::default() };
    let erreur = |t: String| {
        eprintln!("{USAGE}\nconquete: error: {t}");
        Err(2)
    };
    let mut it = argv.iter().map(String::as_str);
    while let Some(arg) = it.next() {
        let (nom, mut valeur) = match arg.split_once('=') {
            Some((n, v)) if n.starts_with("--") => (n, Some(v)),
            _ => (arg, None),
        };
        match nom {
            "-h" | "--help" => {
                println!("{USAGE}\n\nConquête — serveur local\n\noptions:");
                println!("  -h, --help    show this help message and exit");
                println!("  --host HOST   adresse d'écoute (0.0.0.0 = tout le réseau local)");
                println!("  --port PORT");
                println!("  --lan         ouvrir le jeu aux autres appareils du réseau local (iPad, téléphone…)");
                println!("  --local       n'accepter que les connexions de cette machine");
                println!("  --no-browser  ne pas ouvrir le navigateur");
                println!("  --browser     ouvrir le navigateur même sur un Raspberry Pi");
                println!("  --no-update   ne pas chercher de mise à jour sur GitHub au démarrage");
                return Err(0);
            }
            "--host" | "--port" => {
                let Some(v) = valeur.take().or_else(|| it.next()) else {
                    return erreur(format!("argument {nom}: expected one argument"));
                };
                if nom == "--host" {
                    a.host = Some(v.to_string());
                } else {
                    match v.trim().parse() {
                        Ok(p) => a.port = p,
                        Err(_) => return erreur(format!("argument --port: invalid int value: '{v}'")),
                    }
                }
            }
            "--lan" => a.lan = true,
            "--local" => a.local = true,
            "--no-browser" => a.no_browser = true,
            "--browser" => a.browser = true,
            "--no-update" => a.no_update = true,
            _ => return erreur(format!("unrecognized arguments: {arg}")),
        }
        if valeur.is_some() {
            return erreur(format!("argument {nom}: ignored explicit argument '{}'", valeur.unwrap()));
        }
    }
    Ok(a)
}

/// webbrowser.open.
fn ouvrir_navigateur(url: &str) {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    } else {
        let mut c = Command::new(if cfg!(target_os = "macos") { "open" } else { "xdg-open" });
        c.arg(url);
        c
    };
    let _ = cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
}

pub fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let args = match parse_args(&argv) {
        Ok(a) => a,
        Err(code) => std::process::exit(code),
    };
    // (geo::data_dir() et git travaillent depuis la racine du jeu)
    let _ = std::env::set_current_dir(ROOT());
    let rpi = is_raspberry();
    let auto = rpi || is_headless(); // Raspberry Pi ou machine sans écran : réseau local, pas de navigateur
    let host = if args.local {
        "127.0.0.1".to_string()
    } else if args.lan || (auto && args.host.is_none()) {
        "0.0.0.0".to_string()
    } else {
        args.host.clone().unwrap_or_else(|| "127.0.0.1".into())
    };
    // shortcut: le serveur commun (web_tools_commun) n'écoute que sur toutes les interfaces ou sur 127.0.0.1 ; une
    // adresse précise (--host 192.168.1.20) demande une ouverture de plus dans cette caisse.
    let reseau = match host.as_str() {
        "0.0.0.0" | "" | "::" => true,
        "127.0.0.1" | "localhost" | "::1" => false,
        autre => {
            eprintln!("{USAGE}\nconquete: error: argument --host: {autre} : seules toutes les interfaces (0.0.0.0) ou 127.0.0.1 sont possibles");
            std::process::exit(2);
        }
    };
    let open_browser = args.browser || (!args.no_browser && !auto);
    // le port d'abord : si le jeu tourne déjà, on s'arrête avant de mettre à jour le code sous ses pieds
    // (la socket n'est pas héritée par exec : le serveur relancé après une mise à jour la rouvre)
    let srv = match Serveur::ouvrir(args.port, reseau, 1) {
        Ok(s) => s,
        Err(_) => {
            // (le serveur commun ne rend pas la raison d'un refus : on la redemande au système)
            let ip = if reseau { "0.0.0.0" } else { "127.0.0.1" };
            let e = std::net::TcpListener::bind((ip, args.port)).err().map_or_else(|| "port refusé".to_string(), |e| e.to_string());
            println!("\nImpossible d'ouvrir le port {} ({e}). Le jeu tourne peut-être déjà : essayez --port 8791.", args.port);
            std::process::exit(1);
        }
    };
    auto_update(!args.no_update, auto, &argv); // peut relancer le serveur avec le nouveau code
    let _ = GARDE_.set(Garde::new("Conquête", reseau, None, None));
    GARDE().brancher(&srv);
    let lan = reseau;
    let net = Arc::new(Mutex::new(Reseau { port: srv.port(), lan, ips: if lan { lan_addresses() } else { Vec::new() } }));
    // l'App vit dans le fil du jeu (le moteur n'a qu'un fil) : elle y est créée, puis la boucle du temps de jeu y tourne
    let (jeu, demandes) = mpsc::channel::<Demande>();
    let (pret, attendre) = mpsc::channel();
    let n2 = net.clone();
    std::thread::spawn(move || {
        let mut app = App::new(n2);
        let _ = pret.send(());
        app.loop_(demandes);
    });
    if attendre.recv().is_err() {
        std::process::exit(1); // (la préparation de la carte a échoué : son erreur est déjà affichée)
    }
    let port = srv.port();
    let url = if lan { format!("http://127.0.0.1:{port}") } else { format!("http://{host}:{port}") };
    banner(&net.lock().unwrap().clone(), &url, if rpi { "Raspberry Pi" } else if auto && !args.lan { "sans écran" } else { "" });
    GARDE().annoncer();
    if lan {
        let (n3, u) = (net.clone(), url.clone());
        std::thread::spawn(move || watch_network(n3, u));
    }
    if open_browser {
        let u = url.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(800));
            ouvrir_navigateur(&u);
        });
    }
    srv.servir(Arc::new(move |r: &mut Requete| servir(r, &jeu)));
}

#[cfg(test)]
mod essais {
    use super::*;

    fn args(l: &[&str]) -> Vec<String> {
        l.iter().map(|a| a.to_string()).collect()
    }

    #[test]
    fn ligne_de_commande() {
        let a = parse_args(&args(&["--port", "9000", "--lan", "--no-browser", "--no-update"])).unwrap();
        assert_eq!((a.port, a.lan, a.no_browser, a.no_update, a.local, a.browser), (9000, true, true, true, false, false));
        let a = parse_args(&args(&["--port=0", "--local", "--browser", "--host", "0.0.0.0"])).unwrap();
        assert_eq!((a.port, a.local, a.browser, a.host.as_deref()), (0, true, true, Some("0.0.0.0")));
        assert_eq!(parse_args(&[]).unwrap().port, 8790);
        for refuse in [&["--port"][..], &["--port", "x"], &["--inconnu"], &["--lan=1"]] {
            assert_eq!(parse_args(&args(refuse)), Err(2), "{refuse:?}");
        }
    }

    #[test]
    fn conversions_de_python() {
        assert_eq!(_int(&Val::from("12")), Ok(12));
        assert_eq!(_int(&Val::from(7.9)), Ok(7));
        assert_eq!(_int(&Val::from("abc")), Err("invalid literal for int() with base 10: 'abc'".into()));
        assert!(_int(&Val::None).unwrap_err().contains("'NoneType'"));
        assert_eq!(App::_num(&Val::from("1.5")), Ok(1.5));
        assert_eq!(App::_num(&Val::from("nan")), Err("nombre invalide".into()));
        assert_eq!(App::_num(&Val::from(1e300)), Ok(1e300));
        assert_eq!(App::_num(&Val::from("x")), Err("could not convert string to float: 'x'".into()));
        // _r : un identifiant (a12, r3) rendu à part ; None : la confirmation
        assert_eq!(App::_r((true, "a12".to_string())).repr(), dict! {"ok" => true, "id" => "a12"}.repr());
        assert_eq!(App::_r((true, "ab".to_string())).repr(), dict! {"ok" => true, "msg" => "ab"}.repr());
        assert_eq!(App::_r((None, "Sûr ?".to_string())).repr(), dict! {"ok" => false, "confirm" => "Sûr ?"}.repr());
        assert_eq!(App::_r((false, None::<String>)).repr(), dict! {"ok" => false, "msg" => Val::None}.repr());
    }

    #[test]
    fn cache_gzip() {
        let c = GzipCache::new(2);
        let a = c.compress(b"aaaa");
        assert!(Arc::ptr_eq(&a, &c.compress(b"aaaa")));
        c.compress(b"b");
        c.compress(b"c");
        assert!(!Arc::ptr_eq(&a, &c.compress(b"aaaa")), "le plus ancien est sorti");
        let mut d = flate2::read::GzDecoder::new(&a[..]);
        let mut s = String::new();
        d.read_to_string(&mut s).unwrap();
        assert_eq!(s, "aaaa");
    }
}
