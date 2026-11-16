//! Porte game/tactics/skirmish.py (en entier). La partie jetable est un `engine::Game` ; ses batailles passent par
//! bridge (conventions de bridge.rs).
//!
//! Mode Bataille : une bataille tactique isolée, sans campagne.
//!
//! Le joueur choisit son camp, l'époque, jusqu'à MAX_UNITS régiments, le type de bataille (rase campagne ou place forte,
//! en attaquant ou en défenseur), et au besoin le lieu, la saison et la météo ; le reste est tiré au sort. Une petite
//! partie jetable (engine.Game) fournit les armes et les noms d'époque, les généraux et la carte : la bataille passe ensuite
//! par bridge.create_orders (« Donner mes ordres ») ou bridge.create (mode « manuel » : « Commander la bataille ») et se
//! joue comme une bataille de campagne. Elle n'est jamais enregistrée et ne touche pas à la campagne en cours (server.App.skirmish, à côté de App.game).

use crate::army_actions as AA;
use crate::battle_log as BL;
use crate::engine::{Date, Game};
use crate::geo::{GeoMap, T_EAU, T_HAUTE};
use crate::py::{self, Random, Val};
use crate::rules as R;
use crate::tactics::bridge as TB;
use crate::{dict, list, py_const, tup};
use std::rc::Rc;

pub const MAX_UNITS: i64 = 10;
py_const!(KINDS, tup!["bataille", "forteresse", "village"]); // (village : sans remparts, barricadé ; au banc, pas dans l'écran)
py_const!(SEASONS, tup!["printemps", "été", "automne", "hiver"]);
py_const!(SEASON_MONTH, dict!{"printemps" => 4, "été" => 7, "automne" => 10, "hiver" => 1});
// une place intacte (ni siège ni brèche : l'escalade) se prend à un contre deux : à ses
// régiments, l'assaillant ajoute un parc de siège et une colonne d'assaut (les grenadiers selon l'époque)
pub const GARRISON_UNITS: i64 = 7;
py_const!(ASSAULT_BONUS, tup!["artillerie", "artillerie", "sapeurs", "grenadiers", "ligne"]);
pub const ASSAULT_UNITS: i64 = 10 + 5; // 10 + len(ASSAULT_BONUS)
// l'adversaire tiré au sort : poids des armes (les grenadiers selon l'époque, les chasseurs pour les Basques)
py_const!(FOE_MIX, dict!{"ligne" => 4.0, "legere" => 1.5, "cavalerie" => 2.0, "artillerie" => 1.5, "grenadiers" => 1.0, "chasseurs" => 1.0});

/// `int(v)` dans un `try / except (TypeError, ValueError)` : None si Python refuse.
/// shortcut: un flottant infini (OverflowError, non rattrapée en Python) est refusé comme les autres ; le JSON du
/// navigateur n'en porte pas.
fn int_ou_rien(v: &Val) -> Option<i64> {
    match v {
        Val::Int(i) => Some(*i),
        Val::Bool(b) => Some(*b as i64),
        Val::Float(f) if f.is_finite() => Some(py::int(*f)),
        Val::Str(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// Python (skirmish.py, l. 32-33) : `def _fort(gn)`
/// gn : un lieu de la carte (dict de geo.nodes).
pub fn _fort(gn: &Val) -> i64 {
    if gn.at("type") == "capitale" {
        gn.ati("fort").max(2)
    } else {
        gn.ati("fort")
    }
}

/// Python (skirmish.py, l. 36-38) : `def _techs(era)`
/// era : une clé de R::SCENARIOS(). Rend un set de noms de technologies (appartenance seulement).
pub fn _techs(era: &str) -> Val {
    let tb = R::SCENARIOS().at(era).get("techs_before");
    Val::set_from(R::TECH().keys().into_iter().filter(|t| tb.truthy() && R::TECH_YEAR().at(t) <= tb).collect())
}

/// Types de régiments qu'on peut aligner à cette époque (la Garde nationale ne quitte pas sa ville).
///
/// Python (skirmish.py, l. 41-53) : `def units_for(era, garrison=False)`
/// garrison : défaut false. Rend la liste des types, dans l'ordre de R::UNIT_ORDER(). `u['req'] and u['req'] not in
/// techs or R.hors_service(typ, year)` : `(a and b) or c`.
pub fn units_for(era: &str, garrison: bool) -> Val {
    let techs = _techs(era);
    let year = R::SCENARIOS().at(era).at("date").ati(0);
    let out = list![];
    for typ in R::UNIT_ORDER().iter() {
        let u = R::UNITS().at(&typ);
        if (u.atb("req") && !techs.has(u.at("req"))) || R::hors_service(typ.s(), year) {
            continue;
        }
        if u.atb("garrison_only") && (!garrison || year < 1789) {
            continue;
        }
        out.push(typ);
    }
    out
}

/// Choix offerts par l'écran du mode Bataille (envoyés avec la carte, /api/map).
///
/// Python (skirmish.py, l. 56-64) : `def options(geo)`
pub fn options(geo: &GeoMap) -> Val {
    let places: Val = geo
        .nodes
        .iter()
        .filter(|n| ["capitale", "ville", "fort"].iter().any(|t| n.at("type") == *t) && geo.playable_codes.has(n.at("dept")))
        .map(|n| dict! {"id" => n.at("id"), "name" => n.at("name"), "type" => n.at("type"), "fort" => _fort(&n)})
        .collect();
    places.sort_by_key(|p| p.at("name"));
    let units = Val::dict_from(
        R::SCENARIOS()
            .keys()
            .into_iter()
            .map(|era| {
                let v = dict! {"field" => units_for(era.s(), false), "garrison" => units_for(era.s(), true)};
                (era, v)
            })
            .collect(),
    );
    dict! {"max" => MAX_UNITS, "kinds" => KINDS(), "seasons" => SEASONS(), "places" => places,
        "weather_w" => R::WEATHER_W(), "assault_units" => ASSAULT_UNITS, "garrison_units" => GARRISON_UNITS,
        "assault_bonus" => ASSAULT_BONUS().len(), "units" => units}
}

/// Python (skirmish.py, l. 67-71) : `def _pick_weather(rng, season, weather)`
/// weather : ce que le navigateur envoie. Tirage (s'il n'est pas un temps connu) :
/// `rng.choices(list(w), list(w.values()))[0]` → `rng.choix_pondere`.
pub fn _pick_weather(rng: &mut Random, season: &str, weather: &Val) -> String {
    if R::WEATHER().has(weather) {
        return weather.string();
    }
    let w = R::WEATHER_W().at(season);
    let poids: Vec<f64> = w.values().iter().map(|p| p.f()).collect();
    rng.choix_pondere(&w.keys(), &poids).string()
}

/// Python (skirmish.py, l. 74-78) : `def _pick_season(rng, season, weather)`
/// season, weather : ce que le navigateur envoie. Tirage : `rng.choice(ok or list(SEASONS))`.
pub fn _pick_season(rng: &mut Random, season: &Val, weather: &Val) -> String {
    if SEASONS().has(season) {
        return season.string();
    }
    let mut ok: Vec<Val> = SEASONS().iter().filter(|s| !R::WEATHER().has(weather) || R::WEATHER_W().at(s).has(weather)).collect();
    if ok.is_empty() {
        ok = SEASONS().vec();
    }
    rng.choice(&ok).string()
}

/// Un point de campagne à r0–r1 km de (x0, y0), sur la terre ferme et pas en haute montagne.
///
/// Python (skirmish.py, l. 81-89) : `def _open_ground(geo, rng, x0, y0, r0, r1)`
/// Tirages : `random()` puis `uniform(r0, r1)`, jusqu'à 80 fois. `T_EAU < t != T_HAUTE` : `T_EAU < t && t != T_HAUTE`.
pub fn _open_ground(geo: &GeoMap, rng: &mut Random, x0: f64, y0: f64, r0: f64, r1: f64) -> (f64, f64) {
    for _ in 0..80 {
        let a = rng.random() * 2.0 * std::f64::consts::PI;
        let r = rng.uniform(r0, r1);
        let (x, y) = (x0 + a.cos() * r, y0 + a.sin() * r);
        if geo.playable_at(x, y) {
            let t = geo.terrain_at(x, y);
            if T_EAU < t && t != T_HAUTE {
                return (x, y);
            }
        }
    }
    (x0, y0)
}

/// Régiment qu'on ne lève que dans certains départements (chasseurs basques).
///
/// Python (skirmish.py, l. 92-95) : `def _local(typ, code)`
pub fn _local(typ: &str, code: &str) -> bool {
    let w = R::UNITS().at(typ).get("where");
    !w.truthy() || w.has(code)
}

/// Python (skirmish.py, l. 98-103) : `def _foe_units(rng, era, code, n, assault)`
/// Rend une liste de n types. Tirage : `rng.choices(avail, poids, k=n)` → `rng.choices_w`.
pub fn _foe_units(rng: &mut Random, era: &str, code: &str, n: i64, assault: bool) -> Val {
    let avail: Vec<Val> = units_for(era, false).iter().filter(|t| FOE_MIX().has(t) && _local(t.s(), code)).collect();
    let poids: Vec<f64> = avail.iter().map(|t| FOE_MIX().atf(t)).collect();
    let out: Vec<Val> = rng.choices_w(&poids, n.max(0) as usize).into_iter().map(|i| avail[i].clone()).collect();
    if assault {
        // out[:2] = ['artillerie', 'artillerie'] : pas d'assaut sans canons (une liste plus courte s'allonge à deux)
        let mut v = vec![Val::from("artillerie"), Val::from("artillerie")];
        v.extend(out.into_iter().skip(2));
        return Val::list(v);
    }
    Val::list(out)
}

/// Liste des types demandés ({type: nombre}), ou un message d'erreur.
///
/// Python (skirmish.py, l. 106-125) : `def _count(units, allowed)`
/// units : ce que le navigateur envoie ({type: nombre}) ; allowed : set de types. Rend (liste des types, '') ou
/// (None, message). `int(k)` dans un try / except (TypeError, ValueError) : se porte par un test (entier, booléen,
/// flottant tronqué — inf ou nan : OverflowError / ValueError en Python —, texte qui se lit comme un entier ;
/// sinon « Nombre de régiments invalide. »).
pub fn _count(units: &Val, allowed: &Val) -> (Val, String) {
    if !units.is_dict() {
        return (Val::None, "Choisissez vos régiments.".to_string());
    }
    let out = list![];
    let mut total: i64 = 0; // (len(out) ; la liste ne garde que de quoi juger, sans s'allonger d'un nombre démesuré)
    for (typ, k) in units.items() {
        let Some(k) = int_ou_rien(&k) else {
            return (Val::None, "Nombre de régiments invalide.".to_string());
        };
        if k <= 0 {
            continue;
        }
        if !allowed.has(&typ) {
            let nom = if R::UNITS().has(&typ) { R::UNITS().at(&typ).at("name") } else { typ };
            return (Val::None, format!("{nom} : indisponible pour cette bataille."));
        }
        total = total.saturating_add(k);
        for _ in 0..k.min(MAX_UNITS + 1 - out.len() as i64).max(0) {
            out.push(&typ);
        }
    }
    if total == 0 {
        return (Val::None, "Choisissez au moins un régiment.".to_string());
    }
    if total > MAX_UNITS {
        return (Val::None, format!("Au plus {MAX_UNITS} régiments."));
    }
    (out, String::new())
}

/// Nouvelle bataille isolée : (partie jetable, bid) ou (None, message).
///
/// Python (skirmish.py, l. 128-225) : `def new(geo, body)`
/// `random.Random(body.get('seed'))` : None → `Random::new_hasard()`, un entier → `Random::new`, un texte → `Random::new_str`. `Game(geo, me, difficulty, rng.randrange(1 << 30), era)`
/// → `Game::new(geo, me, &difficulty, &Val::from(graine), &Val::from(era))`. `g.ais = {}` → `g.ais.clear()` ;
/// `datetime.date` → `crate::engine::Date` (`d.replace(year=…)` : `Date::new`) ; `g._cache_date = None` →
/// `g._cache_date.set(None)` ; `g.tactical = {bid: tb}` → `Some(tb)` ; `g.tac_done = {}` → None.
/// Tirages, dans l'ordre : foe (s'il est absent ou invalide), `randrange(1 << 30)` (pour Game), saison, temps,
/// `randint(1, 28)`, lieu (s'il faut le tirer), `_open_ground` (rase campagne), `_foe_units`, `_open_ground` (l'assaillant),
/// `randrange(1 << 30)` (bid).
pub fn new(geo: Rc<GeoMap>, body: &Val) -> (Option<Game>, String) {
    let me = body.get("me");
    // (les camps de cette carte : les pays sur celle d'Europe, les départements sur les autres)
    let europe = geo.version == crate::geo::VERSION_EUROPE;
    let de_la_carte = |c: &Val| R::FACTIONS().has(c) && R::PAYS_EUROPE().has(c) == europe;
    if !de_la_carte(&me) {
        return (None, "Choisissez votre camp.".to_string());
    }
    let me = me.string();
    let era = if R::SCENARIOS().has(&body.get("era")) { body.ats("era") } else { "1790".to_string() };
    let kind = if KINDS().has(&body.get("kind")) { body.ats("kind") } else { "bataille".to_string() };
    let attack = body.get("role") != "def";
    let place = kind == "forteresse" || kind == "village"; // (village : une place sans remparts, barricadée)
    // (graine : bancs d'essai reproductibles ; sans graine, au hasard)
    let seed = body.get("seed");
    let mut rng = match &seed {
        Val::None => Random::new_hasard(),
        Val::Int(_) | Val::Bool(_) => Random::new(seed.i()),
        Val::Str(s) => Random::new_str(s),
        // shortcut: un flottant entier vaut son entier (hash(3.0) == 3) ; les autres flottants (hash de Python) refusés
        Val::Float(f) if f.fract() == 0.0 => Random::new(*f as i64),
        _ => panic!("TypeError: graine invalide {}", seed.repr()),
    };
    let mut foe = body.get("foe");
    if !de_la_carte(&foe) || foe == me {
        let cs: Vec<Val> = R::camps(europe).into_iter().filter(|c| *c != me).collect();
        foe = rng.choice(&cs);
    }
    let foe = foe.string();
    let allowed = Val::set_from(units_for(&era, place && !attack).iter().filter(|t| _local(t.s(), &me)).collect());
    let (mine, msg) = _count(&body.get("units"), &allowed);
    if mine.is_none() {
        return (None, msg);
    }

    let mut g = Game::new(geo.clone(), &me, &body.get_or("difficulty", "normal"), &Val::from(rng.randrange(1 << 30)), &Val::from(era.as_str()));
    g.ais.clear(); // personne ne gouverne : seule la bataille compte
    g.armies.clear();
    for f in g.factions.values() {
        f.set("army_count", 0);
    }
    // la date : la saison voulue, l'année de l'époque (ou la suivante si l'époque commence plus tard dans l'année)
    let season = _pick_season(&mut rng, &body.get("season"), &body.get("weather"));
    let weather = _pick_weather(&mut rng, &season, &body.get("weather"));
    let y0 = R::SCENARIOS().at(&era).at("date").ati(0);
    let month = SEASON_MONTH().ati(&season);
    let mut d = Date::new(y0, month, rng.randint(1, 28));
    if d.toordinal() < g.start_ord {
        d = Date::new(y0 + 1, d.month, d.day);
    }
    g.t = (d.toordinal() - g.start_ord) as f64 + 0.3;
    g._cache_date.set(None);

    // le lieu
    let pv = body.get("place");
    let mut nid = if pv.is_none() || pv == "" { None } else { int_ou_rien(&pv) };
    let nodes = &geo.nodes;
    if let Some(i) = nid {
        if !(0 <= i && i < nodes.len() as i64 && geo.playable_codes.has(nodes.at(i).at("dept"))) {
            nid = None;
        }
    }
    let jouable = |n: &Val| geo.playable_codes.has(n.at("dept"));
    let (bx, by);
    if kind == "forteresse" {
        if nid.is_none_or(|i| _fort(&nodes.at(i)) < 1) {
            let c: Vec<i64> = nodes.iter().filter(|n| _fort(n) >= 1 && jouable(n)).map(|n| n.ati("id")).collect();
            nid = Some(rng.choice(&c));
        }
        let n = nodes.at(nid.unwrap());
        (bx, by) = (n.atf("x"), n.atf("y"));
    } else if kind == "village" {
        if nid.is_none_or(|i| _fort(&nodes.at(i)) >= 1) {
            let c: Vec<i64> = nodes.iter().filter(|n| n.at("type") == "village" && _fort(n) < 1 && jouable(n)).map(|n| n.ati("id")).collect();
            nid = Some(rng.choice(&c));
        }
        let n = nodes.at(nid.unwrap());
        (bx, by) = (n.atf("x"), n.atf("y"));
    } else {
        if nid.is_none() {
            let c: Vec<i64> = nodes.iter().filter(|n| jouable(n)).map(|n| n.ati("id")).collect();
            nid = Some(rng.choice(&c));
        }
        let n = nodes.at(nid.unwrap());
        (bx, by) = _open_ground(&geo, &mut rng, n.atf("x"), n.atf("y"), 3.5 / geo.km_case, 6.0 / geo.km_case); // (de 3,5 à 6 km : des cases de 5 km en Europe)
    }
    for z in g.weather.keys() {
        g.weather.set(&z, dict! {"kind" => &weather, "left" => 5});
    }

    let (att_code, def_code) = if attack { (me.clone(), foe.clone()) } else { (foe.clone(), me.clone()) };
    let (att_types, def_types);
    if attack {
        let mut a = mine.clone();
        if place {
            // les renforts de l'assaillant d'une place
            let ok = units_for(&era, false);
            a = &mine + &ASSAULT_BONUS().iter().map(|t| if ok.has(&t) { t } else { Val::from("ligne") }).collect::<Val>();
        }
        att_types = a;
        def_types = _foe_units(&mut rng, &era, &foe, if place { GARRISON_UNITS } else { mine.len() as i64 }, false);
    } else {
        def_types = mine.clone();
        att_types = _foe_units(&mut rng, &era, &foe, if place { ASSAULT_UNITS } else { mine.len() as i64 }, place);
    }
    let (ax, ay) = _open_ground(&geo, &mut rng, bx, by, 1.2 / geo.km_case, 2.0 / geo.km_case);
    let regs: Val = att_types.iter().map(|t| g.new_reg(t.s(), &Val::None, &Val::from(att_code.as_str()))).collect();
    let att = g.create_army(&att_code, ax, ay, &regs, &Val::None, &Val::None, &Val::None);
    let sides = list![dict! {"owner" => &att_code, "armies" => list![att.at("id")], "node" => Val::None}];
    let node;
    if place {
        let i = nid.unwrap();
        let n = g.nodes.at(i);
        n.set("owner", &def_code);
        n.set("fort", if kind == "forteresse" { 1.max(_fort(&nodes.at(i))) } else { 0 });
        if kind == "village" {
            n.set("aa", dict! {"bar" => AA::BAR_LEVEL}); // barricades et palissades dressées
        }
        n.set("garrison", list![]);
        let (mm, m) = (n.at("milice_max"), Val::from(150 + 40 * n.ati("fort")));
        n.set("milice", (if m < mm { m } else { mm }).f());
        n.set("siege", Val::None); // la place est intacte : l'assaillant arrive devant ses remparts
        let regs: Val = def_types.iter().map(|t| g.new_reg(t.s(), &Val::None, &Val::from(def_code.as_str()))).collect();
        let name = Val::from(format!("Garnison de {}", nodes.at(i).at("name")));
        let de = g.create_army(&def_code, bx, by, &regs, &Val::from(i), &name, &Val::None);
        sides.push(dict! {"owner" => &def_code, "armies" => list![de.at("id")], "node" => i});
        node = Val::from(i);
    } else {
        let regs: Val = def_types.iter().map(|t| g.new_reg(t.s(), &Val::None, &Val::from(def_code.as_str()))).collect();
        let de = g.create_army(&def_code, bx, by, &regs, &Val::None, &Val::None, &Val::None);
        sides.push(dict! {"owner" => &def_code, "armies" => list![de.at("id")], "node" => Val::None});
        node = Val::None;
    }
    let bid = format!("esc{}", rng.randrange(1 << 30));
    let bt = dict! {"id" => &bid, "x" => bx, "y" => by, "node" => node, "ambush" => false, "surprise" => false, "sides" => sides};
    let tb = if body.get("mode") == "manuel" {
        TB::create(&mut g, &bt, true)
    } else {
        TB::create_orders(&mut g, &bt).expect("AttributeError: 'NoneType' object has no attribute 'spec'")
    };
    tb.spec.set("skirmish", true);
    tb.spec.set(
        "sk",
        dict! {"kind" => &kind, "role" => if attack { "att" } else { "def" }, "me" => &me, "foe" => &foe, "era" => &era,
        "place" => body.getb("place"), "season" => SEASONS().has(&body.get("season")),
        "weather" => R::WEATHER().has(&body.get("weather")), "units" => &mine}, // (journal des batailles)
    );
    tb.spec.set("date", format!("{} {}", R::SEASON_LABEL().at(&season), d.year));
    g.tactical = Some(tb);
    g.tac_done = None;
    (Some(g), bid)
}

/// Python (skirmish.py, l. 228-229) : `def owns(g, bid)`
/// g : la partie jetable du serveur, s'il y en a une. `bid in g.tactical or bid in g.tac_done` : la bataille de ce bid.
pub fn owns(g: Option<&Game>, bid: &Val) -> bool {
    let Some(g) = g else { return false };
    let est = |tb: &Option<Box<crate::tactics::battle::TacticalBattle>>| tb.as_ref().is_some_and(|tb| *bid == tb.bid.as_str());
    bid.is_some() && (est(&g.tactical) || est(&g.tac_done))
}

/// Comme bridge.tick, sans campagne à prévenir : la bataille finie reste à lire (tac_done) jusqu'à « close ».
///
/// Python (skirmish.py, l. 232-238) : `def tick(g, dt)`
/// La bataille sortie de g.tactical, avancée (`TB::advance`), remise ou finie (`TB::finish`) ;
/// `BL.skirmish_end(tb)` la lit alors dans g.tac_done.
pub fn tick(g: &mut Game, dt: f64) {
    let Some(mut tb) = g.tactical.take() else { return };
    TB::advance(&mut tb, dt);
    if tb.phase == "fin" {
        TB::finish(g, tb); // (aucune bataille de campagne derrière : elle passe seulement dans tac_done)
        BL::skirmish_end(g.tac_done.as_ref().unwrap());
    } else {
        g.tactical = Some(tb);
    }
}
