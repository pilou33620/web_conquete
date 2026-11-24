//! Les mesures de l'outil d'équilibre : **une ligne par mesure**, dans l'une des quatre tables ci-dessous. Une mesure lit
//! la partie (`e.g`) ou sa sauvegarde (`e.d`, `views::to_dict`) : un champ ajouté au moteur et sauvegardé (les agents
//! `agents`, la politique `factions[c].politique`, le caractère `factions[c].caractere`…) y apparaît sans rien changer
//! ici ; tant qu'il n'existe pas, la mesure rend `None` (ou rien) et le rapport ne la montre pas.
//!
//! - `SERIES_CAMP` : un nombre par camp, relevé chaque année (courbes du rapport : médiane et étendue sur les parties) ;
//! - `CATEGORIES_CAMP` : un mot par camp à la fin de la partie (régime, caractère…), compté avec les places du camp ;
//! - `SERIES_MONDE` : des nombres pour toute la carte, chaque année (prix, routes, états diplomatiques…) ;
//! - `COMPTEURS` : ce qui arrive chaque mois (unités levées, bâtiments, batailles…) : la fonction compare la partie à ce
//!   qu'elle a gardé du mois d'avant (`memo`) et ajoute à sa famille `{clé: [a, b]}`. `connus` : les clés possibles
//!   (alerte « jamais choisi ») ; `ratio` : b / a est une réussite (alerte « toujours perdant » ou « toujours gagnant »).
//!
//! Aucune mesure ne change la partie (elles lisent seulement).

use conquete::cities;
use conquete::engine::Game;
use conquete::py::{self, Val};
use conquete::rules as R;
use std::collections::BTreeMap;

/// Ce que voit une mesure : la partie et sa sauvegarde.
pub struct Etat<'a> {
    pub g: &'a Game,
    pub d: Val,
}

/// `v.a.b.c` sans paniquer : None dès qu'un maillon manque ou n'est pas un dict.
pub fn ch(v: &Val, chemin: &str) -> Val {
    let mut v = v.clone();
    for k in chemin.split('.') {
        if !v.is_dict() {
            return Val::None;
        }
        v = v.get(k);
    }
    v
}

/// Les éléments d'une liste, ou rien.
fn liste(v: &Val) -> Vec<Val> {
    if v.is_list() { v.vec() } else { vec![] }
}

/// Un nombre, ou None (champ absent, ou autre chose qu'un nombre).
fn nombre(v: &Val) -> Option<f64> {
    v.is_num().then(|| v.f())
}

impl Etat<'_> {
    fn camp(&self, c: &str) -> Val {
        self.g.factions.at(c)
    }
    fn places(&self, c: &str) -> f64 {
        self.g.nodes.iter().filter(|n| n.at("owner") == c).count() as f64
    }
    /// Les régiments du camp : armées et garnisons.
    fn hommes(&self, c: &str) -> f64 {
        let armees = self.g.armies.values().into_iter().filter(|a| a.at("owner") == c).flat_map(|a| a.at("regs").vec());
        let garnisons = self.g.nodes.iter().filter(|n| n.at("owner") == c).flat_map(|n| liste(&n.get("garrison")));
        armees.chain(garnisons).map(|r| r.atf("n")).sum()
    }
    /// Les flottes de la carte et celles en traversée.
    fn flottes(&self) -> Vec<Val> {
        let mut v = self.g.flottes.values();
        v.extend(conquete::engine::commerce::en_mer(self.g));
        v
    }
    /// Les éléments d'un dict (ou d'une liste) de la sauvegarde qui appartiennent au camp c (`owner` ou `proprio`).
    fn a_soi(&self, cle: &str, c: &str) -> Option<Vec<Val>> {
        let v = self.d.get(cle);
        let l = if v.is_dict() { v.values() } else if v.is_list() { v.vec() } else { return None };
        Some(l.into_iter().filter(|x| x.is_dict() && (x.get("owner") == c || x.get("proprio") == c)).collect())
    }
}

// ================================================================== par camp, chaque année
pub type Serie = fn(&Etat, &str) -> Option<f64>;
pub const SERIES_CAMP: &[(&str, &str, Serie)] = &[
    ("places", "Places tenues", |e, c| Some(e.places(c))),
    ("vivant", "En vie (1) ou rayé (0)", |e, c| Some(e.camp(c).atb("alive") as i64 as f64)),
    ("revenus", "Revenus (livres par jour)", |e, c| nombre(&ch(&e.camp(c), "income.livres"))),
    ("tresor", "Trésor (livres)", |e, c| nombre(&ch(&e.camp(c), "res.livres"))),
    ("armee", "Hommes sous les armes (armées et garnisons)", |e, c| Some(e.hommes(c))),
    ("techs", "Technologies connues", |e, c| Some(e.camp(c).get("techs").len() as f64)),
    ("navires", "Navires", |e, c| Some(e.flottes().iter().filter(|f| f.at("owner") == c).map(|f| py::sum(f.at("navires").values().iter().map(Val::f))).sum())),
    ("flottes", "Flottes", |e, c| Some(e.flottes().iter().filter(|f| f.at("owner") == c).count() as f64)),
    ("commerce", "Commerce maritime (livres par jour)", |e, c| Some(conquete::engine::commerce::revenu(&e.camp(c)))),
    ("prestige", "Prestige", |e, c| nombre(&e.camp(c).get("prestige"))),
    // --- les nouveautés (SPEC-POLITIQUE) : elles s'allument quand le moteur les sauvegarde
    ("agents", "Agents (R7)", |e, c| e.a_soi("agents", c).map(|l| l.len() as f64)),
    ("mecontentement_peuple", "Mécontentement du peuple (R8)", |e, c| nombre(&ch(&e.camp(c), "politique.classes.peuple.mecontentement"))),
    ("mecontentement_noblesse", "Mécontentement de la noblesse (R8)", |e, c| nombre(&ch(&e.camp(c), "politique.classes.noblesse.mecontentement"))),
    ("attitude", "Attitude moyenne envers les autres camps (R9)", |e, c| {
        // {autre camp: valeur} ou {autre camp: {valeur, raisons}}
        let a = e.camp(c).get("attitude");
        let v: Vec<f64> = if a.is_dict() { a.values().iter().filter_map(|x| nombre(x).or_else(|| nombre(&ch(x, "valeur")))).collect() } else { vec![] };
        (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64)
    }),
];

// ================================================================== par camp, à la fin
pub type Categorie = fn(&Etat, &str) -> Option<String>;
pub const CATEGORIES_CAMP: &[(&str, &str, Categorie)] = &[
    ("regime", "Régime à la fin (R8)", |e, c| ch(&e.camp(c), "politique.regime").is_str().then(|| ch(&e.camp(c), "politique.regime").string())),
    ("caractere", "Caractère de l'IA (R9)", |e, c| e.camp(c).get("caractere").is_str().then(|| e.camp(c).get("caractere").string())),
];

// ================================================================== toute la carte, chaque année
pub type SerieMonde = fn(&Etat) -> Vec<(String, f64)>;
pub const SERIES_MONDE: &[(&str, &str, SerieMonde)] = &[
    ("prix", "Prix du marché", |e| e.g.market.items().into_iter().filter(|(_, v)| v.is_num()).map(|(k, v)| (k.string(), v.f())).collect()),
    ("denrees", "Prix des denrées coloniales", |e| {
        ch(&e.d, "commerce.marche").items_ou_rien().into_iter().filter_map(|(k, v)| nombre(&ch(&v, "prix")).map(|p| (k.string(), p))).collect()
    }),
    ("commerce", "Commerce maritime", |e| {
        let routes = ch(&e.d, "commerce.routes").items_ou_rien();
        let comptoirs = ch(&e.d, "commerce.comptoirs");
        let tenus = if comptoirs.is_list() { comptoirs.iter().filter(|k| ch(k, "navires").truthy()).count() } else { 0 };
        vec![
            ("routes".into(), routes.len() as f64),
            ("routes coupées".into(), routes.iter().filter(|(_, r)| ch(r, "coupee").truthy()).count() as f64),
            ("comptoirs tenus".into(), tenus as f64),
            ("flottes en traversée".into(), ch(&e.d, "commerce.en_mer").items_ou_rien().len() as f64),
        ]
    }),
    // guerre, alliance… et les états qu'ajoutera la diplomatie (protectorat…) : comptés tels quels
    ("diplomatie", "États diplomatiques entre camps", |e| {
        let mut n: BTreeMap<String, f64> = BTreeMap::new();
        for s in e.g.diplo.values().filter(|s| *s != "paix") {
            *n.entry(s.clone()).or_default() += 1.0;
        }
        n.into_iter().collect()
    }),
    ("camps", "Camps", |e| {
        let vivants = e.g.factions.values().iter().filter(|f| f.atb("alive")).count();
        vec![("en vie".into(), vivants as f64), ("en guerre".into(), e.g.diplo.values().filter(|s| *s == "guerre").count() as f64)]
    }),
];

trait ItemsOuRien {
    fn items_ou_rien(&self) -> Vec<(Val, Val)>;
}
impl ItemsOuRien for Val {
    fn items_ou_rien(&self) -> Vec<(Val, Val)> {
        if self.is_dict() { self.items() } else { vec![] }
    }
}

// ================================================================== ce qui arrive chaque mois
pub type Famille = BTreeMap<String, [f64; 2]>;
pub struct Compteur {
    pub id: &'static str,
    pub titre: &'static str,
    /// ce que comptent a et b ("" : pas de b)
    pub a: &'static str,
    pub b: &'static str,
    /// la clé est un camp (tableau des camps, pas de graphique à part)
    pub par_camp: bool,
    /// b / a est une réussite : alerte si toujours perdant ou toujours gagnant
    pub ratio: bool,
    /// les clés possibles, pour l'alerte « jamais choisi » (vide : pas d'alerte)
    pub connus: fn(&Game) -> Vec<String>,
    pub f: fn(&Etat, &mut Val, &mut Famille),
}

fn aucun(_: &Game) -> Vec<String> {
    vec![]
}

/// Les clés d'une table des règles qui ne demandent pas de technologie (champ `tech` vide).
fn sans_tech(d: Val) -> Vec<String> {
    d.items().into_iter().filter(|(_, v)| !v.getb("tech")).map(|(k, _)| k.string()).collect()
}

fn ajoute(fam: &mut Famille, k: impl Into<String>, a: f64, b: f64) {
    let e = fam.entry(k.into()).or_default();
    e[0] += a;
    e[1] += b;
}

/// Les identifiants d'une collection, comparés au mois d'avant : rend les nouveaux et ceux qui ont disparu (avec leur
/// valeur du mois d'avant), et garde ceux de ce mois dans memo.
fn nouveaux(memo: &mut Val, maintenant: Vec<(String, Val)>) -> (Vec<Val>, Vec<Val>) {
    let avant = if memo.is_dict() { memo.clone() } else { Val::dict() };
    let neuf = Val::dict();
    let mut plus = vec![];
    for (k, v) in maintenant {
        if !avant.has(k.as_str()) && memo.is_dict() {
            plus.push(v.clone());
        }
        neuf.set(k.as_str(), v);
    }
    let moins = avant.items().into_iter().filter(|(k, _)| !neuf.has(k)).map(|(_, v)| v).collect();
    *memo = neuf;
    (plus, moins)
}

fn regiments(e: &Etat) -> Vec<(String, Val)> {
    let mut v = vec![];
    for a in e.g.armies.values() {
        v.extend(a.at("regs").iter());
    }
    for n in e.g.nodes.iter() {
        v.extend(liste(&n.get("garrison")));
    }
    v.into_iter().filter(|r| r.is_dict()).map(|r| (r.get("id").to_string(), r)).collect()
}

/// Les unités qu'on peut lever sans condition (ni technologie, ni bâtiment, ni pays) quelque part dans la période.
fn unites_connues(g: &Game) -> Vec<String> {
    let y = g.date(&Val::None).year;
    R::UNITS()
        .items()
        .into_iter()
        .filter(|(k, u)| !R::hors_service(k.s(), y) && !u.atb("req") && !u.getb("where") && !R::MERCS().has(k) && !R::UNIT_REQ().has(k))
        .map(|(k, _)| k.string())
        .collect()
}

pub const COMPTEURS: &[Compteur] = &[
    Compteur { id: "unites", titre: "Régiments apparus (levés, loués, donnés par un événement)", a: "apparus", b: "disparus", par_camp: false, ratio: false, connus: unites_connues,
        f: |e, memo, fam| {
            let (plus, moins) = nouveaux(memo, regiments(e));
            plus.iter().for_each(|r| ajoute(fam, r.ats("type"), 1.0, 0.0));
            moins.iter().for_each(|r| ajoute(fam, r.ats("type"), 0.0, 1.0));
        } },
    Compteur { id: "batiments", titre: "Bâtiments bâtis (niveaux)", a: "niveaux", b: "", par_camp: false, ratio: false,
        // (les chaînes dont le premier niveau ne demande pas de technologie)
        connus: |_| {
            let mut v: Vec<String> = cities::CHAINS().items().into_iter().filter(|(_, c)| !c.at("levels").at(0).getb("tech")).map(|(k, _)| k.string()).collect();
            v.extend(["fort", "dev"].map(String::from));
            v
        },
        f: |e, memo, fam| {
            // {place: [propriétaire, {chaîne: niveau}]}
            let maintenant = e.g.nodes.iter().map(|n| {
                let lv = n.get("slots").copy();
                let lv = if lv.is_dict() { lv } else { Val::dict() };
                lv.set("fort", n.get_or("fort", 0));
                lv.set("dev", n.get_or("dev", 0));
                (n.at("id").to_string(), conquete::list![n.at("owner"), lv])
            });
            let avant = memo.clone();
            let neuf = Val::dict();
            for (k, v) in maintenant {
                let a = if avant.is_dict() { avant.get(k.as_str()) } else { Val::None };
                if a.is_some() && a.at(0) == v.at(0) {
                    for (ch, lvl) in v.at(1).items() {
                        let d = lvl.i() - a.at(1).get_or(&ch, 0).i();
                        if d > 0 {
                            ajoute(fam, ch.string(), d as f64, 0.0);
                        }
                    }
                }
                neuf.set(k.as_str(), v);
            }
            *memo = neuf;
        } },
    Compteur { id: "navires", titre: "Navires gagnés (lancés, pris) et perdus", a: "gagnés", b: "perdus", par_camp: false, ratio: false,
        connus: |_| sans_tech(R::NAVIRES()),
        f: |e, memo, fam| {
            let maintenant = Val::dict(); // {"camp type": n}
            for f in e.flottes() {
                for (t, n) in f.at("navires").items() {
                    let k = format!("{} {}", f.at("owner"), t);
                    maintenant.set(k.as_str(), maintenant.get_or(k.as_str(), 0.0).f() + n.f());
                }
            }
            if memo.is_dict() {
                let mut cles: Vec<Val> = maintenant.keys();
                cles.extend(memo.keys());
                cles.sort_by(|a, b| a.s().cmp(b.s()));
                cles.dedup();
                for k in cles {
                    let d = maintenant.get_or(&k, 0.0).f() - memo.get_or(&k, 0.0).f();
                    let t = k.s().rsplit(' ').next().unwrap_or("").to_string();
                    if d > 0.0 { ajoute(fam, t, d, 0.0) } else if d < 0.0 { ajoute(fam, t, 0.0, -d) }
                }
            }
            *memo = maintenant;
        } },
    // les batailles terrestres : leurs traces (Game.sites, 120 jours), comptées une fois
    Compteur { id: "batailles", titre: "Batailles terrestres, par situation", a: "livrées", b: "gagnées par l'assaillant", par_camp: false, ratio: false, connus: aucun,
        f: |e, memo, fam| {
            for s in traces_neuves(e, memo) {
                ajoute(fam, s.get_or("s", "campagne").string(), 1.0, (s.get("w") == 0i64) as i64 as f64);
            }
        } },
    Compteur { id: "strategies", titre: "Stratégies de bataille terrestre", a: "choisie", b: "victoires", par_camp: false, ratio: true,
        connus: |_| sans_tech(R::STRATS()),
        f: |e, memo, fam| {
            for s in traces_neuves(e, memo) {
                let w = s.get("w") == 0i64;
                for (si, st) in s.get_or("st", conquete::list![]).iter().enumerate() {
                    if st.is_str() {
                        ajoute(fam, st.string(), 1.0, (w == (si == 0)) as i64 as f64);
                    }
                }
            }
        } },
    // les batailles navales ne sont écrites au journal que si le camp suivi (le « joueur ») ou un allié y est
    Compteur { id: "navales", titre: "Batailles navales du camp suivi et de ses alliés", a: "livrées", b: "gagnées par l'assaillant", par_camp: false, ratio: false, connus: aucun,
        f: |e, memo, fam| {
            for ev in journal_neuf(e, memo).iter().filter(|ev| ev.at_is("kind", "battle_end") && ev.getb("naval")) {
                let k = if ev.getb("interception") { "interception" } else { "bataille" };
                ajoute(fam, k, 1.0, (ev.get("w") == 0i64) as i64 as f64);
            }
        } },
    Compteur { id: "strategies_nav", titre: "Stratégies de bataille navale (camp suivi et alliés)", a: "choisie", b: "victoires", par_camp: false, ratio: true,
        connus: |_| R::STRATS_NAV().keys().iter().map(Val::string).collect(),
        f: |e, memo, fam| {
            for ev in journal_neuf(e, memo).iter().filter(|ev| ev.at_is("kind", "battle_end") && ev.getb("naval") && !ev.getb("interception")) {
                let w = ev.get("w") == 0i64;
                for (si, st) in ev.get_or("strats", conquete::list![]).iter().enumerate() {
                    if st.is_str() {
                        ajoute(fam, st.string(), 1.0, (w == (si == 0)) as i64 as f64);
                    }
                }
            }
        } },
    Compteur { id: "sieges", titre: "Sièges et places prises", a: "nombre", b: "pris", par_camp: false, ratio: false, connus: aucun,
        f: |e, memo, fam| {
            // {place: [propriétaire, assiégée]}
            let avant = memo.clone();
            let neuf = Val::dict();
            for n in e.g.nodes.iter() {
                let k = n.at("id").to_string();
                let (o, s) = (n.at("owner"), n.get("siege").truthy());
                if avant.is_dict() {
                    let a = avant.at(k.as_str());
                    let pris = a.at(0) != o;
                    if s && !a.at(1).truthy() {
                        ajoute(fam, "sièges commencés", 1.0, 0.0);
                    }
                    if a.at(1).truthy() && !s {
                        ajoute(fam, "sièges finis", 1.0, pris as i64 as f64);
                    }
                    if pris {
                        ajoute(fam, "places changées de main", 1.0, 0.0);
                    }
                }
                neuf.set(k.as_str(), conquete::list![o, s]);
            }
            *memo = neuf;
        } },
    // une guerre est gagnée par le camp qui a pris le plus de places à l'autre pendant qu'elle durait (ou qui l'a rayé)
    Compteur { id: "guerres", titre: "Guerres finies", a: "gagnées", b: "perdues", par_camp: true, ratio: false, connus: aucun,
        f: |e, memo, fam| {
            if !memo.is_dict() {
                *memo = conquete::dict! {"own" => conquete::list![], "guerres" => Val::dict()};
            }
            let own: Vec<Val> = e.g.nodes.iter().map(|n| n.at("owner")).collect();
            let avant = memo.at("own");
            let guerres = memo.at("guerres");
            if avant.len() == own.len() {
                for (i, o) in own.iter().enumerate() {
                    let a = avant.at(i as i64);
                    if a != *o && o.is_str() && a.is_str() {
                        let (x, y) = (o.string(), a.string());
                        let k = if x < y { format!("{x}|{y}") } else { format!("{y}|{x}") };
                        if guerres.has(k.as_str()) {
                            guerres.at(k.as_str()).inc(if x < y { 0 } else { 1 }, 1);
                        }
                    }
                }
            }
            let maintenant: Vec<String> = e.g.diplo.iter().filter(|(_, s)| *s == "guerre").map(|((a, b), _)| format!("{a}|{b}")).collect();
            for k in &maintenant {
                if !guerres.has(k.as_str()) {
                    guerres.set(k.as_str(), conquete::list![0, 0]);
                }
            }
            for (k, gains) in guerres.items() {
                if maintenant.iter().any(|m| m == k.s()) {
                    continue;
                }
                let (a, b) = k.s().split_once('|').unwrap();
                let vivant = |c: &str| e.g.factions.has(c) && e.g.factions.at(c).atb("alive");
                let (ga, gb) = (gains.at(0).i(), gains.at(1).i());
                let gagnant = match (vivant(a), vivant(b)) {
                    (true, false) => Some((a, b)),
                    (false, true) => Some((b, a)),
                    _ if ga > gb => Some((a, b)),
                    _ if gb > ga => Some((b, a)),
                    _ => None,
                };
                if let Some((w, l)) = gagnant {
                    ajoute(fam, w, 1.0, 0.0);
                    ajoute(fam, l, 0.0, 1.0);
                }
                guerres.del(&k);
            }
            memo.set("own", own.into_iter().collect::<Val>());
        } },
    Compteur { id: "detresse", titre: "Mois de banqueroute et de famine", a: "banqueroute", b: "famine", par_camp: true, ratio: false, connus: aucun,
        f: |e, _, fam| {
            for (c, f) in e.g.factions.items() {
                if f.atb("alive") {
                    ajoute(fam, c.string(), f.get("banqueroute").truthy() as i64 as f64, f.get("famine").truthy() as i64 as f64);
                }
            }
        } },
    // --- les nouveautés (SPEC-POLITIQUE) : rien tant que le moteur ne les sauvegarde pas
    Compteur { id: "agents", titre: "Agents recrutés et perdus (R7)", a: "recrutés", b: "perdus", par_camp: false, ratio: false,
        connus: aucun,
        f: |e, memo, fam| {
            let v = e.d.get("agents");
            if !v.is_dict() { return; }
            let (plus, moins) = nouveaux(memo, v.items().into_iter().map(|(k, a)| (k.string(), a)).collect());
            plus.iter().for_each(|a| ajoute(fam, a.get("type").to_string(), 1.0, 0.0));
            moins.iter().for_each(|a| ajoute(fam, a.get("type").to_string(), 0.0, 1.0));
        } },
    // une mission finie (l'agent n'en a plus) est comptée réussie si l'agent est toujours là (à affiner quand R7 dira
    // l'issue de ses missions)
    Compteur { id: "missions", titre: "Missions d'agents finies, et réussies (R7)", a: "finies", b: "agent revenu", par_camp: false, ratio: true, connus: aucun,
        f: |e, memo, fam| {
            let v = e.d.get("agents");
            if !v.is_dict() { return; }
            let maintenant = Val::dict(); // {agent: type de mission}
            for (k, a) in v.items() {
                let m = ch(&a, "mission.type");
                if m.is_str() { maintenant.set(&k, m); }
            }
            if memo.is_dict() {
                for (k, m) in memo.items() {
                    if !maintenant.has(&k) {
                        ajoute(fam, m.string(), 1.0, v.has(&k) as i64 as f64);
                    }
                }
            }
            *memo = maintenant;
        } },
    Compteur { id: "regimes", titre: "Changements de régime (R8)", a: "fois", b: "", par_camp: false, ratio: false, connus: aucun,
        f: |e, memo, fam| suivre_mot(e, memo, fam, "politique.regime", |a, b| format!("{a} → {b}")) },
    Compteur { id: "revolutions", titre: "Révolutions, selon le régime (R8)", a: "commencées", b: "", par_camp: false, ratio: false, connus: aucun,
        f: |e, memo, fam| {
            let maintenant = Val::dict();
            for (c, f) in e.g.factions.items() {
                if ch(&f, "politique.revolution").truthy() {
                    maintenant.set(&c, true);
                    if memo.is_dict() && !memo.has(&c) {
                        ajoute(fam, ch(&f, "politique.regime").to_string(), 1.0, 0.0);
                    }
                }
            }
            *memo = maintenant;
        } },
    Compteur { id: "ministres", titre: "Ministres nommés, par poste (R8)", a: "nominations", b: "", par_camp: false, ratio: false, connus: aucun,
        f: |e, memo, fam| {
            let maintenant = Val::dict(); // {"camp poste": ministre}
            for (c, f) in e.g.factions.items() {
                for (poste, m) in ch(&f, "politique.cabinet").items_ou_rien() {
                    let k = format!("{c} {poste}");
                    let qui = if m.is_dict() { m.get("nom").to_string() } else { m.to_string() };
                    if memo.is_dict() && memo.get(k.as_str()).to_string() != qui {
                        ajoute(fam, poste.string(), 1.0, 0.0);
                    }
                    maintenant.set(k.as_str(), qui);
                }
            }
            *memo = maintenant;
        } },
    // un camp qui naît en cours de partie : guerre civile (R8), indépendance d'un protectorat (R9)…
    Compteur { id: "nouveaux_camps", titre: "Camps nés en cours de partie (guerre civile, indépendance)", a: "nés", b: "", par_camp: false, ratio: false, connus: aucun,
        f: |e, memo, fam| {
            let (plus, _) = nouveaux(memo, e.g.factions.keys().into_iter().map(|c| (c.string(), c)).collect());
            plus.iter().for_each(|c| ajoute(fam, e.g.fname(c.s()), 1.0, 0.0));
        } },
    Compteur { id: "journal", titre: "Journal du camp suivi, par sorte d'événement", a: "événements", b: "", par_camp: false, ratio: false, connus: aucun,
        f: |e, memo, fam| journal_neuf(e, memo).iter().for_each(|ev| ajoute(fam, ev.ats("kind"), 1.0, 0.0)) },
];

/// Les traces de bataille pas encore vues (memo : les clés de celles du mois d'avant).
fn traces_neuves(e: &Etat, memo: &mut Val) -> Vec<Val> {
    let (plus, _) = nouveaux(memo, e.g.sites.iter().map(|s| (format!("{} {} {}", s.at("x"), s.at("y"), s.at("t")), s)).collect());
    // (le premier mois aussi : nouveaux ne rend rien tant que memo est vide ; il n'y a pas de bataille au départ)
    plus
}

/// Les événements du journal pas encore vus (memo : le dernier numéro lu).
fn journal_neuf(e: &Etat, memo: &mut Val) -> Vec<Val> {
    let premier = !memo.is_int();
    let vu = if premier { e.g.seq } else { memo.i() };
    *memo = Val::from(e.g.seq);
    e.g.events.iter().filter(|ev| ev.ati("seq") > vu).collect()
}

/// Un mot par camp suivi d'un mois à l'autre : chaque changement compte une fois, sous la clé nom(avant, après).
fn suivre_mot(e: &Etat, memo: &mut Val, fam: &mut Famille, chemin: &str, nom: fn(&str, &str) -> String) {
    let maintenant = Val::dict();
    for (c, f) in e.g.factions.items() {
        let v = ch(&f, chemin);
        if v.is_str() {
            if memo.is_dict() && memo.get(&c).is_str() && memo.get(&c) != v {
                ajoute(fam, nom(memo.get(&c).s(), v.s()), 1.0, 0.0);
            }
            maintenant.set(&c, v);
        }
    }
    *memo = maintenant;
}
