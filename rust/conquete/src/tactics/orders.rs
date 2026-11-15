//! Porte game/tactics/orders.py (SQUELETTE : les constantes sont portées, les corps sont à écrire).
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
#![allow(unused_variables, unused_imports)] // (squelette : à retirer une fois les corps écrits)

use crate::py::{self, Val};
use crate::tactics::battle::TacticalBattle;
use crate::tactics::terrain::{CELL, COLS, H, T_BOIS, T_FORET_T, W};
use crate::tactics::units as U;
use crate::{dict, list, py_const, tup};

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
    todo!()
}

/// Les ordres du camp d'en face (ses ruses touchent notre IA).
///
/// Python (orders.py, l. 163-165) : `def foe_orders(b, side)`
/// Rend un dict ou None.
pub fn foe_orders(b: &TacticalBattle, side: i64) -> Val {
    todo!()
}

/// Python (orders.py, l. 168-169) : `def wing_sign(o)`
/// o : dict des ordres. Rend -1 ou 1.
pub fn wing_sign(o: &Val) -> i64 {
    todo!()
}

// ------------------------------------------------------------------ ce qu'on sait de la bataille
/// Python (orders.py, l. 173-174) : `def _units(b, side)`
/// Rend la liste des unités combattantes en vie du camp (dans l'ordre de b.units).
pub fn _units(b: &TacticalBattle, side: i64) -> Val {
    todo!()
}

/// Python (orders.py, l. 177-178) : `def _men(us, cls=None)`
/// us : liste d'unités ; cls : classe (texte) ou None (défaut : toutes). `sum` → `py::sum` (0.0 si vide : le
/// Python rend l'int 0, sans effet ici).
pub fn _men(us: &Val, cls: &Val) -> f64 {
    todo!()
}

/// Python (orders.py, l. 181-183) : `def era(b)`
/// Rend 0 (avant 1789), 1 ou 2 (1850 et après).
pub fn era(b: &TacticalBattle) -> i64 {
    todo!()
}

/// Python (orders.py, l. 186-188) : `def general(b, side)`
/// Rend le dict `gen` du premier état-major du camp (vivant ou non), ou None.
pub fn general(b: &TacticalBattle, side: i64) -> Val {
    todo!()
}

/// Des bois sur cette aile, entre les deux armées (part des cases boisées d'une bande de 300 à 900 m sur l'aile).
///
/// Python (orders.py, l. 191-204) : `def wood_on_wing(b, side, w)`
/// w : -1 (gauche) ou 1 (droite). `b.t[...]` → `b.map.t[...]`.
pub fn wood_on_wing(b: &TacticalBattle, side: i64, w: i64) -> bool {
    todo!()
}

/// Python (orders.py, l. 207-210) : `def _fat(b, side)`
/// Fatigue moyenne du camp, pondérée par les effectifs.
pub fn _fat(b: &TacticalBattle, side: i64) -> f64 {
    todo!()
}

/// Les choix de cette bataille, par onglet : [{key, tab, title, opts: [{v, label, desc, why}]}].
///
/// Python (orders.py, l. 213-290) : `def groups(b, side, livres=None)`
/// livres : trésor du joueur (nombre) ou None (défaut : pas de limite). Rend une liste de dict
/// {key, tab, title, cards, opts: [{v, label, desc, why}]}. (`why` du Python : dict à clés tuples (key, v).)
pub fn groups(b: &TacticalBattle, side: i64, livres: &Val) -> Val {
    todo!()
}

/// Python (orders.py, l. 293-300) : `def defaults(b, side, gs=None)`
/// gs : la liste rendue par groups, ou None (défaut : `groups(b, side, &Val::None)`). Rend un dict clé → valeur.
pub fn defaults(b: &TacticalBattle, side: i64, gs: &Val) -> Val {
    todo!()
}

/// Des ordres valides : chaque clé connue, chaque valeur proposée et permise, sinon celle par défaut.
///
/// Python (orders.py, l. 303-313) : `def clean(b, side, raw, livres=None)`
/// raw : ce qu'envoie le client (n'importe quelle valeur : autre chose qu'un dict vaut {}) ; livres : comme
/// groups (défaut None). Rend un dict neuf clé → valeur (le set `ok` du Python ne sert qu'à des tests
/// d'appartenance).
pub fn clean(b: &TacticalBattle, side: i64, raw: &Val, livres: &Val) -> Val {
    todo!()
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
    todo!()
}

/// Ce que les éclaireurs disent de l'ennemi (pour la fenêtre des ordres).
///
/// Python (orders.py, l. 332-344) : `def report(b, side)`
/// Rend un dict {gen: dict ou None, plan: texte ou None, sure: texte ou None, mix: {inf, cav, art}, men}.
pub fn report(b: &mut TacticalBattle, side: i64) -> Val {
    todo!()
}

/// L'avis du général : points forts, risques, estimation (favorable, incertaine, risquée).
///
/// Python (orders.py, l. 347-457) : `def advise(b, side, o)`
/// o : dict des ordres (peut être {}). Rend un dict {pros: liste, cons: liste, verdict: texte}.
pub fn advise(b: &mut TacticalBattle, side: i64, o: &Val) -> Val {
    todo!()
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
    todo!()
}

// ------------------------------------------------------------------ ce que font les ordres dans l'IA
/// Le plan de l'IA dicté par la manœuvre (None : l'IA choisit).
///
/// Python (orders.py, l. 538-550) : `def plan(b, side, pl)`
/// pl : `b.place_info()` (dict ou None ; seule sa véracité compte). Rend un texte ou None.
pub fn plan(b: &TacticalBattle, side: i64, pl: &Val) -> Val {
    todo!()
}

/// Les réglages de l'IA (ai.LEVELS) que changent les ordres de ce camp, et les ruses du camp d'en face.
///
/// Python (orders.py, l. 553-636) : `def tweak(b, side, L)`
/// L : dict des réglages (ai.LEVELS[niveau]). Rend L lui-même si aucun ordre ne joue, sinon une COPIE modifiée
/// (`dict(L)` → `L.copy()`).
pub fn tweak(b: &TacticalBattle, side: i64, L: &Val) -> Val {
    todo!()
}

/// Feux de camp : l'ennemi croit le camp d'en face 50 % plus nombreux.
///
/// Python (orders.py, l. 639-642) : `def announced_k(b, side)`
pub fn announced_k(b: &TacticalBattle, side: i64) -> f64 {
    todo!()
}

/// Bataillons de réserve d'infanterie selon les ordres (n : bataillons de ligne).
///
/// Python (orders.py, l. 645-654) : `def res_count(o, n, default)`
/// o : dict des ordres ou None ; n : bataillons de ligne ; default : ce que l'IA aurait gardé. `round(n / 3)` →
/// `py::round(n as f64 / 3.0)`.
pub fn res_count(o: &Val, n: i64, default: i64) -> i64 {
    todo!()
}

/// Le moment décisif, si le joueur a demandé qu'on l'appelle : 'go' (on y va), 'wait' (pas encore) ou None (la
/// question est posée : la bataille attend sa réponse).
///
/// Python (orders.py, l. 657-675) : `def ask(b, side, key, text)`
/// Rend 'go', 'wait' ou None (`ask(...) == "go"`). Pose `b.ask` (dict {side, key, text, t}) et lit / écrit
/// `b.ai_mem['s<side>']['asked'][key]` = [réponse, heure].
pub fn ask(b: &mut TacticalBattle, side: i64, key: &str, text: &str) -> Val {
    todo!()
}

/// La réponse du joueur au moment décisif ('go' ou 'wait').
///
/// Python (orders.py, l. 678-686) : `def answer(b, choice)`
pub fn answer(b: &mut TacticalBattle, choice: &str) -> bool {
    todo!()
}

/// Au départ de la bataille : l'heure (et ce qu'elle fait aux hommes : spec['h_off'], le crépuscule).
///
/// Python (orders.py, l. 689-706) : `def setup(b, side, o)`
/// o : dict des ordres. Change `b.dusk`, `b.spec['h_off']`, `b.light`, le moral et la fatigue des unités.
pub fn setup(b: &mut TacticalBattle, side: i64, o: &Val) {
    todo!()
}
