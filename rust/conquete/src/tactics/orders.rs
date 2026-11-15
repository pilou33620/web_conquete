//! Porte game/tactics/orders.py.
//!
//! `b` est la bataille : `&TacticalBattle` quand la fonction ne fait que lire, `&mut` quand elle écrit (ask, answer,
//! setup) ou passe par `b.r#trait(side)`, qui calcule les états-majors à la demande (scouting, report, advise).
//! `o` est le dict des ordres d'un camp (clés : celles de DEFAULTS, plus 'man'). `side` : 0 ou 1.
//!
//! « Donner mes ordres » : la bataille du joueur jouée par ses officiers selon ses ordres, puis montrée vue de dessus.
//!
//! Le joueur ne commande pas régiment par régiment : il choisit, avant la bataille, un objectif, une manœuvre, une aile,
//! un ordre pour chaque arme, la taille, la place et l'emploi de sa réserve, la conduite à tenir devant les imprévus, une
//! ruse, l'heure de l'attaque et une attitude. L'IA de combat (ai.py) mène alors son camp en suivant ces ordres
//! (spec['orders'][camp], lus par of()), et la bataille défile en accéléré sous ses yeux (bridge, mode « ordres »).
//!
//! - groups(b, side) : les choix proposés pour cette bataille (rase campagne ou place, attaque ou défense), chacun avec
//!   la raison qui le verrouille ('' s'il est permis : époque, général, terrain, cavalerie, livres) ;
//! - clean(b, side, raw) : des ordres valides (valeurs connues et permises, sinon celles par défaut) ;
//! - advise(b, side, o) : l'avis du général (points forts, risques, estimation) d'après ce qu'on sait de l'ennemi ;
//! - report(b, side) : ce que les éclaireurs disent de l'ennemi (général, plan probable, composition) ;
//! - tweak(b, side, L) : les réglages de l'IA (ai.LEVELS) que changent les ordres ; plan(b, side) : le plan de l'IA ;
//! - ask(b, side, key, text) : le moment décisif (« Me demander ») : la bataille s'arrête et attend la réponse.
//!
//! Effets de chaque ordre dans l'IA (ai.py, repérés par « ordres : ») :
//! - manœuvre : frontal, oblique (une aile forte, l'autre refusée 160 m en arrière ; avant 1789), percée au centre
//!   (préparation, point de rupture au centre, deux masses ; après 1789), enveloppement d'une aile (débordement par
//!   l'aile choisie), double enveloppement (débordement par l'aile choisie, la masse enveloppe l'autre), fixer et
//!   déborder (toute la cavalerie tourne l'ennemi, la ligne le fixe de loin), usure (escarmouche) ; en défense : tenir,
//!   tenir puis contre-attaquer, contre-pente (1789-1849), défense avancée, contre-offensive, usure ; devant une place :
//!   assaut à la brèche, pilonner d'abord, escalade sans attendre ; défendre la place, sorties, tenir les murs ;
//! - objectif : battre l'armée, la position clé (le point de rupture sur la hauteur ; en défense, on s'y accroche),
//!   couper la retraite (poursuite plus longue ; en défense : sauver l'armée, on décroche plus tôt), user ;
//! - armes : la marche de l'infanterie (ligne, colonne, ordre mixte, ordre dispersé), les légers (écran, bois, avec les
//!   colonnes), la cavalerie (aile, réserve, écran, raid sur les arrières), l'artillerie (contre-batterie, préparation,
//!   grande batterie, appui jusqu'au bout) ;
//! - réserve : aucune, un quart, un tiers ; derrière le centre ou l'aile ; engagée quand l'ennemi plie, gardée pour les
//!   trous, ou sur l'ordre du joueur (le moment décisif) ;
//! - imprévus : face aux cavaliers (carré, contre-charge, feu à bout portant), face à la réserve ennemie (la nôtre, les
//!   canons, presser l'assaut) ;
//! - ruse : feinte (une brigade attaque l'autre aile ; un général qui y croit y envoie sa réserve), marche par le bois
//!   (la colonne tournante passe sous les arbres), feux de camp (l'ennemi nous croit 50 % plus nombreux), faux
//!   déserteurs (60 livres : sa réserve et sa cavalerie se placent du mauvais côté), fausse retraite (les légers
//!   reculent, l'ennemi se découvre en contre-attaquant) ;
//! - heure : à l'aube (5 h 30 : l'ennemi surpris, moral −10 ; nos hommes fatigués +15), le matin, l'après-midi (12 h 30 :
//!   reposés −15, moins de jour) ; attitude : prudent (décroche 6 % plus tôt), équilibré, audacieux (6 % plus tard).

use crate::py::{self, Val};
use crate::tactics::battle::TacticalBattle;
use crate::tactics::terrain::{CELL, COLS, H, T_BOIS, T_FORET_T, W};
use crate::tactics::units as U;
use crate::{dict, list, py_const, tup};
use std::collections::HashMap;

/// `v in ('a', 'b')` (v : texte ou autre chose). (Aide hors du socle.)
fn dans(v: &Val, l: &[&str]) -> bool {
    v.is_str() && l.contains(&v.s())
}

/// `max(a, b)` de Python : a, sauf si b est plus grand (le type du gagnant est gardé). (Aide hors du socle.)
fn vmax(a: Val, b: Val) -> Val {
    if b > a { b } else { a }
}

pub const WOODS: [i64; 2] = [T_BOIS, T_FORET_T];
pub const FEINT_COST: i64 = 60; // faux déserteurs : l'agent et ses complices (livres)
// l'heure de départ (5 h 30, 12 h 30), au lieu de 8 h
pub const DAWN_OFF: f64 = -2.5 * 3600.0;
pub const NOON_OFF: f64 = 4.5 * 3600.0;
pub const WAIT_ASK: f64 = 900.0; // « Attendre » au moment décisif : la réserve part un quart d'heure plus tard
py_const!(MOOD_WD, dict!{
    "prudent" => -0.06,
    "equilibre" => 0.0,
    "audacieux" => 0.06,
});

// ------------------------------------------------------------------ les choix
// (chaque choix : tuple (valeur, libellé, description) ; OBJ, MAN, MAN_PLACE, INF : dict camp (0, 1) → liste)
py_const!(OBJ, dict!{
    0 => list![
        tup!["armee", "Battre son armée", "Tout pour la victoire : la poursuite décide de son ampleur."],
        tup!["cle", "Prendre la position clé", "Le point de rupture sur la hauteur ou le village : un but plus sûr, une armée ennemie moins entamée."],
        tup!["retraite", "Couper sa retraite", "La cavalerie poursuit plus loin et plus longtemps : une victoire peut devenir un désastre pour lui."],
        tup!["user", "L’user et se retirer", "Lui coûter des hommes sans risquer l’armée : on décroche plus tôt, jamais d’assaut général."],
    ],
    1 => list![
        tup!["armee", "Battre son armée", "Le repousser, puis le chasser du champ de bataille."],
        tup!["cle", "Tenir coûte que coûte", "On s’accroche à la position bien après les pertes ordinaires."],
        tup!["retraite", "Sauver l’armée", "Décrocher tôt et en ordre, couvert par une arrière-garde."],
        tup!["user", "Lui faire payer cher", "Salves à bonne portée, écran de tirailleurs, pas de retour offensif hasardeux."],
    ],
});
py_const!(MAN, dict!{
    0 => list![
        tup!["frontal", "Assaut frontal", "Toute la ligne avance ensemble. Simple, coûteux contre un ennemi à couvert."],
        tup!["oblique", "Ordre oblique", "Une aile forte attaque, l’autre est « refusée » et reste en arrière."],
        tup!["percee", "Percée au centre", "Longue préparation, grande batterie et colonnes sur un point du centre."],
        tup!["enveloppement", "Enveloppement d’une aile", "Le centre fixe l’ennemi, une aile le tourne et le prend de flanc."],
        tup!["double", "Double enveloppement", "Une aile tourne l’ennemi, la réserve enveloppe l’autre. Risqué."],
        tup!["fixer", "Fixer et déborder", "La ligne le fixe de loin par son feu, toute la cavalerie file sur ses arrières."],
        tup!["usure", "Usure", "Canons et tirailleurs à longue portée, sans assaut. On décroche le soir."],
    ],
    1 => list![
        tup!["tenir", "Tenir la position", "Défense ferme : on use l’assaillant, peu de contre-attaques."],
        tup!["elastique", "Tenir puis contre-attaquer", "On encaisse, puis on contre-attaque dès qu’il s’essouffle."],
        tup!["contrepente", "Contre-pente", "La ligne attend à l’abri derrière la crête, et monte sur la crête pour le recevoir."],
        tup!["avant", "Défense avancée", "La ligne se poste en avant de la position : on gagne du temps et du terrain, à découvert."],
        tup!["contre", "Contre-offensive", "On marche à l’ennemi au lieu de l’attendre."],
        tup!["usure", "Usure", "Escarmouche à longue portée, puis retraite."],
    ],
});
py_const!(MAN_PLACE, dict!{
    0 => list![
        tup!["breche", "Assaut à la brèche", "Canonnade sur le rempart, puis les colonnes à la brèche."],
        tup!["pilonner", "Pilonner d’abord", "Une préparation moitié plus longue : la brèche plus large, l’ennemi usé."],
        tup!["escalade", "Escalade sans attendre", "L’assaut part tôt, brèche ou non : vite fait, mais coûteux."],
    ],
    1 => list![
        tup!["place", "Défendre la place", "Brèches flanquées et retranchées, contre-attaques dans la brèche."],
        tup!["sorties", "Sorties contre les batteries", "Des sorties répétées contre les canons qui battent le mur."],
        tup!["murs", "Tenir les murs", "Pas de sortie : tout le monde aux remparts et dans les rues."],
    ],
});
py_const!(WING, list![
    tup!["gauche", "Aile gauche", "L’effort sur votre gauche (face à l’ennemi)."],
    tup!["droite", "Aile droite", "L’effort sur votre droite (face à l’ennemi)."],
]);
py_const!(INF, dict!{
    0 => list![
        tup!["colonne", "Colonnes", "Marchent vite en colonne, se déploient en ligne à portée. Le canon y fait des trous."],
        tup!["ligne", "Ligne", "Se déploie en ligne loin de l’ennemi : moins de pertes au canon, marche plus lente."],
        tup!["mixte", "Ordre mixte", "Un bataillon en ligne, l’autre en colonne : le feu et le choc."],
        tup!["dispersé", "Ordre dispersé", "Les bataillons avancent en tirailleurs : peu de pertes au feu, fragiles devant les cavaliers."],
    ],
    1 => list![
        tup!["ligne", "Ligne", "Feu de salve en ligne, de quoi recevoir une charge."],
        tup!["dispersé", "Ordre dispersé", "En tirailleurs derrière les couverts : peu de pertes, fragiles devant les cavaliers."],
        tup!["colonne", "Colonnes de réserve", "Des colonnes derrière la ligne : prêtes à contre-attaquer."],
    ],
});
py_const!(LEG, list![
    tup!["avant", "En écran devant", "Tirailleurs devant la ligne : ils usent l’ennemi et cachent vos mouvements."],
    tup!["bois", "Dans les couverts", "Postés dans les bois, les vignes ou les maisons de l’aile choisie."],
    tup!["colonnes", "Avec la ligne", "Restent tout près de la ligne et visent les officiers."],
]);
py_const!(CAV, list![
    tup!["ailes", "Sur les deux ailes", "Les escadrons aux deux ailes (davantage sur l’aile d’un débordement)."],
    tup!["aile", "Sur l’aile choisie", "Toute la cavalerie sur l’aile d’effort."],
    tup!["reserve", "En réserve", "Derrière le centre, prête à exploiter la percée et à poursuivre."],
    tup!["ecran", "En écran", "Couvre canons et infanterie contre les charges ; ne s’aventure pas."],
    tup!["raid", "Raid sur les arrières", "Tourne l’ennemi et vise ses chariots et ses canons."],
]);
py_const!(ART, list![
    tup!["libre", "Au choix des artilleurs", "Les canons tirent sur ce qui menace le plus, au point d’attaque d’abord."],
    tup!["contre", "Contre-batterie", "Fait d’abord taire les canons ennemis, puis tire sur l’infanterie."],
    tup!["prepa", "Préparation", "Une préparation moitié plus longue, sur le point d’attaque."],
    tup!["grande", "Grande batterie", "Toutes les pièces serrées sur un point : la brèche, mais un seul point."],
    tup!["appui", "Appui jusqu’au bout", "Les pièces suivent l’infanterie et tirent pendant l’assaut ; exposées."],
]);
py_const!(RES, list![
    tup!["aucune", "Aucune", "Tout le monde en ligne dès le matin."],
    tup!["quart", "Un quart", "Une brigade solide en arrière."],
    tup!["tiers", "Un tiers", "Une vraie masse de manœuvre, mais une ligne plus mince."],
]);
py_const!(RES_POS, list![
    tup!["centre", "Derrière le centre", "Peut aller partout, arrive partout un peu tard."],
    tup!["aile", "Derrière l’aile choisie", "Nourrit l’effort principal ; l’autre aile est seule."],
]);
py_const!(RES_WHEN, list![
    tup!["plie", "Quand l’ennemi plie", "Le général la lance dès que l’ennemi est ébranlé."],
    tup!["cede", "Pour boucher les trous", "Elle ne sert qu’à relever, combler et couvrir."],
    tup!["demande", "Me demander", "La bataille s’arrête au moment décisif : à vous de dire « maintenant »."],
]);
py_const!(VS_CAV, list![
    tup!["carre", "Former le carré", "Sûr contre les cavaliers ; l’infanterie s’arrête, et le canon la vise."],
    tup!["contre", "Contre-charger", "Notre cavalerie tombe sur la leur ; il faut qu’elle soit à portée."],
    tup!["feu", "Feu à bout portant", "La ligne tient et tire de près : le carré seulement au dernier moment."],
]);
py_const!(VS_RES, list![
    tup!["reserve", "Lui opposer la mienne", "Notre réserve va à sa rencontre."],
    tup!["canons", "Tourner les canons sur elle", "Ses colonnes hachées en approchant ; les canons lâchent leur cible."],
    tup!["presser", "Presser l’attaque", "Finir avant qu’elle arrive : assaut général dès qu’elle se montre."],
]);
py_const!(RUSE, list![
    tup!["aucune", "Aucune", "Le plan seul."],
    tup!["feinte", "Feinte", "Un bataillon attaque l’autre aile pour y attirer la réserve ennemie."],
    tup!["bois", "Marche par le bois", "La colonne tournante passe sous les arbres, cachée à la vue."],
    tup!["feux", "Feux de camp", "Mille feux la veille : l’ennemi vous croit bien plus nombreux et n’ose pas contre-attaquer."],
    tup!["deserteurs", "Faux déserteurs", format!("Ils annoncent l’attaque sur l’autre aile ({FEINT_COST} livres).")],
    tup!["retraite", "Fausse retraite", "Les tirailleurs reculent ; l’ennemi qui les suit se découvre."],
]);
py_const!(HOUR, list![
    tup!["aube", "À l’aube", "Surprise : ses avant-postes dorment ; vos hommes ont marché de nuit."],
    tup!["matin", "Le matin", "Une longue journée : le temps d’une poursuite."],
    tup!["midi", "L’après-midi", "Vos hommes sont reposés ; la nuit arrêtera la poursuite."],
]);
py_const!(MOOD, list![
    tup!["prudent", "Prudent", "Décroche tôt si ça tourne mal : on sauve l’armée."],
    tup!["equilibre", "Équilibré", "Insiste tant que le moral tient."],
    tup!["audacieux", "Audacieux", "Pousse jusqu’au bout : grandes victoires ou lourdes défaites."],
]);

// (par défaut, ce que ferait l'IA d'elle-même : un joueur qui ne touche à rien n'y gagne ni n'y perd)
py_const!(DEFAULTS, dict!{
    "obj" => "armee",
    "wing" => "droite",
    "inf" => "colonne",
    "leg" => "avant",
    "cav" => "ailes",
    "art" => "libre",
    "res" => "quart",
    "resPos" => "centre",
    "resWhen" => "plie",
    "vsCav" => "carre",
    "vsRes" => "reserve",
    "ruse" => "aucune",
    "hour" => "matin",
    "mood" => "equilibre",
});
py_const!(TABS, list![
    tup!["man", "Manœuvre"],
    tup!["armes", "Les armes"],
    tup!["res", "Réserve et imprévus"],
    tup!["ruse", "Ruse et heure"],
]);

// ------------------------------------------------------------------ lecture
/// Les ordres du joueur pour ce camp (None : bataille commandée ou jouée par l'IA seule).
///
/// Python (orders.py, l. 154-160) : `def of(b, side)`
/// Rend le dict des ordres (le même objet que `b.spec['orders'][side]`) ou None.
pub fn of(b: &TacticalBattle, side: i64) -> Val {
    let sp = &b.spec;
    let o = if sp.is_dict() { sp.get("orders") } else { Val::None };
    if (o.is_list() || o.is_tuple()) && o.len() == 2 && o.at(side).is_dict() {
        return o.at(side);
    }
    Val::None
}

/// Les ordres du camp d'en face (ses ruses touchent notre IA).
///
/// Python (orders.py, l. 163-165) : `def foe_orders(b, side)`
/// Rend un dict ou None.
pub fn foe_orders(b: &TacticalBattle, side: i64) -> Val {
    of(b, 1 - side)
}

/// Python (orders.py, l. 168-169) : `def wing_sign(o)`
/// o : dict des ordres. Rend -1 ou 1.
pub fn wing_sign(o: &Val) -> i64 {
    if o.get("wing") == "gauche" { -1 } else { 1 }
}

// ------------------------------------------------------------------ ce qu'on sait de la bataille
/// Python (orders.py, l. 173-174) : `def _units(b, side)`
/// Rend la liste des unités combattantes en vie du camp (dans l'ordre de b.units).
pub fn _units(b: &TacticalBattle, side: i64) -> Val {
    b.units.iter().filter(|u| u.ati("side") == side && dans(&u.at("cls"), &["inf", "cavalerie", "artillerie"]) && U::alive(u)).collect()
}

/// Python (orders.py, l. 177-178) : `def _men(us, cls=None)`
/// us : liste d'unités ; cls : classe (texte) ou None (défaut : toutes). `sum` → `py::sum` (0.0 si vide : le
/// Python rend l'int 0, sans effet ici).
pub fn _men(us: &Val, cls: &Val) -> f64 {
    py::sum(us.iter().filter(|u| cls.is_none() || u.at("cls") == *cls).map(|u| u.atf("men")))
}

/// Python (orders.py, l. 181-183) : `def era(b)`
/// Rend 0 (avant 1789), 1 ou 2 (1850 et après).
pub fn era(b: &TacticalBattle) -> i64 {
    let y = b.spec.get("year").or(1790).f();
    if y >= 1850.0 {
        2
    } else if y < 1789.0 {
        0
    } else {
        1
    }
}

/// Python (orders.py, l. 186-188) : `def general(b, side)`
/// Rend le dict `gen` du premier état-major du camp (vivant ou non), ou None.
pub fn general(b: &TacticalBattle, side: i64) -> Val {
    match b.units.iter().find(|u| u.ati("side") == side && u.at("cls") == "general" && u.atb("gen")) {
        Some(g) => g.at("gen"),
        None => Val::None,
    }
}

/// Des bois sur cette aile, entre les deux armées (part des cases boisées d'une bande de 300 à 900 m sur l'aile).
///
/// Python (orders.py, l. 191-204) : `def wood_on_wing(b, side, w)`
/// w : -1 (gauche) ou 1 (droite). `b.t[...]` → `b.map.t[...]`.
pub fn wood_on_wing(b: &TacticalBattle, side: i64, w: i64) -> bool {
    let z = b.ai_zone(side);
    let fd = b.front_dir(side);
    let (c, s) = (fd.cos(), fd.sin());
    let (cx, cy) = ((&z.at(0) + &z.at(2)).f() / 2.0, (&z.at(1) + &z.at(3)).f() / 2.0);
    let (mut n, mut k) = (0i64, 0i64);
    for dep in (200..1300).step_by(100) {
        for lat in (300..950).step_by(100) {
            let (dep, lat, w) = (dep as f64, lat as f64, w as f64);
            let (x, y) = (cx + c * dep - s * lat * w, cy + s * dep + c * lat * w);
            if 0.0 <= x && x < W as f64 && 0.0 <= y && y < H as f64 {
                n += 1;
                let cc = py::int(py::floordiv_f(y, CELL as f64)) * COLS + py::int(py::floordiv_f(x, CELL as f64));
                k += WOODS.contains(&(b.map.t[cc as usize] as i64)) as i64;
            }
        }
    }
    n > 0 && k as f64 / n as f64 >= 0.08
}

/// Python (orders.py, l. 207-210) : `def _fat(b, side)`
/// Fatigue moyenne du camp, pondérée par les effectifs.
pub fn _fat(b: &TacticalBattle, side: i64) -> f64 {
    let us = _units(b, side);
    let m = _men(&us, &Val::None);
    let m = if m != 0.0 { m } else { 1.0 };
    py::sum(us.iter().map(|u| u.atf("fat") * u.atf("men"))) / m
}

/// Les choix de cette bataille, par onglet : [{key, tab, title, opts: [{v, label, desc, why}]}].
///
/// Python (orders.py, l. 213-290) : `def groups(b, side, livres=None)`
/// livres : trésor du joueur (nombre) ou None (défaut : pas de limite). Rend une liste de dict
/// {key, tab, title, cards, opts: [{v, label, desc, why}]}. (`why` du Python : dict à clés tuples (key, v).)
pub fn groups(b: &TacticalBattle, side: i64, livres: &Val) -> Val {
    let pl = b.place_info();
    let us = _units(b, side);
    let men = _men(&us, &Val::None);
    let men = if men != 0.0 { men } else { 1.0 };
    let ncav = _men(&us, &Val::from("cavalerie")) / men;
    let nart = us.iter().filter(|u| u.at("cls") == "artillerie").count() as i64;
    let nline = us.iter().filter(|u| u.at("cls") == "inf" && !u.atb("light")).count() as i64;
    let nlight = us.iter().filter(|u| u.at("cls") == "inf" && u.atb("light")).count() as i64;
    let ep = era(b);
    let gen = general(b, side).or(Val::dict());
    let foe = _men(&_units(b, 1 - side), &Val::None);
    let foe = if foe != 0.0 { foe } else { 1.0 };
    let tech = b.spec.get("tech").or_else(|| list![Val::dict(), Val::dict()]).at(side).or(Val::dict());
    let mut why: HashMap<(String, String), String> = HashMap::new();
    let mut lock = |key: &str, v: &str, reason: &str| {
        if !reason.is_empty() {
            why.insert((key.to_string(), v.to_string()), reason.to_string());
        }
    };
    let man;
    if pl.truthy() {
        man = MAN_PLACE().at(side);
    } else {
        man = MAN().at(side);
        if side == 0 {
            lock("man", "oblique", if ep != 0 { "Manœuvre de la guerre en dentelles (avant 1789)" } else { "" });
            lock("man", "percee", if ep != 0 && nart != 0 {
                ""
            } else if ep != 0 {
                "Il faut des canons"
            } else {
                "Il faut l’artillerie de Gribeauval et les colonnes (après 1789)"
            });
            lock("man", "double", if gen.get_or("lvl", 1) >= 3 || men >= 1.4 * foe {
                ""
            } else {
                "Il faut un général de division, ou 1,4 fois plus d’hommes que l’ennemi"
            });
            lock("man", "fixer", if ncav >= 0.12 { "" } else { "Il faut plus de cavalerie (12 % de l’armée)" });
            lock("man", "enveloppement", if ncav > 0.0 || nlight != 0 { "" } else { "Ni cavaliers ni légers pour tourner l’ennemi" });
        } else {
            lock("man", "contrepente", if ep == 1 { "" } else { "La contre-pente est l’affaire des années 1789-1849" });
        }
    }
    lock("inf", "mixte", if tech.getb("colonne_charge") { "" } else { "Il faut la technologie « Ordre mixte »" });
    lock("inf", "dispersé", if ep != 0 { "" } else { "L’ordre dispersé de la ligne attend la Révolution" });
    lock("art", "grande", if ep != 0 { "" } else { "La grande batterie attend l’artillerie de Gribeauval (après 1789)" });
    let att = if side != 0 || pl.truthy() { "Une ruse de l’attaque" } else { "" };
    let bois = if !att.is_empty() {
        att
    } else if [-1, 1].iter().any(|&w| wood_on_wing(b, side, w)) {
        ""
    } else {
        "Pas de bois entre les deux armées"
    };
    lock("ruse", "bois", bois);
    lock("ruse", "feinte", if !att.is_empty() { att } else if nline >= 3 { "" } else { "Il faut au moins trois bataillons de ligne" });
    let cout = format!("Il faut {FEINT_COST} livres");
    lock("ruse", "deserteurs", if livres.is_none() || *livres >= FEINT_COST { "" } else { cout.as_str() });
    lock("ruse", "retraite", if nlight != 0 || ncav >= 0.25 || dans(&gen.get("trait"), &["eclaireur", "cavalier"]) {
        ""
    } else {
        "Il faut des légers, beaucoup de cavalerie, ou un général cavalier ou éclaireur"
    });
    lock("hour", "aube", if _fat(b, side) > 50.0 { "Vos hommes sont trop las pour marcher de nuit" } else { "" });
    if ncav == 0.0 {
        for o in CAV().iter() {
            lock("cav", o.at(0).s(), "Pas de cavalerie");
        }
    }
    if nart == 0 {
        for o in ART().iter() {
            lock("art", o.at(0).s(), "Pas de canons");
        }
    }
    if nlight == 0 {
        for o in LEG().iter() {
            lock("leg", o.at(0).s(), "Pas d’infanterie légère");
        }
    }
    let out = list![];
    let add = |key: &str, tab: &str, title: &str, opts: &Val| {
        let opts: Val = opts
            .iter()
            .map(|o| {
                let (v, l, d) = o.triple();
                let w = why.get(&(key.to_string(), v.string())).cloned().unwrap_or_default();
                dict! {"v" => v, "label" => l, "desc" => d, "why" => w}
            })
            .collect();
        out.push(dict! {"key" => key, "tab" => tab, "title" => title, "cards" => key == "man", "opts" => opts});
    };
    if !pl.truthy() {
        add("obj", "man", "Objectif de la journée", &OBJ().at(side));
    }
    add("man", "man", if !pl.truthy() { "La manœuvre" } else if side == 0 { "L’assaut" } else { "La défense" }, &man);
    if !pl.truthy() {
        add("wing", "man", if side == 0 { "Aile d’effort" } else { "Aile à renforcer" }, &WING());
    }
    let inf = py::int(_men(&us, &Val::from("inf")) - py::sum(us.iter().filter(|u| u.atb("light")).map(|u| u.atf("men"))));
    add("inf", "armes", &format!("Infanterie ({inf} h.)"), &INF().at(side));
    add("leg", "armes", &format!("Infanterie légère ({nlight} bataillon{})", if nlight > 1 { "s" } else { "" }), &LEG());
    add("cav", "armes", &format!("Cavalerie ({} h.)", py::int(_men(&us, &Val::from("cavalerie")))), &CAV());
    add("art", "armes", &format!("Artillerie ({nart} batterie{})", if nart > 1 { "s" } else { "" }), &ART());
    add("res", "res", "Taille de la réserve", &RES());
    if !pl.truthy() {
        add("resPos", "res", "Où la placer", &RES_POS());
    }
    add("resWhen", "res", "Quand l’engager", &RES_WHEN());
    add("vsCav", "res", "Si sa cavalerie charge", &VS_CAV());
    add("vsRes", "res", "Si sa réserve se montre", &VS_RES());
    add("ruse", "ruse", "Une ruse", &RUSE());
    add("hour", "ruse", if side == 0 { "Heure de l’attaque" } else { "Heure de la bataille" }, &HOUR());
    add("mood", "ruse", "Attitude", &MOOD());
    out
}

/// Python (orders.py, l. 293-300) : `def defaults(b, side, gs=None)`
/// gs : la liste rendue par groups, ou None (défaut : `groups(b, side, &Val::None)`). Rend un dict clé → valeur.
pub fn defaults(b: &TacticalBattle, side: i64, gs: &Val) -> Val {
    let gs = gs.or_else(|| groups(b, side, &Val::None));
    let o = Val::dict();
    for g in gs.iter() {
        let opts: Val = g.at("opts").iter().filter(|x| !x.atb("why")).map(|x| x.at("v")).collect();
        let opts = opts.or_else(|| list![g.at("opts").at(0).at("v")]);
        let want = DEFAULTS().get(g.at("key")); // (la manœuvre : la première permise, l'assaut frontal ou tenir)
        o.set(g.at("key"), if opts.has(&want) { want } else { opts.at(0) });
    }
    o
}

/// Des ordres valides : chaque clé connue, chaque valeur proposée et permise, sinon celle par défaut.
///
/// Python (orders.py, l. 303-313) : `def clean(b, side, raw, livres=None)`
/// raw : ce qu'envoie le client (n'importe quelle valeur : autre chose qu'un dict vaut {}) ; livres : comme
/// groups (défaut None). Rend un dict neuf clé → valeur (le set `ok` du Python ne sert qu'à des tests
/// d'appartenance).
pub fn clean(b: &TacticalBattle, side: i64, raw: &Val, livres: &Val) -> Val {
    let gs = groups(b, side, livres);
    let d = defaults(b, side, &gs);
    let raw = if raw.is_dict() { raw.clone() } else { Val::dict() };
    let o = Val::dict();
    for g in gs.iter() {
        let v = raw.get(g.at("key"));
        let ok: Vec<Val> = g.at("opts").iter().filter(|x| !x.atb("why")).map(|x| x.at("v")).collect();
        o.set(g.at("key"), if v.is_str() && ok.contains(&v) { v } else { d.at(g.at("key")) });
    }
    o
}

// ------------------------------------------------------------------ ce que disent les éclaireurs, l'avis du général
py_const!(PLAN_TXT, dict!{
    "frontal" => "attaquer de front",
    "artillerie" => "préparer son attaque au canon",
    "debordement" => "nous déborder par une aile",
    "tenir" => "tenir sa position",
    "harcelement" => "escarmoucher, puis se retirer",
    "assaut" => "donner l’assaut à la place",
    "place" => "défendre la place",
});

/// Qualité du renseignement : légers et cavaliers, général éclaireur.
///
/// Python (orders.py, l. 322-329) : `def scouting(b, side)`
pub fn scouting(b: &mut TacticalBattle, side: i64) -> f64 {
    let us = _units(b, side);
    let n = if us.len() > 0 { us.len() } else { 1 };
    let mut k = us.iter().filter(|u| u.at("cls") == "cavalerie" || u.atb("light")).count() as f64 / n as f64;
    if b.r#trait(side) == "eclaireur" {
        k += 0.15;
    }
    k
}

/// Ce que les éclaireurs disent de l'ennemi (pour la fenêtre des ordres).
///
/// Python (orders.py, l. 332-344) : `def report(b, side)`
/// Rend un dict {gen: dict ou None, plan: texte ou None, sure: texte ou None, mix: {inf, cav, art}, men}.
pub fn report(b: &mut TacticalBattle, side: i64) -> Val {
    let foe = _units(b, 1 - side);
    let g = general(b, 1 - side);
    let mem = b.ai_mem.or(Val::dict()).get(format!("s{}", 1 - side)).or(Val::dict());
    let k = scouting(b, side);
    let plan = mem.get("plan");
    let sure = if k >= 0.3 { Val::from("sûr") } else if k >= 0.15 { Val::from("assez sûr") } else { Val::None };
    let mix = dict! {"inf" => py::int(_men(&foe, &Val::from("inf"))), "cav" => py::int(_men(&foe, &Val::from("cavalerie"))),
        "art" => foe.iter().filter(|u| u.at("cls") == "artillerie").count()};
    dict! {
        "gen" => if g.truthy() { dict! {"name" => g.get("name"), "trait" => g.get("trait"), "rank" => g.get("rank")} } else { Val::None },
        "plan" => if sure.truthy() && plan.truthy() { PLAN_TXT().get(&plan) } else { Val::None },
        "sure" => sure,
        "mix" => mix,
        "men" => py::int(_men(&foe, &Val::None)),
    }
}

/// L'avis du général : points forts, risques, estimation (favorable, incertaine, risquée).
///
/// Python (orders.py, l. 347-457) : `def advise(b, side, o)`
/// o : dict des ordres (peut être {}). Rend un dict {pros: liste, cons: liste, verdict: texte}.
pub fn advise(b: &mut TacticalBattle, side: i64, o: &Val) -> Val {
    let (mut pp, mut cc): (Vec<&str>, Vec<&str>) = (vec![], vec![]);
    let pl = b.place_info();
    let (us, foe) = (_units(b, side), _units(b, 1 - side));
    let (men, fmen) = (_men(&us, &Val::None), _men(&foe, &Val::None));
    let (men, fmen) = (if men != 0.0 { men } else { 1.0 }, if fmen != 0.0 { fmen } else { 1.0 });
    let ratio = men / fmen;
    let e_cav = _men(&foe, &Val::from("cavalerie")) / fmen;
    let my_cav = _men(&us, &Val::from("cavalerie"));
    let e_art = foe.iter().filter(|u| u.at("cls") == "artillerie").count() as i64;
    let my_art = us.iter().filter(|u| u.at("cls") == "artillerie").count() as i64;
    let tr = b.r#trait(1 - side);
    let mem = b.ai_mem.or(Val::dict()).get(format!("s{}", 1 - side)).or(Val::dict());
    let e_plan = mem.get("plan");
    let cover = py::sum(foe.iter().map(|u| b.cover_at(u.atf("x"), u.atf("y")) * u.atf("men"))) / fmen;
    let m = o.get("man");
    let att = side == 0;
    if ratio >= 1.4 {
        pp.push("Vous êtes nettement plus nombreux.");
    } else if ratio < 0.8 && att && m != "usure" {
        cc.push("Vous êtes moins nombreux que lui : l’attaque est risquée.");
    }
    if !pl.truthy() && att {
        if m == "frontal" && cover > 0.15 {
            cc.push("Il est à couvert : un assaut de front coûtera cher.");
        }
        if dans(&m, &["enveloppement", "double", "fixer"]) {
            if e_cav >= 0.18 && e_cav * fmen > my_cav * 0.8 {
                cc.push("Sa cavalerie peut arrêter votre mouvement tournant.");
            } else {
                pp.push("Sa cavalerie est trop faible pour arrêter votre mouvement tournant.");
            }
        }
        if m == "double" && ratio < 1.4 {
            cc.push("Le double enveloppement amincit votre centre : il faudrait bien plus d’hommes.");
        }
        if m == "percee" {
            let fort = my_art as f64 >= 1.3 * 1.max(e_art) as f64;
            (if fort { &mut pp } else { &mut cc }).push(if fort {
                "Vos canons dominent les siens : la ligne s’ouvrira."
            } else {
                "Vos canons ne dominent pas les siens : la percée sera chère."
            });
        }
        if m == "oblique" {
            pp.push("Votre aile forte n’affronte qu’une partie de sa ligne.");
        }
        if m == "usure" && e_plan == "tenir" {
            cc.push("Il compte tenir : l’usure risque de finir sans vainqueur.");
        }
        if e_plan == "tenir" && dans(&m, &["enveloppement", "fixer", "double"]) {
            pp.push("Il attend sur place : il ne verra venir le mouvement tournant qu’au dernier moment.");
        }
    }
    if !pl.truthy() && !att {
        if m == "avant" && e_art > my_art {
            cc.push("En avant de la position, vos lignes s’offrent à ses canons, plus nombreux.");
        }
        if m == "contrepente" {
            pp.push("Derrière la crête, ses boulets passent au-dessus de vos lignes.");
        }
        if m == "contre" && ratio < 1.2 {
            cc.push("Une contre-offensive sans supériorité vous fait perdre l’avantage du terrain.");
        }
        if m == "elastique" {
            pp.push("Il s’usera contre votre ligne avant votre contre-attaque.");
        }
        if e_plan == "debordement" && dans(&o.get("cav"), &["aile", "ecran"]) {
            pp.push("Vos cavaliers sur l’aile attendront son mouvement tournant.");
        }
    }
    if o.get("art") == "contre" {
        if e_art >= 2 {
            pp.push("Faire taire ses canons d’abord protégera votre infanterie.");
        } else if e_art == 0 {
            cc.push("Il n’a pas de canons : la contre-batterie ne sert à rien.");
        }
    }
    if o.get("inf") == "colonne" && att && e_art > my_art && o.get("art") != "contre" {
        cc.push("Ses canons, plus nombreux, feront des trous dans vos colonnes.");
    }
    if o.get("inf") == "dispersé" && e_cav >= 0.15 {
        cc.push("L’ordre dispersé ne tient pas une charge : il a de la cavalerie.");
    }
    if o.get("vsCav") == "feu" && e_cav >= 0.2 {
        cc.push("Contre tant de cavaliers, le feu à bout portant demande de vieux soldats.");
    }
    if o.get("vsCav") == "contre" && o.get("cav") == "raid" {
        cc.push("Votre cavalerie est partie en raid : personne pour contre-charger.");
    }
    if o.get("vsCav") == "carre" && e_cav < 0.05 {
        pp.push("Il n’a presque pas de cavaliers : le carré ne vous retardera guère.");
    }
    if o.get("cav") == "raid" && my_cav != 0.0 {
        if e_cav * fmen > my_cav {
            cc.push("Ses cavaliers sont plus nombreux : le raid risque d’être coupé.");
        } else {
            pp.push("Ses chariots de munitions menacés : sa ligne tirera moins l’après-midi.");
        }
    }
    if o.get("res") == "aucune" {
        cc.push("Aucune réserve : rien pour exploiter une percée ni parer une surprise.");
    }
    if o.get("res") == "tiers" && m == "frontal" {
        cc.push("Avec un tiers en réserve, votre ligne est mince pour un assaut de front.");
    }
    if o.get("resWhen") == "demande" {
        pp.push("Vous choisirez vous-même le moment décisif.");
    }
    if o.get("vsRes") == "reserve" && o.get("res") == "aucune" {
        cc.push("Pas de réserve à opposer à la sienne.");
    }
    let r = o.get("ruse");
    if r == "feinte" {
        if tr == "eclaireur" {
            cc.push("Son général est un éclaireur : il risque de flairer la feinte.");
        } else {
            pp.push(if tr != "prudent" { "Son général mordra probablement à la feinte." } else { "Un général prudent mordra à la feinte." });
        }
    } else if r == "feux" {
        pp.push("Il vous croira bien plus nombreux : il n’osera guère contre-attaquer.");
    } else if r == "bois" {
        pp.push("Le bois cachera la marche de votre colonne.");
    } else if r == "deserteurs" {
        pp.push("Sa réserve et ses cavaliers attendront l’attaque du mauvais côté.");
    } else if r == "retraite" {
        pp.push("Ses bataillons qui poursuivront vos tirailleurs se découvriront.");
    }
    if o.get("hour") == "aube" {
        pp.push("Surprise : ses avant-postes dorment encore.");
        cc.push("Vos hommes ont marché de nuit : fatigués dès midi.");
    } else if o.get("hour") == "midi" {
        cc.push("La nuit tombera tôt : pas de longue poursuite.");
    }
    if o.get("mood") == "audacieux" && ratio < 1.0 {
        cc.push("Audace en infériorité : une défaite peut tourner au désastre.");
    }
    if o.get("mood") == "prudent" && o.get("obj") == "cle" {
        cc.push("Prudence et position à tenir coûte que coûte se contredisent.");
    }
    if o.get("obj") == "retraite" && att && !dans(&o.get("cav"), &["raid", "reserve"]) && !dans(&m, &["fixer"]) {
        cc.push("Pour couper sa retraite, gardez la cavalerie en réserve ou lancez-la sur ses arrières.");
    }
    if o.get("obj") == "user" && att && !dans(&m, &["usure", "fixer"]) {
        cc.push("Pour l’user sans risque, une manœuvre d’usure convient mieux.");
    }
    let score = pp.len() as i64 - cc.len() as i64;
    let verdict = if score >= 2 {
        "favorable"
    } else if score <= -2 {
        "risquée"
    } else {
        "incertaine"
    };
    let liste = |v: &[&str]| -> Val { v.iter().take(5).map(|s| Val::from(*s)).collect() };
    dict! {"pros" => liste(&pp), "cons" => liste(&cc), "verdict" => verdict}
}

// ------------------------------------------------------------------ les flèches de la manœuvre, au sol
/// Les flèches de la manœuvre sur la carte de bataille (fenêtre des ordres), tirées du déploiement de l'IA du joueur
/// (ai_mem : l'ancre de sa ligne, son front, sa largeur) et du centre de la zone ennemie (connue du joueur) :
/// [{pts: [[x, y], …], k}], k : 'main' (l'effort), 'fix' (fixer, user), 'feint', 'raid' (la cavalerie), 'hidden'
/// (sous les bois), 'counter' (contre-attaque), 'fire' (le tir des canons). Le client lisse les tracés.
///
/// Python (orders.py, l. 461-534) : `def arrows(b, side, o)`
/// o : dict des ordres ({} ou None : rien). Rend une liste de dict {k, pts}.
pub fn arrows(b: &TacticalBattle, side: i64, o: &Val) -> Val {
    let mem = b.ai_mem.or(Val::dict()).get(format!("s{side}")).or(Val::dict());
    let out = list![];
    if !mem.has("ax") || !o.truthy() {
        return out;
    }
    let (ax, ay, fd, w2) = (mem.atf("ax"), mem.atf("ay"), mem.atf("fd"), mem.get_or("width", 600).f() / 2.0);
    let (c, s) = (fd.cos(), fd.sin());
    let borne = |v: f64, hi: i64| -> i64 {
        let v = if v > 20.0 { v } else { 20.0 };
        py::round(if v < hi as f64 { v } else { hi as f64 })
    };
    let at = |dep: f64, lat: f64| -> Val { list![borne(ax + c * dep - s * lat, W - 20), borne(ay + s * dep + c * lat, H - 20)] };
    let ez = b.ai_zone(1 - side);
    let v = ((&ez.at(0) + &ez.at(2)).f() / 2.0 - ax) * c + ((&ez.at(1) + &ez.at(3)).f() / 2.0 - ay) * s - 150.0;
    let v = if v < 1600.0 { v } else { 1600.0 };
    let dd = if v > 300.0 { v } else { 300.0 };
    let (w, m) = (wing_sign(o), o.get("man"));
    let wf = w as f64;
    let add = |k: &str, pts: &[Val]| {
        out.push(dict! {"k" => k, "pts" => pts.iter().map(|p| p.to_list()).collect::<Val>()});
    };
    let pl = b.place_info();
    if pl.truthy() {
        let (hx, hy) = b.objective().or_else(|| tup![pl.at("x"), pl.at("y")]).xy();
        if side == 0 {
            add("main", &[at(0.0, 0.0), list![py::round(hx), py::round(hy)]]);
        } else if m == "sorties" {
            add("counter", &[list![py::round(hx), py::round(hy)], at(-400.0, 0.0)]);
        }
        return out;
    }
    let wide = [-0.6 * w2, 0.0, 0.6 * w2];
    if side == 0 {
        if m == "frontal" {
            for lat in wide {
                add("main", &[at(0.0, lat), at(dd, lat)]);
            }
        } else if m == "oblique" {
            add("main", &[at(0.0, wf * 0.6 * w2), at(dd, wf * 0.8 * w2)]);
            add("fix", &[at(0.0, 0.0), at(0.6 * dd, 0.0)]);
            add("fix", &[at(-160.0, -wf * 0.6 * w2), at(-40.0, -wf * 0.6 * w2)]);
        } else if m == "percee" {
            add("main", &[at(0.0, 0.0), at(dd, 0.0)]);
            for lat in [-0.7 * w2, 0.7 * w2] {
                add("fix", &[at(0.0, lat), at(0.55 * dd, lat)]);
            }
        } else if dans(&m, &["enveloppement", "double"]) {
            let wws: Vec<i64> = if m == "double" { vec![w, -w] } else { vec![w] };
            for ww in wws {
                let wood = if ww == w { mem.get_or("ord", Val::dict()).get("wood") } else { Val::None };
                let wwf = ww as f64;
                let mid = wood.or_else(|| at(0.45 * dd, wwf * (w2 + 450.0)));
                add(if wood.truthy() { "hidden" } else { "main" },
                    &[at(0.0, wwf * w2), mid, at(0.9 * dd, wwf * (w2 + 380.0)), at(dd, wwf * (w2 + 80.0))]);
            }
            add("fix", &[at(0.0, 0.0), at(0.55 * dd, 0.0)]);
        } else if m == "fixer" {
            for lat in wide {
                add("fix", &[at(0.0, lat), at(0.55 * dd, lat)]);
            }
            add("raid", &[at(-50.0, wf * (w2 + 150.0)), at(0.5 * dd, wf * (w2 + 650.0)), at(dd + 300.0, wf * (w2 + 420.0)), at(dd + 450.0, 0.0)]);
        } else if m == "usure" {
            for lat in wide {
                add("fix", &[at(0.0, lat), at(0.5 * dd, lat)]);
            }
        }
        if o.get("ruse") == "feinte" {
            add("feint", &[at(0.0, -wf * 0.75 * w2), at(0.85 * dd, -wf * 0.85 * w2)]);
        }
    } else if m == "contre" {
        for lat in wide {
            add("main", &[at(0.0, lat), at(dd, lat)]);
        }
    } else if m == "elastique" {
        add("counter", &[at(-200.0, wf * 0.3 * w2), at(250.0, wf * 0.3 * w2)]);
    } else if m == "usure" {
        add("fix", &[at(0.0, 0.0), at(-500.0, 0.0)]);
    }
    if o.get("cav") == "raid" && m != "fixer" {
        add("raid", &[at(-70.0, wf * (w2 + 110.0)), at(0.5 * dd, wf * (w2 + 600.0)), at(dd + 350.0, wf * (w2 + 300.0))]);
    }
    if dans(&o.get("art"), &["grande", "prepa"]) || m == "percee" {
        let lat = if m == "oblique" { wf * 0.7 * w2 } else { 0.0 };
        for u in b.units.iter() {
            if u.ati("side") == side && u.at("cls") == "artillerie" && U::alive(&u) {
                add("fire", &[list![py::round(u.atf("x")), py::round(u.atf("y"))], at(dd, lat)]);
            }
        }
    }
    out
}

// ------------------------------------------------------------------ ce que font les ordres dans l'IA
/// Le plan de l'IA dicté par la manœuvre (None : l'IA choisit).
///
/// Python (orders.py, l. 538-550) : `def plan(b, side, pl)`
/// pl : `b.place_info()` (dict ou None ; seule sa véracité compte). Rend un texte ou None.
pub fn plan(b: &TacticalBattle, side: i64, pl: &Val) -> Val {
    let o = of(b, side);
    if !o.truthy() {
        return Val::None;
    }
    if pl.truthy() {
        return Val::from(if side == 0 { "assaut" } else { "place" });
    }
    let m = o.get("man");
    let table = if side == 0 {
        dict! {"frontal" => "frontal", "oblique" => "frontal", "percee" => "artillerie", "enveloppement" => "debordement",
            "double" => "debordement", "fixer" => "debordement", "usure" => "harcelement"}
    } else {
        dict! {"tenir" => "tenir", "elastique" => "tenir", "contrepente" => "tenir", "avant" => "tenir", "contre" => "frontal",
            "usure" => "harcelement"}
    };
    table.get(&m)
}

/// Les réglages de l'IA (ai.LEVELS) que changent les ordres de ce camp, et les ruses du camp d'en face.
///
/// Python (orders.py, l. 553-636) : `def tweak(b, side, L)`
/// L : dict des réglages (ai.LEVELS[niveau]). Rend L lui-même si aucun ordre ne joue, sinon une COPIE modifiée
/// (`dict(L)` → `L.copy()`).
pub fn tweak(b: &TacticalBattle, side: i64, L: &Val) -> Val {
    let o = of(b, side);
    let f = foe_orders(b, side);
    if !o.truthy() && !f.truthy() {
        return L.clone();
    }
    let L = L.copy();
    if o.truthy() {
        let m = o.get("man");
        L.set("wd_loss", &L.at("wd_loss") + &MOOD_WD().get_or(&o.get("mood"), 0.0));
        if o.get("mood") == "audacieux" {
            L.set("ten_k", L.get_or("ten_k", 1.0) * 1.3);
        }
        let obj = o.get("obj");
        if obj == "cle" && side == 1 {
            L.inc("wd_loss", 0.06);
        } else if obj == "retraite" {
            if side == 0 {
                L.set("pursue_r", vmax(L.at("pursue_r"), Val::from(600.0)) * 1.8);
                L.set("exploit_k", L.at("exploit_k") * 1.4);
            } else {
                L.dec("wd_loss", 0.06);
                L.set("rg", true);
            }
        } else if obj == "user" {
            if side == 0 {
                L.dec("wd_loss", 0.04);
            } else {
                L.set("volley_def", true);
                L.set("screen", 1);
                L.set("ro_k", 99.0);
            }
        }
        if m == "percee" {
            L.set("masse_n", vmax(Val::from(2), L.at("masse_n")));
            L.set("rupture", true);
            L.set("prep", L.at("prep") * 1.3);
        } else if m == "frontal" {
            L.set("prep", L.at("prep") * 0.7);
        } else if m == "tenir" {
            L.set("ro_k", 99.0);
        } else if m == "elastique" {
            L.set("ro_k", 0.6);
            L.set("ro_ebb", L.at("ro_ebb") * 0.6);
            L.set("counter_k", L.at("counter_k") * 0.75);
        } else if m == "contrepente" {
            L.set("cp", 1);
        } else if m == "sorties" {
            L.set("sortie", vmax(Val::from(2), L.at("sortie") + 1));
        } else if m == "murs" {
            L.set("sortie", 0);
            L.set("coupure", 1);
        } else if m == "pilonner" {
            L.set("assault_prep", L.at("assault_prep") * 1.5);
        } else if m == "escalade" {
            L.set("assault_prep", L.at("assault_prep") * 0.5);
        }
        if o.get("art") == "grande" {
            L.set("pt_k", vmax(L.at("pt_k"), Val::from(1.6)) * 1.5);
        } else if o.get("art") == "prepa" {
            L.set("prep", L.at("prep") * 1.5);
            L.set("prep_max", L.at("prep_max") * 1.4);
            L.set("pt_k", vmax(L.at("pt_k"), Val::from(1.6)) * 1.2);
        }
        let rw = o.get("resWhen");
        if rw == "cede" {
            L.set("masse_n", 0);
            L.set("res_ca", true);
        }
        let vc = o.get("vsCav");
        if vc == "feu" {
            L.set("sq_r", 120.0);
        } else if vc == "contre" {
            L.set("counter", true);
            L.set("cav_opp", true);
        }
        if o.get("cav") == "ecran" {
            L.set("cav_r", L.at("cav_r") * 0.7);
        } else if o.get("cav") == "raid" {
            L.set("cav_r", L.at("cav_r") * 1.4);
        }
        if o.get("leg") == "avant" && side == 1 {
            L.set("screen", 1);
        } else if o.get("leg") == "colonnes" {
            L.set("screen", 0);
        }
    }
    if f.truthy() {
        if f.get("ruse") == "retraite" {
            L.set("ca_thr", L.at("ca_thr") * 0.7); // (ses tirailleurs reculent : nos bataillons les suivent trop volontiers)
            L.set("ca_reach", L.at("ca_reach") * 1.3);
        }
        if f.get("ruse") == "feux" {
            L.set("counter_k", L.at("counter_k") * 1.5);
            L.set("ro_k", L.at("ro_k") * 1.5);
        }
    }
    L
}

/// Feux de camp : l'ennemi croit le camp d'en face 50 % plus nombreux.
///
/// Python (orders.py, l. 639-642) : `def announced_k(b, side)`
pub fn announced_k(b: &TacticalBattle, side: i64) -> f64 {
    let f = foe_orders(b, side);
    if f.truthy() && f.get("ruse") == "feux" { 1.5 } else { 1.0 }
}

/// Bataillons de réserve d'infanterie selon les ordres (n : bataillons de ligne).
///
/// Python (orders.py, l. 645-654) : `def res_count(o, n, default)`
/// o : dict des ordres ou None ; n : bataillons de ligne ; default : ce que l'IA aurait gardé. `round(n / 3)` →
/// `py::round(n as f64 / 3.0)`.
pub fn res_count(o: &Val, n: i64, default: i64) -> i64 {
    let r = o.or(Val::dict()).get("res");
    if r == "aucune" {
        return 0;
    }
    if r == "tiers" {
        return if n >= 3 { 1.max(py::round(n as f64 / 3.0)) } else { default };
    }
    if r == "quart" {
        return if n >= 3 { 1.max(py::round(n as f64 / 4.0)) } else { default };
    }
    default
}

/// Le moment décisif, si le joueur a demandé qu'on l'appelle : 'go' (on y va), 'wait' (pas encore) ou None (la
/// question est posée : la bataille attend sa réponse).
///
/// Python (orders.py, l. 657-675) : `def ask(b, side, key, text)`
/// Rend 'go', 'wait' ou None (`ask(...) == "go"`). Pose `b.ask` (dict {side, key, text, t}) et lit / écrit
/// `b.ai_mem['s<side>']['asked'][key]` = [réponse, heure].
pub fn ask(b: &mut TacticalBattle, side: i64, key: &str, text: &str) -> Val {
    let o = of(b, side);
    if !o.truthy() || o.get("resWhen") != "demande" || b.replay.is_none() {
        return Val::from("go");
    }
    let mem = b.ai_mem.setdefault(format!("s{side}"), Val::dict());
    let asked = mem.setdefault("asked", Val::dict());
    let a = asked.get(key);
    if a.truthy() {
        if a.at(0) == "go" || b.clock - a.at(1).f() >= WAIT_ASK {
            return Val::from("go");
        }
        return Val::from("wait");
    }
    if b.replay.getb("skip") {
        asked.set(key, list!["go", py::round(b.clock)]);
        return Val::from("go");
    }
    if !b.ask.truthy() {
        b.ask = dict! {"side" => side, "key" => key, "text" => text, "t" => py::round(b.clock)};
    }
    Val::None
}

/// La réponse du joueur au moment décisif ('go' ou 'wait').
///
/// Python (orders.py, l. 678-686) : `def answer(b, choice)`
pub fn answer(b: &mut TacticalBattle, choice: &str) -> bool {
    let q = b.ask.clone();
    if !q.truthy() {
        return false;
    }
    let mem = b.ai_mem.setdefault(format!("s{}", q.at("side")), Val::dict());
    mem.setdefault("asked", Val::dict()).set(q.at("key"), list![if choice == "go" { "go" } else { "wait" }, py::round(b.clock)]);
    b.ask = Val::None;
    true
}

/// Au départ de la bataille : l'heure (et ce qu'elle fait aux hommes : spec['h_off'], le crépuscule).
///
/// Python (orders.py, l. 689-706) : `def setup(b, side, o)`
/// o : dict des ordres. Change `b.dusk`, `b.spec['h_off']`, `b.light`, le moral et la fatigue des unités.
pub fn setup(b: &mut TacticalBattle, side: i64, o: &Val) {
    let h = o.get("hour");
    let off = if h == "aube" { DAWN_OFF } else if h == "midi" { NOON_OFF } else { 0.0 };
    b.dusk += b.spec.get_or("h_off", 0.0).f() - off;
    b.spec.set("h_off", off);
    let combat = |u: &Val| dans(&u.at("cls"), &["inf", "cavalerie", "artillerie"]);
    if h == "aube" {
        for u in b.units.iter() {
            if u.ati("side") == 1 - side && combat(&u) {
                let m = u.atf("morale") - 10.0;
                u.set("morale", if m > 20.0 { m } else { 20.0 }); // (surpris au réveil)
            } else if u.ati("side") == side && combat(&u) {
                let f = u.atf("fat") + 15.0;
                u.set("fat", if f < 100.0 { f } else { 100.0 });
            }
        }
    } else if h == "midi" {
        for u in b.units.iter() {
            if u.ati("side") == side && combat(&u) {
                let f = u.atf("fat") - 15.0;
                u.set("fat", if f > 0.0 { f } else { 0.0 });
            }
        }
    }
    let left = b.dusk - b.clock;
    b.light = if left > 3600.0 {
        1.0
    } else {
        let v = 0.15 + 0.85 * left / 3600.0;
        if v > 0.15 { v } else { 0.15 }
    };
}
