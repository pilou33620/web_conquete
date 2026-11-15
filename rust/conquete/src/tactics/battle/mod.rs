//! Porte game/tactics/battle.py, lignes 1 à 523 : l'aide-mémoire, les constantes, les fonctions du module, la classe
//! `TacticalBattle` (ses attributs) et sa création (`__init__` → `TacticalBattle::new`).
//! SQUELETTE : les constantes et le struct sont portés, les corps sont à écrire (`todo!()`).
//!
//! Les méthodes sont réparties, dans l'ordre du Python, entre :
//! - `aides.rs`  (l. 525-1097)  : zones et bords ; terrain : aides ; unités : aides ; journal et effets ;
//! - `ordres.rs` (l. 1099-1702) : déploiement ; ordres ; boucle ;
//! - `unite.rs`  (l. 1704-2293) : repérage ; une unité ; feu (temps, fumée, cible) ; maisons touchées, en feu, en
//!   ruine ; maisons occupées, barricades ;
//! - `combat.rs` (l. 2295-2988) : brèches ouvertes au canon ; le tir et ses pertes ; charges et mêlées ;
//! - `fin.rs`    (l. 2990-3394) : moral ; fin ; « Finir automatiquement » ; vue client ; sauvegarde.
//!
//! Conventions de ce squelette (en plus de PORTAGE.md) :
//! - une unité (`u`, `tg`, `a`, `b`, `e`, `o`, `f`, `w`, `g`, `src`, `shooter`, `foe`…) est un dict `Val`
//!   (units.rs : SLOTS, `U::alive(&u)`, `U::valid(&u)`) ; `side` : 0 l'assaillant, 1 le défenseur ;
//! - une case (`c`, `cc`, `c0`, `s`, `g` d'A*) est un `i64` (j * COLS + i) : `self.map.t[c as usize]` ; une liste de
//!   cases est un `Vec<i64>` ; une table de coûts de marche est un `Couts` (`Rc<Vec<Option<f64>>>`, None :
//!   infranchissable), passée en `&[Option<f64>]` ;
//! - `self.t`, `self.h`, `self.f` du Python sont `self.map.t`, `self.map.h`, `self.map.f` (des `Vec<u8>`) ;
//! - `(ok, msg)` → `(bool, String)` ; un paramètre à valeur par défaut reste un paramètre : chaque commentaire
//!   rappelle la signature du Python (« Python (…) : `def …` ») et dit le défaut à passer ;
//! - les méthodes statiques du Python (`cell`, `dist`, `bearing`, `_edge_band`, `_dehors`) sont des fonctions
//!   associées : `Self::cell(x, y)` ; `trait` (mot réservé) s'écrit `self.r#trait(side)` ;
//! - `&self` pour les lectures pures ; `&mut self` dès qu'une méthode écrit un attribut, un cache (`costs`, `los`,
//!   `passable`, `plan_path`…) ou les états-majors calculés à la demande (`r#trait`, `general_near`,
//!   `rally_general`, `has_general`).
//!
//! Simulation d'une bataille tactique (TacticalBattle), livrée par l'IA des deux camps (celle du joueur suit ses
//! ordres : « Donner mes ordres », orders.py), ou commandée à la main par le joueur (« Commander la bataille »).
//!
//! Le temps s'exprime en secondes de bataille (0 = 8 h du matin, spec['h_off'] décale l'heure affichée). Le serveur fait
//! avancer la bataille par pas fixes de DT = 2 s de bataille : à l'allure du film (bridge.REPLAY_RATE) ; commandée à la
//! main, à ×1 une seconde réelle vaut TIME_K = 18 s de bataille (une bataille rangée de 3 à 6 h dure 10 à 20 min à ×1,
//! ×2 et ×4 pour accélérer) ; ou aussi vite qu'il le peut (« Passer », « Finir automatiquement », bancs) : 0,3 à 0,6 ms
//! par pas sur un PC, une bataille complète en 2,5 s de calcul en médiane (6 s pour 9 sur 10) ; 3 à 4 fois plus sur un
//! Raspberry Pi 4.
//!
//! ==================================================================================================================
//! RÈGLES DE COMBAT (équilibre ; les réglages sont les constantes P_*, CHOC, MELEE_*, FORMED… ci-dessous)
//! ==================================================================================================================
//! - Feu soutenu : une salve par minute environ (units.INF_RELOAD, ART_RELOAD) ; 60 cartouches durent une heure de feu.
//!   Fusillade : P_FUSIL par homme du front et par salve à bout portant, de moins en moins juste avec la distance
//!   (units.precision : moitié à D50, de 55 m au mousquet à 360 m au Chassepot ; à 90 % de la portée efficace, deux à
//!   trois fois moins qu'à 30 m). Boulet : P_BOULET par pièce, de moins en moins juste avec la distance (ball_k : moitié
//!   à la portée efficace). Mitraille : P_MITRAILLE par pièce, la gerbe s'ouvre au-delà de 30 % de sa portée (grape_k :
//!   effet en 1/distance) ; terrible à bout portant (sous GRAPE_CLOSE = 150 m : ×1,5 à 100 m, ×GRAPE_POINT = 1,6 dès
//!   90 m). L'ordre dispersé (tirailleurs) prend nettement moins au
//!   canon (×0,35 au boulet, ×0,55 à la mitraille), un peu moins au fusil (×0,8).
//! - Zones de tir (fire_zones, dessinées à la sélection par le client) : bout portant (precision ≥ units.BOUT_K = 0,6 ;
//!   la mitraille pour les canons), efficace (jusqu'à la portée efficace), longue (jusqu'à la portée maximale). Fusil
//!   1777 : 0-65 m ×1, 65-120 m ×½, 120-230 m ×⅕ ; canon de 12 Gribeauval : mitraille 0-280 m ×1, boulet 280-700 m
//!   ×0,38, 700-1 100 m ×0,13. L'infanterie à volonté ne tire qu'à 130 % de la portée efficace (on ménage les
//!   cartouches), en salve à 85 % ; sous l'ordre « attaquer », jusqu'à la portée maximale (la zone longue : harcèlement).
//!   Pas de bonus à tirer de loin : l'avantage est déjà l'impunité (la cible ne répond pas au-delà de sa propre portée),
//!   payé en cartouches (cinq fois moins d'effet par coup) ; un bonus de moral aurait renforcé tout le canon contre
//!   l'infanterie, qu'il surclasse toujours en portée.
//! - Attaquer (ordre du joueur, sauf cavalerie) : la troupe s'arrête selon son profil d'arrêt (u.stop, ordre 'stop' :
//!   'max' à 95 % de la portée maximale, 'bonne' à 90 % de la portée efficace, 'bout' à 90 % du bout portant ;
//!   units.stop_dist), puis tient et tire, face à la cible, sans la poursuivre si elle recule (au joueur de redonner
//!   l'ordre). L'IA garde son suivi : 90 % de la portée efficace (canons : dès qu'ils portent ; cavalerie : 120 m), et
//!   elle suit la cible.
//! - Charge : l'élan (charge_v, mètres de course utile ; plein élan en 110 m pour la cavalerie, 45 m pour l'infanterie)
//!   se gagne en courant et se perd en terrain difficile (bois, rochers, marais, vignes, maisons, murs : BRAKE_*), aux
//!   haies et en montée ; une charge relancée au contact ou en pleine mêlée n'a pas d'élan. De face, une troupe en ordre
//!   (ligne ou colonne, moral ≥ FORMED) ou une batterie chargée tire à bout portant (feu de défense) ; une colonne
//!   d'infanterie qui tombe sous FALTER s'arrête court ; la cavalerie qui ne rompt pas une ligne ferme est repoussée. Une
//!   batterie abordée de face lâche deux décharges de mitraille à bout portant (×GRAPE_POINT) : on la prend de flanc.
//!   De flanc, de dos, sur des tirailleurs, une troupe en manœuvre ou ébranlée, sur des canons : le choc est rude. Une
//!   charge essouffle les chevaux (CHARGE_FAT), qui chargent ensuite moins bien.
//! - Mêlée : peu de pertes (MELEE_K), décidée au moral (MELEE_MOR par seconde, partagé selon les forces) ; le plus faible
//!   cède du terrain sous GIVE_WAY (repli de 100 m, sans fuir) ; à plusieurs contre un, les forces s'additionnent, sauf
//!   dans un passage étroit (brèche, rue, maison, mur : NARROW) où la pression ne dépasse pas MELEE_MOR. La brèche est
//!   un goulet (BRECHE_*) : l'assaillant n'y engage pas plus de 180 hommes en mêlée, s'y bat à ×0,8 et y prend ×1,4 au feu.
//! - Moral : pertes (surtout brutales, de flanc, de dos ; pas de surprise pour une troupe qui se retire en ordre),
//!   déroutes voisines (ROUT_MOR, seulement pour les troupes déjà ébranlées : pas de déroute en chaîne), munitions,
//!   fatigue ; remonte au calme (MOR_REC), plus vite près du général. Déroute sous 25 : la troupe fuit vers son bord.
//! - Ralliement (RALLY_*) : seulement auprès d'un général (état-major ami à moins de 400 m, 500 m s'il est inspirant), au
//!   calme (aucun ennemi en état de combattre à moins de 400 m) : il faut aller chercher les fuyards ; ils s'y arrêtent,
//!   se reprennent (0,1 point de moral par seconde) et reforment les rangs à 40. Dans une place, et partout pour les
//!   défenseurs de la place (chez eux), leurs officiers les rallient sans le général (au calme : 400 m, 150 m dans les
//!   maisons). Sans général sur le terrain (blessé, absent,
//!   garnison seule), seulement loin de l'ennemi (700 m), deux fois et demie plus lentement. Sinon, les fuyards courent
//!   jusqu'au bord de la carte et quittent la bataille. L'ordre « Rallier » suit la même règle (l'ennemi à plus de 150 m
//!   suffit) et dit pourquoi il échoue (« Le général est trop loin pour rallier ces hommes. »).
//! - Prisonniers : fuyards rattrapés (CAPTURE), surtout par la cavalerie, moins par des chevaux essoufflés.
//! - Vue : symétrique (si je te vois, tu me vois) ; une troupe en lisière d'un bois ou de maisons voit et se voit ; bois,
//!   bâti, murs et haies ne cachent que ce qui est sous leur faîte (une haie ne cache rien à qui la domine).
//! - Place : l'assaillant l'emporte en tenant le cœur 6 min (HEART_*) ; à l'échelle ou sur une barricade, il se bat mal.
//!   Reddition (SURR_*) : une brèche ouverte depuis 20 min, une heure sous le canon, 30 % de pertes, un moral moyen sous 55
//!   et l'assaillant deux fois plus nombreux en ligne : la garnison capitule et elle est prisonnière (la place est prise).
//!   Siège ou assaut d'une place à enceinte : l'artillerie du défenseur se déploie sur l'enceinte (la case de mur la plus
//!   proche, à REMPART_GAP de la batterie voisine, tournée vers le dehors), tire de là et n'en bouge plus (on_rampart).
//! - Bâti (BATI_*, FEU_*, SPEC-2D § 5) : chaque case bâtie est intacte (0), touchée (1), en feu (2) ou en ruine (3). Un
//!   boulet qui tombe dessus (court ou long autour de sa cible, BOULET_* ; par-dessus le rempart s'il est trop long)
//!   l'entame (BATI_TOUCHE) ou y met le feu (BATI_FEU, BATI_FEU_CHAUME, ×2 à l'obus) ; le feu dure FEU_DUREE, gagne les
//!   cases bâties voisines (FEU_PROPAG), puis laisse une ruine. Couvert : BATI_COVER (en feu, aucun ; la troupe qui s'y
//!   trouve en sort et perd FEU_MOR de moral) ; une ruine laisse mieux passer la vue (RUINE_OPAC). Tout se tire de
//!   battle.rng : même graine, même incendie. Le client reçoit les changements [case, état] dans `bati` de la vue (depuis
//!   since), l'état complet dans `bati` de la carte ; la sauvegarde les garde.
//! - Maisons (ordre 'maisons', MAISON_*) : l'infanterie (légers et milice compris), ni aux prises ni en déroute, va au bâti
//!   le plus proche du point visé (à 60 m au plus ; une ruine aussi, une maison en feu non), y entre en 40 s (forme
//!   'maisons') et en sort en 30 s (tout ordre de marche, une retraite, une charge ; la déroute et l'incendie l'en
//!   chassent sur-le-champ). 25 hommes par case bâtie à moins de 40 m : les autres restent dans la rue et les avantages
//!   vont au prorata des hommes à l'abri. Couvert des maisons (BATI_COVER selon leur état) ; cachée (80 % à l'abri) : vue
//!   à moins de 120 m seulement, ou 60 s après avoir tiré ; feu par les fenêtres (60 % des hommes, units.FRONT) ; corps à
//!   corps ×1,6 ; les cavaliers ne la chargent pas (l'ordre est refusé, une charge lancée meurt au pied des maisons).
//! - Barricades (ordre 'barricade', BARR_*) : l'infanterie arrêtée, sans ennemi repéré à moins de 200 m, qui a de quoi
//!   faire (maisons à 80 m : charrettes, tonneaux, meubles, portes ; bois à 40 m : abattis ; des sapeurs : partout), dresse
//!   en 4 min (sapeurs 2 ; ×1,3 fatigués, à 50 de fatigue) une ligne de cases T_BARRICADE à 15 m devant son front, de sa
//!   largeur, sur le découvert et les routes seulement (BARR_ON : jamais sur le bâti, l'eau, les murs, les portes, ni dans
//!   la zone de déploiement de l'assaillant) ; un ennemi à moins de 150 m ou un nouvel ordre arrête le travail. Une
//!   barricade par troupe. Derrière : le couvert d'un ouvrage (WALLISH) et ×1,5 au corps à corps ; cavaliers et canons n'y
//!   passent pas ; une charge sur la troupe qui est derrière perd 60 % de son choc et ne la rompt pas (les cavaliers
//!   tournent bride) ; un boulet qui tombe sur une case de barricade la renverse une fois sur quatre (battle.rng). Le
//!   client reçoit les barricades dans `barr` de la vue et de la carte, les cases posées ou renversées dans `barr_t` ;
//!   la sauvegarde les garde.
//!
//! ==================================================================================================================
//! AIDE-MÉMOIRE POUR L'ÉQUIPE IA (game/tactics/ai.py)
//! ==================================================================================================================
//! L'IA reçoit `battle` (TacticalBattle) et son camp `side` (0 assaillant, 1 défenseur). Elle ne fait que donner des
//! ordres, comme le joueur, et ne lit que ce que son camp voit :
//!
//! Ordres (renvoient (ok, msg)) :
//!   battle.deploy(side, ids, x, y, dir=None, form=None)    pendant le déploiement : place les unités côte à côte
//!                                                           autour de (x, y), front tourné vers dir, dans la zone.
//!   battle.order(side, ids, kind, **params)                 kind : 'move' (x, y, dir?, run?), 'attack' (target),
//!         'charge' (target), 'hold', 'fire' (mode='free'|'hold'), 'form' (form), 'rally', 'retreat',
//!         'stop' (mode='max'|'bonne'|'bout' : profil d'arrêt des prochains 'attack' donnés par le joueur),
//!         'bombard' (x, y) : batterie de brèche (canons de l'assaillant, place à enceinte) : elle bat le rempart au plus
//!         près de (x, y) et ne tire sur l'ennemi qu'à portée de mitraille ;
//!         'bombard' (x, y) vaut aussi pour une barricade dressée pendant la bataille, de n'importe quel camp ;
//!         'maisons' (x?, y? : par défaut là où elle est) : occuper les maisons ; 'barricade' : se barricader (voir les
//!         règles). battle.why_maisons(u, x, y)[0] et battle.why_barricade(u) disent pourquoi c'est impossible ('' sinon) ;
//!         la vue de mes unités d'infanterie les donne (can_occupy, can_barricade : True ou la raison).
//!         Plusieurs unités en 'move' gardent leur disposition relative autour du point. L'IA ne commande que les unités
//!         qu'elle contrôle (u.ctrl == 'ia') : battle.ai_units(side).
//!   battle.withdraw(side)                                   tout le camp décroche (fin de bataille).
//!
//! Lecture (sans tricher sur la vue) :
//!   battle.ai_units(side) / battle.units_of(side)           unités du camp (objets Unit, voir units.py) ;
//!   battle.visible_enemies(side)                            ennemis actuellement repérés par ce camp ;
//!   battle.unit(uid)                                        une unité par son id (ne lire que les siennes ou les repérées) ;
//!   battle.cover_at(x, y) → 0..0,7                          couvert de la case (réduction des pertes au feu ; maisons
//!                                                           touchées, en feu, en ruine : BATI_COVER) ;
//!   battle.on_rampart(u) → bool                             canon du défenseur sur l'enceinte (fixe) ;
//!   battle.height_at(x, y) → m                              altitude ;
//!   battle.terrain_at(x, y) → type T_* (terrain.TYPE_NAMES) ; battle.is_wood(x, y) ;
//!   battle.los(x1, y1, x2, y2, eye1, eye2) → bool           ligne de vue symétrique (bois, bâti, murs, haies, crêtes),
//!                                                           eye : hauteur de ce qui regarde ou est vu (HEIGHT) ;
//!   battle.los_units(a, b) → bool                           la même entre deux unités ;
//!   battle.path_cost(x1, y1, x2, y2, cls='inf', side=0)     temps de marche estimé (s) à vitesse 1 m/s
//!                                                           × coût du terrain, ou None si infranchissable ;
//!   battle.passable(x, y, cls='inf', side=0) → bool ;
//!   battle.ranges(u) → (efficace, max, mitraille|None) ;    battle.dist(a, b) ; battle.bearing(a, b) ;
//!   battle.zone(side) → [x0, y0, x1, y1]                    zone de déploiement ; battle.edge(side) : 'N','S','E','O' ;
//!   battle.front_dir(side) → angle vers l'ennemi depuis sa zone ;
//!   battle.feature_at(x, y) → 0 aucun, 1 clôture, 2 haie, 3 muret (couvert léger à moyen, léger ralentissement) ;
//!   battle.cells_near(x, y, r) → cases à moins de r m ;    battle.barr (barricades dressées), battle.barr_prev (leurs
//!                                                           cases debout) ;
//!   battle.objective() → (x, y) | None                      cœur de la place (assaut) ;
//!   battle.place_info() → dict | None                       {x, y, r, fort} de la place ;
//!   battle.best_spot(x, y, radius, kind, side, facing=None) meilleure case proche : kind = 'cover' (couvert),
//!                                                           'height' (hauteur), 'wood_edge' (lisière, pour cacher
//!                                                           des canons : bois devant soi, vue dégagée vers facing) ;
//!   battle.threat(side, x, y, radius=600) → hommes ennemis repérés à moins de radius ;
//!   battle.time_left() → s avant le crépuscule ;           battle.clock, battle.phase, battle.difficulty ;
//!   battle.strength(side) → hommes valides de son camp ;    battle.seen_strength(side) → ennemis repérés (hommes).
//!
//!   battle.general_near(u) → état-major ami à moins de 400 m ;  battle.trait(side) → trait du général du camp ;
//!   battle.rally_general(u) → état-major qui peut rallier cette troupe ; battle.rally_radius(g) → son rayon (m) ;
//!   battle.has_general(side) → le camp a encore un état-major sur le terrain ; battle.in_place(x, y) → dans la place ;
//!   battle.edge_point(side, x, y) → où fuient les troupes en déroute ;
//!   battle.rng (hasard déterministe de la bataille) ;  battle.ai_mem (dict libre pour la mémoire de l'IA, en types JSON :
//!   il est enregistré avec la bataille) ;  battle.withdrawing[side] (le camp décroche déjà).
//!
//! Champs d'une unité (Unit) : id, side, owner, type, cls ('inf', 'cavalerie', 'artillerie', 'general', 'chariot'), light,
//! men, men0, xp, morale, fat, ammo, ammo0, x, y, dir, form, state, order, target, busy (s de manœuvre restantes), valid
//! (en état de combattre : ni déroute, ni hors de combat, ni état-major, ni chariot), group / gname (armée de campagne),
//! ctrl ('joueur' | 'ia'), halt (en déroute : les fuyards se sont arrêtés pour se reformer). Le chariot de munitions (type
//! 'chariot', ammo = chargement en %) recomplète les régiments à moins de 150 m (4 % de la dotation par minute) ; il se
//! prend s'il reste sans escorte à moins de 40 m d'un ennemi. Le général (type 'general') donne +10 de moral à moins de
//! 400 m et rallie les fuyards (voir « Ralliement ») ; il peut être blessé.
//!
//! « Finir automatiquement » : battle.autofinish() fait passer la bataille en mode accéléré (battle.accel) : les unités
//! du joueur passent sous le contrôle de l'IA (son camp rejoint ai_sides, au niveau ACCEL_LEVEL = normal ; en plein combat,
//! elle reprend la situation telle qu'elle est : mémoire absente → ai._adopt), et la suite se joue IA contre IA avec les
//! mêmes règles et les mêmes pas DT qu'une bataille commandée. Le serveur avance une bataille accélérée par
//! battle.run_for(budget) (bridge.tick : un budget de calcul par appel, pour rester réactif) ; battle.run_to_end() la
//! joue d'un coup (essais, bancs). battle.resume() rend le commandement au joueur (en pause). Le mode accéléré est
//! enregistré avec la bataille.
//! Chiffres : DT = 2 s par pas, TIME_K = 18 s de bataille par seconde réelle à ×1, repérage toutes les 4 s, IA toutes
//! les 2 s ; fin au crépuscule (DUSK) ; assaut gagné en tenant le cœur de la place 6 min (au moins 150 hommes à 90 m)
//! sans défenseur à 160 m.
//! Abris (ai._abris) : la garnison d'une place (rôles rue, cœur, îlot) occupe les maisons quand l'ennemi est à 600 m ;
//! l'infanterie de ligne du défenseur se barricade devant des cavaliers qui la menacent (à 400 m, ou qui marchent droit
//! sur elle à 800 m) ; ni les légers ni l'assaillant ne se barricadent. L'IA ne déplace plus une troupe dans les maisons
//! ou à sa barricade (ai._tenue) : elle n'en sort que pour charger, se replier ou fuir. Au plus une barricade pour trois
//! bataillons de ligne (ai.ABRI_PART). Devant une barricade (ai._barrage) : les canons la battent ('bombard' sur sa case
//! debout la plus proche : chaque pièce y envoie son boulet) jusqu'à la brèche, quand notre infanterie est à 500 m devant
//! elle ; la cavalerie ne charge ni la troupe qui est derrière ni celle des maisons, elle la prend par un bout ou par la
//! brèche s'il y a la place, sinon elle attend ; l'infanterie passe par la brèche, sinon par un bout, sinon ne l'aborde de
//! face qu'à 1,5 contre un (la barricade comptée) ; les canons visent d'abord une troupe repérée dans les maisons.
//! ==================================================================================================================
#![allow(unused_variables, unused_imports)] // (squelette : à retirer une fois les corps écrits)

mod aides;
mod combat;
mod fin;
mod ordres;
mod unite;

use crate::geo::GeoMap;
use crate::py::{self, Random, Val};
use crate::rules as R;
use crate::tactics::orders as OR; // (« Donner mes ordres » : le moment décisif)
use crate::tactics::stats as ST; // (xp_k, ELAN, technologies : les mêmes chiffres que la fiche)
use crate::tactics::terrain as TR;
use crate::tactics::terrain::{
    BattleMap, CELL, COLS, H, N, ROWS, T_BARRICADE, T_BATI, T_BOIS, T_BRECHE, T_CHAMP, T_CHEMIN, T_EAU, T_FORET_T, T_GUE, T_LANDE_T,
    T_MARAIS_T, T_MUR, T_PORTE, T_PRE, T_ROCHE, T_ROUTE, T_SABLE, T_VERGER, T_VIGNE_T, W,
};
use crate::tactics::units as U;
use crate::{dict, list, py_const, tup};
use std::collections::HashMap;
use std::rc::Rc;

pub const DT: f64 = 2.0; // pas de simulation (s de bataille)
pub const TIME_K: f64 = 18.0; // s de bataille par s réelle, à ×1 (une bataille de 3 à 6 h dure 10 à 20 min à ×1)
pub const VIS_DT: f64 = 4.0; // mise à jour du repérage
pub const AI_DT: f64 = 2.0; // l'IA réfléchit toutes les 2 s de bataille
pub const START_H: f64 = 8.0;
py_const!(DUSK, dict!{"printemps" => 19.5, "été" => 20.5, "ete" => 20.5, "automne" => 18.0, "hiver" => 17.0});

pub const X: Val = Val::None; // infranchissable
// coût de marche par classe de mouvement (1 = prairie), dans l'ordre des types de case
py_const!(COST, dict!{
    //             PRE  CHAMP VIGNE LANDE BOIS FORET MARAIS EAU GUE  ROUTE CHEMIN BATI MUR BRECHE PORTE SABLE ROCHE BARRIC. VERGER
    "inf" =>   list![1.0, 1.15, 1.5, 1.25, 1.7, 2.6, 3.0, X, 3.0, 0.85, 0.95, 2.2, X, 2.5, 1.2, 1.8, 4.0, 3.5, 1.2],
    "light" => list![1.0, 1.1, 1.3, 1.1, 1.2, 1.8, 2.2, X, 2.5, 0.85, 0.95, 1.8, X, 2.2, 1.2, 1.6, 3.0, 3.0, 1.1],
    "cav" =>   list![1.0, 1.2, 2.2, 1.4, 2.6, 5.0, 5.0, X, 2.5, 0.8, 0.9, 3.0, X, 4.0, 1.3, 2.0, X, 6.0, 1.6],
    "art" =>   list![1.0, 1.3, 2.6, 1.5, 3.2, X, X, X, 4.0, 0.7, 0.9, 3.0, X, 6.0, 1.2, 3.0, X, X, 1.8],
});
// (verger, le dernier : couvert léger, les fruitiers gênent un peu la vue jusqu'à 5 m ; SPEC-CARTES.md)
pub const COVER: [f64; 19] = [0.0, 0.05, 0.15, 0.1, 0.35, 0.5, 0.1, 0.0, 0.0, 0.0, 0.05, 0.55, 0.7, 0.35, 0.5, 0.05, 0.4, 0.5, 0.2];
pub const OPACITY: [i64; 19] = [0, 0, 0, 0, 34, 60, 0, 0, 0, 0, 0, 50, 100, 0, 100, 0, 0, 0, 14]; // en centièmes, cumulés le long du regard
// hauteur (m) de ce qui bouche la vue sur la case : un regard qui passe au-dessus n'est pas gêné
pub const TOP: [i64; 19] = [0, 0, 0, 0, 12, 16, 0, 0, 0, 0, 0, 8, 7, 0, 7, 0, 0, 0, 5];
pub const WOODS: [i64; 2] = [T_BOIS, T_FORET_T];
// canons dans un bois (pas en forêt : les pièces n'y passent pas) : camouflés sous les branches, l'ennemi ne les voit
// qu'à moins de CAMO_SEEN m, CAMO_FIRE quand ils tirent (la fumée monte entre les arbres) ; en échange, les troncs
// gênent le pointage et ferment le champ de tir (tir ×CAMO_FIRE_K) et la mise en batterie est plus longue (×CAMO_SETUP)
pub const CAMO_SEEN: f64 = 250.0;
pub const CAMO_FIRE: f64 = 500.0;
pub const CAMO_FIRE_K: f64 = 0.65;
pub const CAMO_SETUP: f64 = 1.6;
// éléments linéaires (couche f) : aucun, clôture, haie, muret
pub const FCOVER: [f64; 4] = [0.0, 0.12, 0.25, 0.35];
pub const FCOST: [f64; 4] = [0.0, 0.15, 0.4, 0.3];
pub const FOPAC: [i64; 4] = [0, 0, 15, 0];
pub const FTOP: [f64; 4] = [0.0, 0.0, 2.8, 0.0]; // une haie (talus compris) cache ce qui est à hauteur d'homme, pas ce qu'on voit de plus haut
pub const EYE: f64 = 2.5; // hauteur d'un fantassin, pour la vue (m)
// bâti sous le canon (SPEC-2D § 5) : chaque case bâtie est 0 intacte, 1 touchée, 2 en feu, 3 en ruine
pub const BATI_COVER: [f64; 4] = [COVER[T_BATI as usize], 0.45, 0.0, 0.3]; // en feu, elle ne couvre plus ; en ruine, moins qu'une maison
pub const BOULET_LONG: [f64; 3] = [15.0, 0.07, 90.0]; // dispersion d'un boulet dans l'axe du tir : 15 m + 7 % de la distance, 90 m au plus
pub const BOULET_COTE: [f64; 3] = [5.0, 0.02, 30.0]; // … et de côté : 5 m + 2 % de la distance, 30 m au plus
pub const BATI_TOUCHE: f64 = 0.5; // un boulet tombé sur une case bâtie intacte l'entame une fois sur deux…
pub const BATI_FEU: f64 = 0.06; // … et y met le feu (tuile, ardoise) six fois sur cent…
pub const BATI_FEU_CHAUME: f64 = 0.3; // … trente sur un toit de chaume (map.buildings, toit='chaume') ; ×2 à l'obus (mélinite)
pub const FEU_DT: f64 = 10.0; // l'incendie se calcule toutes les 10 s de bataille :
pub const FEU_DUREE: f64 = 900.0; // une maison brûle un quart d'heure, puis il en reste une ruine ;
pub const FEU_PROPAG: f64 = 0.006; // à chaque fois, le feu gagne une case bâtie voisine (×2,5 chaume, ×0,4 pluie ou neige) ;
pub const FEU_MOR: f64 = 6.0; // la troupe chassée d'une maison en feu perd 6 points de moral
pub const RUINE_OPAC: i64 = 25; // une ruine bouche la vue moitié moins qu'une maison (OPACITY du bâti : 50)
pub const REMPART_GAP: f64 = 60.0; // siège : deux batteries du défenseur sur l'enceinte à 60 m l'une de l'autre au moins
pub const PIET_MAX: i64 = 200000; // taille au plus de l'image de la boue (data URL PNG, SPEC-SUITE F8)

/// Image de la boue envoyée par le navigateur : une data URL PNG de taille raisonnable.
///
/// Python (battle.py, l. 241-243) : `def valid_piet(v)`
/// v : ce qu'envoie le client (n'importe quelle valeur ; `len(v)` : en caractères, `Val::len`).
pub fn valid_piet(v: &Val) -> bool {
    todo!()
}

py_const!(HEIGHT, dict!{"inf" => 2.5, "artillerie" => 3.0, "cavalerie" => 3.5, "general" => 3.5, "chariot" => 3.0}); // canons : officiers à cheval, caissons
// élan d'une charge : il se gagne en courant (mètres pour un plein élan), se perd en terrain difficile et en montée
py_const!(ELAN_M, dict!{"cav" => 110.0, "inf" => 45.0});
py_const!(BRAKE_CAV, dict!{T_BOIS => 0.45, T_FORET_T => 0.3, T_MARAIS_T => 0.35, T_VIGNE_T => 0.5, T_BATI => 0.4, T_ROCHE => 0.25, T_VERGER => 0.75,
    T_SABLE => 0.7, T_LANDE_T => 0.9, T_MUR => 0.3, T_PORTE => 0.3, T_BRECHE => 0.4, T_BARRICADE => 0.4, T_GUE => 0.6});
py_const!(BRAKE_INF, dict!{T_BOIS => 0.85, T_FORET_T => 0.7, T_MARAIS_T => 0.6, T_VIGNE_T => 0.85, T_BATI => 0.8, T_ROCHE => 0.55, T_VERGER => 0.9,
    T_SABLE => 0.8, T_MUR => 0.5, T_PORTE => 0.5, T_BRECHE => 0.7, T_BARRICADE => 0.7, T_GUE => 0.7});
// ---- équilibre du combat (voir « Règles de combat » dans l'aide-mémoire) ----
pub const P_FUSIL: f64 = 0.014; // touchés par homme qui tire et par salve, à bout portant (× precision(d) : moitié à D50 ;
                                // avant arme, expérience, moral…)
pub const P_BOULET: f64 = 0.26; // touchés par pièce et par coup de boulet à courte distance, sur une ligne à découvert
// les canons de l'assaillant battent le rempart d'une place : un pan s'effondre après BREACH_PTS coups de pièce (pondérés
// par l'armement et la distance) par niveau de fortification, dans un des BREACH_SECT secteurs de l'enceinte
// (deux batteries ouvrent une place ordinaire en une petite heure)
pub const BREACH_PTS: f64 = 240.0;
pub const BREACH_SECT: i64 = 16;
pub const BREACH_R: f64 = 24.0; // rayon de la brèche ouverte au canon (m)
pub const DEPLOY_GAP: f64 = 200.0; // demi-largeur de la bande neutre entre les deux zones de déploiement (m)
pub const DEPLOY_WALL: f64 = 450.0; // l'assaillant se déploie au moins à cette distance de l'enceinte…
pub const DEPLOY_DEF: f64 = 250.0; // … et le défenseur jusqu'à cette distance au-delà (m)
pub const AI_DEPLOY_ATT: f64 = 500.0; // zones de l'IA : l'assaillant à moins de 500 m de son bord…
pub const AI_DEPLOY_DEF_FRAC: f64 = 0.65; // … le défenseur sur le devant de sa zone (65 % de sa profondeur)…
pub const AI_DEPLOY_DEF: f64 = 120.0; // … et dans une place, à 120 m de l'enceinte au plus
pub const P_MITRAILLE: f64 = 0.56; // … à mitraille, jusqu'à 30 % de la portée de mitraille (puis de moins en moins : grape_k)
pub const P_REFFYE: f64 = 0.32; // mitrailleuse : touchés par pièce et par gerbe, à bout portant (0,13 à 1 200 m, là où l'IA la
                                // place, comme avant), sur une ligne à découvert…
pub const REFFYE_VS_PIECE: f64 = 0.25; // … bien moins contre des pièces (servants abrités derrière leurs affûts)
pub const GRAPE_CLOSE: f64 = 150.0; // … et bien davantage à bout portant : sous 150 m, ×1,5 à 100 m…
pub const GRAPE_POINT: f64 = 1.6; // … ×1,6 dès 90 m (aussi le feu de défense d'une batterie abordée de face)
pub const P_RECEPTION: f64 = 0.035; // feu de défense à bout portant contre une charge, par homme du front
pub const CHOC: f64 = 0.024; // pertes du choc d'une charge, par homme qui charge (× élan, flanc, ordre de la cible, type)
pub const MELEE_K: f64 = 0.0004; // pertes infligées en mêlée, par homme et par seconde (× force au corps à corps)
pub const MELEE_MOR: f64 = 0.5; // moral perdu par seconde de mêlée, partagé selon le rapport des forces au corps à corps
pub const GIVE_WAY: i64 = 35; // au corps à corps, le plus faible cède du terrain (repli de 100 m) sous ce moral, sans fuir
pub const FORMED: i64 = 50; // moral d'une troupe en ligne ou en colonne qui reçoit une charge de face en bon ordre…
pub const HOLD: i64 = 40; // … et qui, s'il lui en reste autant après le choc, repousse les cavaliers
pub const FALTER: i64 = 50; // une charge d'infanterie qui, sous le feu de défense, tombe sous ce moral s'arrête court
// moral regagné par seconde au calme (plus près du général)
pub const MOR_REC: f64 = 0.02;
pub const MOR_REC_GEN: f64 = 0.05;
pub const ROUT_R: f64 = 220.0; // une déroute ébranle les amis à moins de 220 m…
pub const ROUT_MOR: f64 = 3.0; // … de 3 points de moral (bataillon de 250 hommes ; deux fois moins près du général)…
pub const ROUT_STEADY: i64 = 60; // … s'ils sont déjà ébranlés : rien au-dessus de 60 de moral, tout sous 30
// ralliement : une troupe en déroute ne se reforme que près d'un général (état-major ami à moins de RALLY_R, RALLY_R +
// RALLY_INSP pour un général inspirant) et au calme (aucun ennemi en état de combattre à moins de RALLY_CALM) : il faut
// aller la chercher. Les fuyards s'y arrêtent et regagnent RALLY_REC de moral par seconde ; à 40, ils reforment les rangs.
// Dans une place, et partout pour les défenseurs d'une place (chez eux), les officiers rallient leurs hommes sans le
// général (au calme ; RALLY_CALM_BATI dans les maisons ; RALLY_REC_PLACE), comme avant.
// Sans général sur le terrain (blessé, absent, garnison seule), ils ne les arrêtent que loin de l'ennemi (RALLY_ALONE),
// et lentement (RALLY_REC_ALONE). Partout ailleurs, les fuyards courent jusqu'au bord de la carte et quittent la bataille.
pub const RALLY_R: f64 = 400.0;
pub const RALLY_INSP: f64 = 100.0;
pub const RALLY_CALM: f64 = 400.0;
pub const RALLY_CALM_BATI: f64 = 150.0;
pub const RALLY_ALONE: f64 = 700.0;
pub const RALLY_REC: f64 = 0.1;
pub const RALLY_REC_PLACE: f64 = 0.08;
pub const RALLY_REC_ALONE: f64 = 0.04;
// le drapeau : un bataillon qui part en déroute avec l'ennemi à moins de FLAG_R m le lui abandonne ; lui-même et ses
// voisins (ROUT_R) en sont ébranlés, le vainqueur s'enhardit ; sans drapeau, les fuyards se rallient moins vite
pub const FLAG_R: f64 = 60.0;
pub const FLAG_SHOCK: f64 = 12.0;
pub const FLAG_AMIS: f64 = 4.0;
pub const FLAG_GAIN: f64 = 8.0;
pub const FLAG_RALLY: f64 = 0.6;
// la fumée de la poudre noire : elle s'amasse par carrés de SMOKE_CELL m là où l'on tire (une salve de 300 fusils :
// SMOKE_SALVE ; une pièce : SMOKE_PIECE), se dissipe en SMOKE_TAU s (plus vite sous la pluie et le vent) et gêne la
// visée de qui tire dedans, à travers ou dessus : jusqu'à SMOKE_MAX du feu en moins. La poudre sans fumée n'en fait pas.
// (réglé léger : à 0,25 et 35 %, les batailles de référence des bancs changeaient d'issue)
pub const SMOKE_CELL: f64 = 100.0;
pub const SMOKE_SALVE: f64 = 0.3;
pub const SMOKE_PIECE: f64 = 0.06;
pub const SMOKE_K: f64 = 0.12;
pub const SMOKE_MAX: f64 = 0.2;
py_const!(SMOKE_TAU, dict!{"pluie" => 70.0, "orage" => 60.0, "tempete" => 35.0, "neige" => 100.0, "brouillard" => 160.0});
// (int(W // SMOKE_CELL) + 1, int(H // SMOKE_CELL) + 1 : 31 et 21)
pub const SMOKE_COLS: i64 = (W as f64 / SMOKE_CELL) as i64 + 1;
pub const SMOKE_ROWS: i64 = (H as f64 / SMOKE_CELL) as i64 + 1;
// le temps change pendant la bataille : (probabilité, délai mini et maxi en heures, temps suivant possibles)
py_const!(WX_CHANGE, dict!{"brouillard" => tup![1.0, 1.0, 2.5, tup!["soleil", "soleil", "nuages"]], "nuages" => tup![0.3, 1.0, 4.0, tup!["pluie"]],
    "pluie" => tup![0.4, 1.0, 3.0, tup!["nuages"]], "orage" => tup![0.7, 0.5, 1.5, tup!["pluie"]]});
py_const!(WX_TXT, dict!{"soleil" => "Le brouillard se lève : le soleil perce.", "nuages" => "Le ciel se dégage.",
    "pluie" => "La pluie se met à tomber : la poudre se mouille."});
// assaut d'une place : l'assaillant l'emporte s'il tient le cœur (au moins HEART_MEN hommes en état de combattre à
// moins de HEART_R) sans défenseur en état de combattre à moins de HEART_FREE, pendant HEART_HOLD secondes de suite
pub const HEART_R: f64 = 90.0;
pub const HEART_MEN: f64 = 150.0;
pub const HEART_FREE: f64 = 160.0;
pub const HEART_HOLD: f64 = 360.0;
// reddition d'une place (l'usage des sièges, de Vauban à Strasbourg 1870 : la brèche praticable, la garnison peut se
// rendre) : brèche ouverte depuis SURR_BREACH_T, sous le canon depuis SURR_POUND_T, la garnison a perdu SURR_LOSS de ses
// hommes, son moral moyen (fuyards compris ; sous FORMED, une troupe est ébranlée) est sous SURR_MOR, et l'assaillant
// en état de combattre est SURR_RATIO fois plus nombreux : elle capitule, prisonnière (ni en rase campagne, ni sans brèche)
pub const SURR_BREACH_T: f64 = 1200.0;
pub const SURR_POUND_T: f64 = 3600.0;
pub const SURR_LOSS: f64 = 0.3;
pub const SURR_MOR: f64 = 55.0;
pub const SURR_RATIO: f64 = 2.0;
py_const!(CAPTURE, dict!{"contact_cav" => 0.004, "contact_inf" => 0.0007,  // part des fuyards rattrapés par pas de 2 s au contact
    "choc_cav" => 0.03, "choc_inf" => 0.02,            // … par une charge sur des fuyards
    "rupture_cav" => 0.04, "melee_cav" => 0.03});      // … quand la cavalerie rompt une troupe (choc, mêlée)
py_const!(CHARGE_FAT, dict!{"cav" => 12.0, "inf" => 6.0}); // fatigue d'une charge menée jusqu'au choc : les chevaux sont essoufflés
// ordres propres à chaque arme (voir order) : feu de salve et salve puis baïonnette (ligne, grenadiers), harcèlement
// et couvert (voltigeurs, chasseurs), poursuite (cavalerie), projectile et contre-batterie (artillerie)
pub const VOLLEY_RANGE: f64 = 0.85; // feu de salve : on ne tire qu'à moins de 85 % de la portée efficace (tout porte)…
pub const VOLLEY_POWER: f64 = 1.25; // … la volée groupée touche un quart de plus…
pub const VOLLEY_RELOAD: f64 = 1.15; // … mais on attend l'ordre : le rechargement est plus long
pub const VOLLEY_CHARGE_AT: f64 = 0.6; // « salve puis baïonnette » : on tire à 60 % de la portée efficace, puis on charge
pub const VOLLEY_WAIT: f64 = 30.0; // … et l'on charge quand même si la volée n'est pas partie 30 s après être arrivé à portée
pub const ENTRENCH_T: f64 = 300.0; // retranchements : cinq minutes à l'arrêt pour s'enterrer (technologie, SPEC-TECH.md)
pub const LOGEMENT_K: f64 = 0.3; // logement dans une brèche (spec['logement'] : ids, posés par l'IA) : gabions, sacs à terre
// « Occuper les maisons » (ordre 'maisons' ; la troupe prend la forme 'maisons') : l'infanterie va au bâti le plus
// proche du point (à MAISON_R au plus), y entre en MAISON_IN s, en sort en MAISON_OUT s (tout ordre de marche l'en
// fait sortir). Chaque case bâtie qui ne brûle pas, à moins de MAISON_CAP_R, abrite MAISON_MEN hommes : les autres
// restent dans la rue, sans rien gagner (les avantages vont au prorata des hommes à l'abri)
pub const MAISON_R: f64 = 60.0;
pub const MAISON_CAP_R: f64 = 40.0;
pub const MAISON_MEN: f64 = 25.0;
pub const MAISON_IN: f64 = 40.0;
pub const MAISON_OUT: f64 = 30.0;
pub const MAISON_SEEN: f64 = 120.0; // cachée (si MAISON_HIDE de ses hommes sont à l'abri) : vue à moins de 120 m, ou 60 s après
pub const MAISON_HIDE: f64 = 0.8; // avoir tiré ; on tire par les fenêtres (units.FRONT : 60 % des hommes)
pub const MAISON_MELEE: f64 = 1.6; // au corps à corps, ×1,6 (au lieu de ×1,4 dans le bâti) ; les cavaliers n'y chargent pas
// « Barricader » (ordre 'barricade') : l'infanterie arrêtée, sans ennemi repéré à moins de BARR_FOE, qui a de quoi faire
// (maisons à BARR_HOUSE : charrettes, tonneaux, meubles, portes ; bois à BARR_WOOD : abattis ; sapeurs : partout)
// dresse en BARR_T s (sapeurs BARR_T_SAP, ×BARR_FAT fatigués) une ligne de cases T_BARRICADE à BARR_D m devant son
// front, de sa largeur, sur le découvert et les routes (BARR_ON ; pas dans la zone de déploiement de l'assaillant) ;
// un ennemi à moins de BARR_STOP ou un ordre interrompt le travail. Une barricade par troupe. Cavaliers et canons n'y
// passent pas ; une charge sur la troupe qui est derrière perd BARR_CHOC de son choc et ne la rompt pas ; un boulet qui
// y tombe la renverse BARR_CASSE fois (la case redevient ce qu'elle était)
pub const BARR_FOE: f64 = 200.0;
pub const BARR_STOP: f64 = 150.0;
pub const BARR_HOUSE: f64 = 80.0;
pub const BARR_WOOD: f64 = 40.0;
pub const BARR_T: f64 = 240.0;
pub const BARR_T_SAP: f64 = 120.0;
pub const BARR_FAT: f64 = 1.3;
pub const BARR_D: f64 = 15.0;
pub const BARR_CHOC: f64 = 0.4;
pub const BARR_CASSE: f64 = 0.25;
pub const BARR_AIM: f64 = 80.0; // 'bombard' sur une barricade : les canons battent sa case debout la plus proche du point (chaque
                                // pièce de la batterie y envoie son boulet)
pub const BARR_ON: [i64; 8] = [T_PRE, T_CHAMP, T_VIGNE_T, T_LANDE_T, T_ROUTE, T_CHEMIN, T_SABLE, T_VERGER];
pub const HARASS_NEAR: f64 = 0.8; // harcèlement : on recule devant l'ennemi qui s'approche à moins de 80 % de la portée efficace…
pub const HARASS_FAR: f64 = 1.05; // … et l'on s'avance s'il reste au-delà (jamais plus près que 90 % de la portée efficace)
pub const HARASS_EVERY: f64 = 6.0; // le tirailleur réfléchit toutes les 6 s
pub const COVER_RADIUS: f64 = 140.0; // « se couvrir » : meilleur couvert à moins de 140 m
pub const PURSUIT_RADIUS: f64 = 700.0; // « poursuivre » : fuyards à moins de 700 m
// « Finir automatiquement » : la suite de la bataille est jouée par le moteur, IA contre IA, aussi vite que le serveur
// le permet. Les officiers du joueur commandent au niveau ACCEL_LEVEL (celui de son déploiement de départ : une IA
// correcte, quelle que soit la difficulté, qui ne règle que l'IA adverse) ; pendant l'accéléré, le client ne reçoit
// que les ACCEL_FX derniers effets de chaque réponse (le reste a défilé trop vite pour être vu)
pub const ACCEL_LEVEL: &str = "normal";
pub const ACCEL_FX: i64 = 80;
pub const ACCEL_BUSY: &str = "Vos officiers mènent la bataille : reprenez le commandement pour donner vos ordres.";
py_const!(FCOST_K, dict!{"inf" => 1.0, "light" => 0.6, "cav" => 2.0, "art" => 2.5});
py_const!(WALLISH, dict!{T_MUR => 0.65, T_PORTE => 0.65, T_BRECHE => 0.4, T_BARRICADE => 0.5});
pub const NARROW: [i64; 5] = [T_BATI, T_MUR, T_PORTE, T_BRECHE, T_BARRICADE];
// la brèche est un goulet (l'assaillant sur la brèche ou à une case de ses bords) : on n'y engage pas plus de
// BRECHE_FRONT hommes en mêlée (48 m de décombres : 60 files sur trois rangs), qui s'y battent mal (×BRECHE_MELEE : on
// grimpe sur les éboulis, sous les chevaux de frise) et y prennent les feux croisés des flancs (×BRECHE_FEU) : à
// Badajoz (1812), les colonnes d'assaut y perdirent près d'un homme sur trois
pub const BRECHE_FRONT: f64 = 180.0;
pub const BRECHE_MELEE: f64 = 0.8;
pub const BRECHE_FEU: f64 = 1.4;
// tuple(k for k in range(18) if k not in (T_ROUTE, T_CHEMIN)) : range(18) laisse le verger (18) de côté, tel quel
pub const OFFROAD: [i64; 16] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17];
py_const!(VIEW, dict!{"soleil" => 2000, "nuages" => 1800, "canicule" => 1800, "brouillard" => 250, "pluie" => 600, "orage" => 500,
    "neige" => 800, "tempete" => 700});
// vulnérabilité de la cible selon la formation : au feu de l'infanterie, au boulet, à la mitraille
// (l'ordre dispersé : nettement moins touché par le canon, un peu moins par la fusillade)
py_const!(VUL_FIRE, dict!{"ligne" => 1.0, "colonne" => 1.2, "carre" => 1.3, "tirailleurs" => 0.8, "batterie" => 0.9, "attelee" => 1.2});
py_const!(VUL_BALL, dict!{"ligne" => 0.8, "colonne" => 1.5, "carre" => 1.5, "tirailleurs" => 0.35, "batterie" => 0.6, "attelee" => 1.2});
py_const!(VUL_GRAPE, dict!{"ligne" => 1.0, "colonne" => 1.3, "carre" => 1.3, "tirailleurs" => 0.55, "batterie" => 0.8, "attelee" => 1.0});
py_const!(ARC, dict!{"ligne" => 0.9, "colonne" => 1.0, "carre" => 4.0, "tirailleurs" => 1.6, "batterie" => 0.8, "attelee" => 0.0, "maisons" => 4.0});
py_const!(TURN, dict!{"ligne" => 0.03, "colonne" => 0.12, "carre" => 0.2, "tirailleurs" => 0.1, "batterie" => 0.05, "attelee" => 0.1});
py_const!(FORM_TIME, dict!{"ligne" => 50, "colonne" => 40, "carre" => 60, "tirailleurs" => 45, "batterie" => 60, "attelee" => 60, "maisons" => MAISON_IN});

/// La mitraille est terrible à bout portant ; au-delà de 30 % de sa portée, la gerbe s'ouvre et son effet décroît
/// comme l'inverse de la distance (moitié à 60 % de la portée, 30 % au bout). Sous GRAPE_CLOSE (150 m), la gerbe encore
/// serrée fauche des files entières : ×1,5 à 100 m, ×GRAPE_POINT dès 90 m.
///
/// Python (battle.py, l. 386-393) : `def grape_k(d, grape)`
/// d : distance (m) ; grape : portée de mitraille (m ; l'entier de units::ranges, `as f64`).
pub fn grape_k(d: f64, grape: f64) -> f64 {
    todo!()
}

/// Le boulet perd vite en justesse avec la distance : plein effet jusqu'au quart de la portée efficace, à peu près
/// moitié à la portée efficace, presque rien au bout de la portée maximale.
///
/// Python (battle.py, l. 396-399) : `def ball_k(d, e)`
/// d : distance (m) ; e : portée efficace (m).
pub fn ball_k(d: f64, e: f64) -> f64 {
    todo!()
}

/// Zones de tir d'une unité, pour le client (vue de mes unités) : [[clé, de, à (m), effet], ...], clé 'bout' (ou
/// 'mitraille' pour les canons), 'efficace', 'longue' ; effet : pertes au milieu de la zone sur une ligne à découvert,
/// rapportées à celles du milieu de la première zone (les mêmes formules que _fire : precision, grape_k, ball_k).
///
/// Python (battle.py, l. 402-420) : `def fire_zones(u)`
/// u : unité. Rend une liste de listes [clé (texte), de (entier), à (entier), effet (flottant, 3 décimales)].
pub fn fire_zones(u: &Val) -> Val {
    todo!()
}

/// Python (battle.py, l. 423-424) : `def ang_diff(a, b)`
/// Écart entre deux angles, de 0 à π. Le `%` de Python → `py::mod_f`.
pub fn ang_diff(a: f64, b: f64) -> f64 {
    todo!()
}

/// Python (battle.py, l. 427-429) : `def fmt_hour(clock)`
/// clock : secondes de bataille (0 = START_H). Rend « 8 h 05 » (`//` et `%` : `py::floordiv_i`, `py::mod_i`).
pub fn fmt_hour(clock: f64) -> String {
    todo!()
}

/// Python (battle.py, l. 432-437) : `def move_class(u)`
/// u : unité. Rend 'art', 'cav', 'light' ou 'inf' (les clés de COST et de FCOST_K).
pub fn move_class(u: &Val) -> &'static str {
    todo!()
}

/// Une table de coûts de marche (`costs`) : une case par numéro, `None` infranchissable ; partagée, jamais modifiée
/// une fois faite.
pub type Couts = Rc<Vec<Option<f64>>>;

/// Une bataille tactique. spec : description venue de la campagne (bridge.make_spec) ; units : liste d'Unit.
///
/// Les attributs sont ceux du Python, dans l'ordre de `__init__` ; à la fin, ceux que posent `_zones`,
/// `_refresh_gens` et `finish` (absents en Python tant que ces méthodes n'ont pas tourné : ici `Val::None`).
/// `self.t`, `self.h`, `self.f` ne sont pas repris : ce sont `self.map.t`, `self.map.h`, `self.map.f`.
pub struct TacticalBattle {
    /// dict de bridge.make_spec (le même objet que celui de l'appelant) : bid, seed, cx, cy, season, weather, year,
    /// place, att_angle, owners, names, colors, me, difficulty, title, place_name, fm_swift, art_cheval, marks,
    /// tech, balloon, entrench, shell, umd, plans, lieu, carte… ; posés ensuite : orders, mode, h_off, ai_levels,
    /// ai_tweak, logement, skirmish, sk, date
    pub spec: Val,
    pub bid: String,
    pub geo: Rc<GeoMap>,
    /// la carte de la bataille (TR.generate) ; ses grilles t, h, f sont celles que le Python nomme self.t, self.h, self.f
    pub map: BattleMap,
    /// le temps qu'il fait ('soleil', 'pluie'…) ; il peut tourner pendant la bataille (_wx_turn)
    pub weather: String,
    pub season: String,
    pub difficulty: String,
    /// camp du joueur (None : bataille entre IA)
    pub me: Val,
    /// liste des unités (dict, units.rs)
    pub units: Val,
    /// dict id → unité
    pub by_id: Val,
    /// 'deploiement', 'combat' ou 'fin'
    pub phase: String,
    /// secondes de bataille depuis le début (0 = START_H + spec['h_off'])
    pub clock: f64,
    /// vitesse choisie par le joueur : 0 (pause), 1, 2 ou 4
    pub speed: i64,
    /// numéro du dernier effet ou message (emit, log, _bati_set, _barr_set)
    pub seq: i64,
    /// liste des effets pour le client : dict {k, x, y, t, s, x2?, y2?, n?, u?}
    pub fx: Val,
    /// liste de tuples (seq, side ou None, texte, about ou None)
    pub logs: Val,
    /// None, puis le dict de _result à la fin
    pub result: Val,
    /// liste des camps menés par l'IA
    pub ai_sides: Val,
    /// liste de deux sets : les ids des ennemis que voit chaque camp
    pub seen_by: Val,
    /// liste [bool, bool]
    pub withdrawing: Val,
    /// liste [f64, f64]
    pub withdraw_t: Val,
    pub hold_t: f64,
    /// heure du premier coup des canons de l'assaillant sur le rempart (None : aucun)
    pub siege_t: Val,
    /// liste [f64, f64] : hommes de ce camp faits prisonniers
    pub prisoners: Val,
    /// mémoire de l'IA (types JSON seulement : enregistrée avec la bataille) : dict {'s0': {…}, 's1': {…}}
    pub ai_mem: Val,
    /// « Finir automatiquement » : les officiers jouent la suite en accéléré…
    pub accel: bool,
    /// … avec ces unités du joueur (liste d'ids ; rendues s'il reprend le commandement)…
    pub accel_ids: Val,
    /// … depuis cette heure de bataille
    pub accel_t: f64,
    /// « Donner mes ordres » : la bataille défile, réglée par bridge (orders.py)… (None, ou dict {real, k, skip, until})
    pub replay: Val,
    /// … et s'arrête au moment décisif, en attendant la réponse du joueur (None, ou dict {side, key, text, t})
    pub ask: Val,
    pub _acc: f64,
    pub _vis_t: f64,
    pub _ai_t: f64,
    /// (mc, side) → table de coûts
    pub _cost_cache: HashMap<(String, i64), Couts>,
    /// (mc, side, case de départ, case d'arrivée) → points du chemin
    pub _path_cache: HashMap<(String, i64, i64, i64), Vec<(f64, f64)>>,
    pub _astar_left: i64,
    /// (c1, c2, eye1.to_bits(), eye2.to_bits()) → vue ou non
    pub _los_cache: HashMap<(i64, i64, u64, u64), bool>,
    /// coups encaissés par secteur de l'enceinte (canons de l'assaillant) : dict '0'…'15' → f64 (-1.0 : pan à terre)
    pub pound: Val,
    /// brèches ouvertes pendant la bataille : [mur, x, y, rayon]
    pub breaches: Val,
    /// … et quand : [heure de bataille (s), secteur] (journal des batailles)
    pub breach_t: Val,
    /// la boue laissée par les troupes (image PNG du navigateur, SPEC-SUITE F8) : None ou texte
    pub piet: Val,
    /// état de chaque case bâtie (BATI_*) : 0 intacte, 1 touchée, 2 feu, 3 ruine
    pub bati: Vec<u8>,
    /// … ses changements : [seq, case, état, heure de bataille (s)]
    pub bati_log: Val,
    /// barricades dressées : {u: troupe, s: 'v' ville, 'b' abattis, None terre,
    /// pts: [[x, y], [x, y]], c: [[case, type d'avant], …]}
    pub barr: Val,
    /// … leurs cases posées ou renversées : [seq, case, type, type d'avant]
    pub barr_log: Val,
    /// cases de barricade debout : dict case → type d'avant
    pub barr_prev: Val,
    /// cases en feu : dict case → heure où le feu a pris (parcouru dans l'ordre d'insertion)
    pub feu: Val,
    pub _feu_t: f64,
    /// set des cases bâties à toit de chaume (tests d'appartenance seulement)
    pub chaume: Val,
    /// le hasard de la bataille : Random(spec['seed'] ^ 0x5A5A)
    pub rng: Random,
    /// liste [x, y] : le vent (arrondi à 2 décimales)
    pub wind: Val,
    /// heure de bataille (s) où la nuit tombe
    pub dusk: f64,
    pub light: f64,
    /// la fumée, par carrés de SMOKE_CELL m : SMOKE_COLS * SMOKE_ROWS valeurs
    pub smoke: Vec<f64>,
    pub _smoke_on: bool,
    /// heure de bataille (s) où le temps tournera (None : il ne tournera pas)…
    pub wx_at: Val,
    /// … et le temps qu'il fera alors (None ou texte)
    pub wx_next: Val,
    pub _wx_fire: f64,
    // --- posés par _zones
    /// liste de deux textes : le bord ('O', 'E', 'N', 'S') de chaque camp
    pub edges: Val,
    /// liste de deux listes [x0, y0, x1, y1] : la zone de déploiement de chaque camp
    pub zones: Val,
    /// … et celles de l'IA, plus serrées
    pub ai_zones: Val,
    // --- posés par _refresh_gens (None tant qu'il n'a pas tourné : `hasattr(self, '_gens')`)
    /// liste des états-majors en vie
    pub _gens: Val,
    /// liste [trait ou None, trait ou None]
    pub _traits: Val,
    // --- posés par finish (None avant : `getattr(self, 'winner', None)`)
    pub winner: Val,
    pub disengage: Val,
    pub why: Val,
}

impl TacticalBattle {
    /// Python (battle.py, l. 443-523) : `def __init__(self, geo, spec, units, ai_sides=(0, 1))`
    /// `TacticalBattle(geo, spec, units, ai_sides)` → `TacticalBattle::new(geo, &spec, &units, &ai_sides)`.
    /// geo : la carte de campagne (partagée) ; spec : dict de bridge.make_spec, gardé tel quel (le même objet :
    /// bridge et orders y écrivent ensuite) ; units : liste d'unités (la liste est recopiée, les unités sont les
    /// mêmes objets) ; ai_sides : liste ou tuple des camps menés par l'IA (défaut (0, 1) ; recopié en liste).
    /// Tirages, dans l'ordre : `Random::new(seed ^ 0x5A5A)` (self.rng : un `random()` pour le vent), puis un
    /// `Random::new(seed ^ 0x3C7E)` à part pour le temps (`random()` seulement si WX_CHANGE a ce temps, puis
    /// `uniform`, puis `choice`). `self._zones()` à la fin.
    pub fn new(geo: Rc<GeoMap>, spec: &Val, units: &Val, ai_sides: &Val) -> TacticalBattle {
        todo!()
    }
}
