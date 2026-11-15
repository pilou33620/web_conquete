//! Porte game/tactics/ai.py, lignes 1 à 297 : la docstring du module (l'aide-mémoire de l'IA, plus bas) et les
//! constantes. Les constantes sont portées ; les corps des fonctions sont dans les parties ci-dessous.
//!
//! Les fonctions sont réparties, dans l'ordre du Python, entre :
//! - `deploiement.rs` (l. 298-1294) : outils ; lecture du terrain ; plan ; déploiement ; places ;
//! - `reflexion.rs` (l. 1295-2005) : réflexion ; réflexes ; réflexion lourde ;
//! - `ligne.rs` (l. 2006-2796) : rase campagne (la ligne : phases et bonds, ruses, canons à enlever, réserves,
//!   réoccupation) ;
//! - `manoeuvres.rs` (l. 2797-3774) : rase campagne (légers, débordement) ; attaque en rase campagne : point de
//!   rupture, masse, poursuite ; place : défense ; place : assaut ;
//! - `armes.rs` (l. 3775-4722) : soutiens : général, chariot, ralliés ; cavalerie ; baïonnette ; artillerie ;
//!   exécution.
//! Toutes sont réexportées ici : `AI.xxx(…)` du Python s'écrit `crate::tactics::ai::xxx(…)`.
//!
//! Conventions de ce squelette (en plus de PORTAGE.md et de l'en-tête de battle/mod.rs) :
//! - `b` : la bataille, `&mut TacticalBattle` ; `&TacticalBattle` pour une lecture pure (ni la bataille ni la mémoire
//!   modifiées). Une fonction qui reçoit `&TacticalBattle` n'appelle que des méthodes `&self` de la bataille : los,
//!   los_units, passable, path_cost, best_spot, `r#trait`, general_near… sont `&mut self` (caches).
//! - `side` : 0 l'assaillant, 1 le défenseur ; `1 - side` l'ennemi.
//! - une unité (`u`, `e`, `v`, `o`, `t`, `c`, `f`, `tg`, `tgt`, `cur`, `wagon`, `g` dans `_fetch`) : un dict `Val`
//!   (units.rs) ; son id (`u.id`, `uid`, `gid`, `tid`) : un `Val` (texte), la clé des dict de la mémoire.
//! - `mem` : la mémoire du camp, le dict `b.ai_mem['s0' | 's1']` (`_mem`), en types JSON, `&Val` (le même objet : on
//!   l'écrit en place) ; ses clés : voir deploy et _adopt (role, lat, back, wing, post, vu, vu0, sq, fm, gslot…).
//! - `L` : les réglages du niveau (un dict de LEVELS, rendu par `_lvl`), `&Val`.
//! - `us`, `foes`, `cavs`, `line`, `ours`, `e_cav`, `seen`, `assault` : des listes d'unités, `&Val` (`us` :
//!   `b.ai_units(side)` ; `foes` : `b.visible_enemies(side)`) ; `g` (déploiement) : les groupes de `_groups`.
//! - `sit` : la situation (`_situation`), un dict ; `want` : dict id → [x, y, dir, forme ou None, au pas de course] ;
//!   `busy` : set des ids qui ont reçu leur ordre à cette réflexion (appartenance seulement) ; `pl` : `b.place_info()`.
//! - `body` : `&[Repere]` (`_body`) ; les batteries ennemies connues : `Vec<Canon>` (`_gun_zones`) ; les ennemis
//!   repérés récemment : `Vec<Cible>` (`_known_targets`).
//! - un point : `(f64, f64)` ; ce qui peut valoir None (un point, un nombre, une unité, une cible) : `Val` (`tup![x, y]`,
//!   `Val::None`) ; un paramètre qui peut recevoir None : `&Val`.
//! - un ordre : `b.order(side, &list![u.at("id")], "charge", "ia", &dict!{"target" => e.at("id")})` (le `who` du
//!   Python vaut 'ia' par défaut : le passer) ; `b.order(…)[0]` → `.0`.
//! - `x ** 2` (même entre entiers) → `py::pow(x, 2.0)` ; `math.hypot` → `py::hypot` ; `sum` → `py::sum` ;
//!   `min` / `max` à clé → `py::min_by_key` / `py::max_by_key` ; `sorted(…, reverse=True)` → `py::sorted_by_key_rev`.
//!
//! ==================================================================================================================
//! La docstring de ai.py
//! ==================================================================================================================
//! IA de combat des batailles tactiques.
//!
//! Deux points d'entrée, appelés par le moteur (battle.py) et le raccord de campagne (bridge.py) :
//! - deploy(battle, side) : déploiement selon la mission et le terrain, et choix du plan de bataille (sert aussi de
//!   placement de départ au camp du joueur, au niveau normal) ;
//! - think(battle, side, dt) : appelée toutes les 2 s de bataille. Réflexes (carré face à une vraie charge, ralliement,
//!   contre-charge) et réflexion « lourde », plus espacée selon le niveau : situation, plan, phases, ordres de chaque unité,
//!   donnés seulement quand ils changent quelque chose (les longues marches par étapes : le moteur ne cherche que des
//!   chemins courts).
//!
//! Déploiement
//! - Rase campagne : la ligne d'infanterie au centre ; pour le défenseur, sur la meilleure ligne de sa zone (hauteur,
//!   haies et murets, champ de tir dégagé devant) ; chaque bataillon cherche sa haie ou sa crête à quelques dizaines de
//!   mètres, les meilleurs au centre. Canons un peu en arrière, sur une hauteur qui voit loin, de préférence dans les
//!   vignes ou en lisière (la cavalerie y charge mal ; en difficile, cachés en lisière de bois). Légers en avant, dans les
//!   bois, les vignes, le bâti. Cavalerie aux ailes (davantage sur l'aile du débordement ; une réserve de cavalerie en
//!   difficile). Réserve d'infanterie en colonne derrière le centre (grenadiers d'abord ; sapeurs et gardes nationaux y
//!   restent). État-major derrière le centre, chariot à l'abri derrière.
//! - Défense d'une place : deux bataillons solides de part et d'autre de chaque brèche, à l'intérieur et à l'abri du mur
//!   (les canons du dehors ne les voient pas ; les colonnes qui passent sont prises entre deux feux), les autres et les
//!   légers le long des remparts face à l'assaillant (ils tirent par-dessus le mur), les canons au rempart, la milice dans
//!   les rues et au cœur de la place, une réserve et la cavalerie au cœur. On ne la quitte pas. Normal et difficile :
//!   un bataillon retranché 110 m derrière chaque brèche (la coupure de Vauban), les maisons à tenir repérées (îlots).
//! - Assaut d'une place : colonnes d'assaut face à la brèche principale (ou au point le plus proche de l'enceinte ; un
//!   village barricadé, par une de ses entrées), seconde vague derrière, diversion face à une autre face (une autre entrée
//!   du village), batteries de brèche (la moitié des pièces, les meilleures ; une seule en facile) postées hors de portée
//!   des fusils du rempart et qui battent un seul point au pied du mur (ordre 'bombard'), les autres canons en contre-
//!   batterie, une garde de tranchée devant les batteries de brèche (normal, difficile), cavalerie en réserve.
//!
//! Plans (repris de la campagne quand c'est possible : spec['plans'], voir rules.PLANS ; sinon selon le rapport des
//! forces annoncé, la mission, l'armement et le trait du général : cavalier → débordement, artilleur → artillerie,
//! prudent → harcèlement plus tôt, audacieux → contre-offensive plus tôt)
//! - frontal : courte préparation d'artillerie, puis la ligne avance par bonds, s'arrête à portée efficace et fait feu,
//!   puis charge à la baïonnette ; la manœuvre suit la doctrine de l'époque (_era : l'armement décide, pas l'année seule) :
//!   ordre linéaire (feu de bataillon, puis la réserve sur le point faible), colonnes et tirailleurs (grande batterie et
//!   masse sur le point de rupture), le feu d'abord en 1870 (le feu fixe le centre, la réserve enveloppe une aile) ;
//! - artillerie : la même chose après une longue préparation ;
//! - debordement : la cavalerie de l'aile et les légers tournent le flanc le plus dégagé et prennent l'ennemi de flanc et
//!   de dos pendant que le centre le fixe ; ils reviennent sur l'aile si des cavaliers plus nombreux leur barrent la route ;
//! - tenir : défense de la position et usure de l'assaillant (défense vivante, ci-dessous) ; retour offensif quand
//!   l'attaque s'essouffle, contre-attaque générale quand il flanche ;
//! - harcelement : escarmouche à longue portée (canons, légers), puis retraite (quand on est nettement inférieur) ;
//! - assaut : assaut d'une place (une heure de canonnade sur la brèche (40 min en facile, 70 en difficile ; moitié moins
//!   contre un village, sans attendre de brèche), diversion (une vraie seconde attaque contre un village), enfants perdus
//!   (les légers) en tête, puis les colonnes deux par deux, quand les défenseurs sont usés, puis le cœur : on charge à la
//!   baïonnette ceux qui le tiennent encore (cavaliers compris ; une charge arrêtée court est relancée), on fusille les
//!   autres ; la brèche emportée, un bataillon d'assaut s'y loge (ordre « tenir », gabions et sacs à terre :
//!   battle.LOGEMENT_K) et la garde même si l'assaut reflue, la garnison l'en chasse à la baïonnette (_lodge,
//!   _breach_counter) ; les fuyards ralliés retournent à l'assaut en cours ; nouvelle vague si l'assaut est repoussé ou si tout
//!   piétine, après un vrai regroupement ; repoussé sans plus de vague : la place est investie (les batteries battent toujours le mur), un
//!   dernier assaut si une brèche neuve s'ouvre ou si la garnison est épuisée, sinon on se retire dans les lignes au bout
//!   de 30 min (1 h si les batteries peuvent encore ouvrir une brèche ; à la tombée de la nuit au plus tard) ;
//! - place : défense d'une place (brèche neuve : flanquée et retranchée ; contre-attaque à la baïonnette dans la brèche,
//!   sans poursuivre ; sorties contre les batteries isolées avant l'assaut ; maison par maison quand l'ennemi est dans les
//!   rues ; le cœur jamais dégarni).
//!
//! Pendant la bataille
//! - Ligne : avance par bonds en attendant ses retardataires (réglés sur la ligne ennemie, pas sur son écran de
//!   tirailleurs, qui se replie devant elle) ; colonne pour marcher loin du feu, ligne sous le feu, ou ordre
//!   dispersé (nettement moins de pertes au canon, un peu moins au fusil) tant qu'aucun cavalier ennemi ne rôde, pour la
//!   ligne de l'assaillant seulement au temps du fusil rayé ; elle attend la fin de la préparation hors de portée du fusil
//!   ennemi (1,3 fois sa portée efficace : 710 m devant le Chassepot) ; en 1870, ligne de tirailleurs par bonds courts
//!   sous le feu (par moitiés en difficile : l'une tire pendant que l'autre bondit) ; un bataillon qui ne voit pas
//!   l'ennemi embusqué (bois, bâti) depuis 10 min s'avance jusqu'à le voir ; la ligne ennemie dérobée à la vue, on marche
//!   sur sa dernière position connue ;
//!   arrêt à portée efficace, chaque bataillon réglant sa distance sur l'ennemi d'en face et cherchant un couvert ;
//!   jamais dans la mitraille meurtrière d'une batterie ennemie connue (60 % de sa portée : au-delà, la gerbe s'ouvre ;
//!   terrible sous 150 m) ; baïonnette après un quart d'heure de fusillade quand le corps à corps est favorable (et contre
//!   l'ennemi ébranlé, pris de flanc, ou des canons sans soutien, pas de face s'ils sont en ordre : leur mitraille à bout
//!   portant coûte très cher) ; une batterie qui interdit l'approche est enlevée à la baïonnette, de flanc de préférence
//!   (de face : seulement ébranlée, réduite, ou à quatre contre un) ; assaillant :
//!   baïonnette selon l'époque : 20 min de feu et 1,5 contre 1 dans l'ordre linéaire, 10 min et 1,15 au point de
//!   rupture, jamais contre une troupe fraîche au temps du fusil rayé ; en débordement, la ligne fixe par son feu
//!   jusqu'à ce que le groupe de flanc ait pris l'ennemi de flanc ; si plus
//!   rien ne bouge pendant trois quarts d'heure, ou si la ligne ne tire plus depuis une demi-heure sans que l'ennemi
//!   perde rien : assaut général (sans plus craindre la mitraille) quand on n'est pas nettement plus faible, renouvelé
//!   tant qu'on est nettement plus fort ; sinon on décroche.
//! - Carré seulement face à une vraie charge (cavaliers qui chargent ou arrivent droit sur nous, par un chemin praticable),
//!   rompu dès que la menace passe (le canon ravage les carrés) ; pas de carré à moins de 200 m de l'infanterie ennemie
//!   (il y serait fusillé) sauf si les cavaliers chargent cette troupe même, ni quand une ligne ferme voit venir la charge
//!   de face (son feu de défense la repousse).
//! - Point de rupture (normal, difficile) : le secteur ennemi le moins solide (effectif, moral, couvert, voisins, distance,
//!   mitraille qui le couvre), choisi une fois (revu toutes les 5 min en difficile) ; les batteries y concentrent leur
//!   feu (×1,6, ×2 en difficile) et, sous l'Empire, s'y serrent en grande batterie ; quand le secteur est usé (moral sous
//!   70, pertes de 15 %, brèche ouverte, ou 25 min de fusillade), la masse (réserve fraîche, grenadiers d'abord, un
//!   bataillon gardé pour les trous) s'y jette en colonne derrière un rideau de tirailleurs, se déploie à bonne distance
//!   et charge, pendant que la ligne fixe l'ennemi (pas d'assaut général tant qu'elle est engagée) ; en 1870 elle va
//!   envelopper l'aile ennemie la moins couverte, en tirailleurs ; repoussée, elle revient en réserve ; le point emporté,
//!   elle prend place dans la ligne ; la cavalerie de réserve attend derrière le point et exploite (rayon de charge
//!   élargi) ; une ou deux masses par bataille.
//! - Poursuite (normal, difficile) : la cavalerie fraîche court sus aux fuyards sans soutien (600 m, 700 m en difficile),
//!   la moitié des escadrons au plus, un quart d'heure au plus.
//! - Cavalerie : charges choisies (artillerie sans soutien, fuyards, chariot, état-major, de flanc ou de dos, ennemi
//!   ébranlé ou en tirailleurs, jamais un carré ni une ligne fraîche de face), sur un chemin libre ; contre-charges avec
//!   assez d'escadrons, loin de l'infanterie ennemie ; postes d'attente hors de portée des canons ennemis.
//! - Artillerie : emplacements qui voient l'ennemi connu, à 85 % de la portée efficace pendant la préparation, plus près
//!   ensuite ; mitraille hors de portée des fusils ennemis quand nul cavalier ne rôde ; batterie aveugle déplacée ; cibles :
//!   colonnes, carrés, canons qui menacent nos lignes, cavaliers, chariot ; recomplètement au chariot.
//! - Réserves : combler un trou, relever un bataillon épuisé, ébranlé ou sans cartouches (qui va se recompléter au
//!   chariot), couvrir un flanc débordé, soutenir une batterie menacée, contre-attaquer une percée, prolonger la ligne
//!   débordée (difficile) ; ralliés reformés près du général. Général et chariot derrière le secteur qui en a besoin,
//!   abrités derrière un bataillon quand des cavaliers rôdent.
//! - Fuyards : le moteur ne les rallie qu'auprès d'un général. Le général (normal, difficile) va au-devant d'eux sur
//!   leur chemin de fuite, hors de portée de fusil (330 m de l'ennemi repéré), s'il peut y aller sans passer sous le feu
//!   ni croiser des cavaliers ennemis (jusqu'à 900 m, 1 200 m en difficile) ; les réflexes les rallient dès qu'il est
//!   auprès d'eux. Facile le laisse à son poste.
//! - Défense vivante (le défenseur en rase campagne, normal et difficile ; selon l'époque : 0 avant 1789, 1 Révolution
//!   et Empire, 2 fusil rayé) : la ligne ne quitte son poste que pour une contre-attaque locale à la baïonnette sur un
//!   bataillon assaillant qui flotte (aux prises, ébranlé sous le moral où l'on reçoit une charge en ordre, sans
//!   cartouches, décimé, pris de flanc), à 160 m au plus de lui et 260 m de son poste, un bataillon sur trois à la fois,
//!   jamais sous la mitraille ni avec des cavaliers ennemis tout près ; elle revient à son poste quand la cible fuit
//!   (pas de poursuite). La réserve en colonne enfonce l'assaillant arrêté devant la ligne (le « moment décisif ») et va
//!   reprendre un poste perdu (haie, muret, maisons, couvert). Plus exigeante en 1700 (la cavalerie y fait l'essentiel),
//!   courte en 1870 et seulement contre un ennemi déjà vaincu. La ligne attend en ligne et fait feu de salve avant 1850
//!   (sous l'Empire, en tirailleurs seulement tant que l'assaut est à plus de 300 m) ; en 1790-1849, contre-pente à la
//!   Wellington : à l'abri derrière la crête, sur la crête quand l'assaut vient. Écran de tirailleurs à 1,6 fois leur
//!   portée devant la ligne (110 à 160 m dans les couverts en 1700, 450 à 550 m en 1870) : il recule d'un palier devant
//!   l'infanterie en ordre, droit aux ailes devant des cavaliers, se reporte en avant quand l'assaut reflue, harcèle les
//!   canonniers sans soutien. La cavalerie tombe sur l'infanterie qui charge les nôtres, qui est aux prises avec eux ou
//!   qui fuit près de la ligne (si elle n'est pas escortée), préfère les troupes en marche, sans cartouches ou prises sous
//!   notre fusillade (×0,4 contre l'infanterie en ordre en 1870), ne s'aventure pas à plus de 550 m devant la ligne et
//!   revient s'y reformer au galop. Retour offensif quand l'assaut est venu, qu'il reflue depuis 5 min (3 en difficile),
//!   que nos troupes tiennent, qu'il nous reste des troupes fraîches et que l'assaillant montre deux signes d'épuisement
//!   (pertes, moral, fuyards, feu éteint) ; deux au plus par bataille, arrêté s'il coûte trop, s'aventure sous les canons
//!   ou s'enlise : la ligne reprend alors ses postes.
//! - Arrière-garde (normal, difficile) : quand l'armée décroche, deux escadrons et un bataillon frais tiennent 150 m
//!   en arrière de l'ancre, chargent les cavaliers qui talonnent la retraite et l'infanterie qui marche à découvert,
//!   puis filent à leur tour (10 min, 15 en difficile, ou plus tôt s'ils sont trop éprouvés) ; pas dans une déroute.
//! - Décrochage en bon ordre quand la bataille est perdue (pertes, rapport de forces vu, moral, nuit), jamais pour le
//!   défenseur d'une place : passé wd_loss de pertes (les troupes en déroute comptent pour moitié) si l'ennemi est nettement
//!   plus fort, ou passé wd_loss + 7 % dans un combat égal ; l'assaillant qui mène l'attaque accepte 5 % de plus.
//!   Obstination selon la situation (_tenacity, TEN_*) : on accepte jusqu'à 18 % de pertes de plus quand on a l'avantage
//!   (l'ennemi a perdu plus d'hommes que nous, à l'aune de l'échange ordinaire où l'assaillant perd 20 % de plus ; rapport
//!   de forces vu favorable ; ennemi en déroute ou ébranlé ; réserves fraîches) ou qu'on tient une bonne position en
//!   défense (crête, haies, murets, bois, bâti) ; sans rien de tout cela, on décroche 3 % plus tôt.
//! - Reprise en cours de bataille (« Finir automatiquement », _adopt) : chacun garde sa place ; en défense, les réglages
//!   du déploiement reviennent d'après la situation (_adopt_def) : écran de tirailleurs et batteries des ailes en feux
//!   croisés si l'ennemi est encore à plus de 900 m, contre-pente, feu de salve.
//!
//! Niveaux (battle.difficulty ; spec['ai_levels'] = [niveau du camp 0, du camp 1] et spec['ai_tweak'] pour les essais).
//! Ils ne changent que la qualité des décisions, jamais les dégâts :
//! - facile : prudente et maladroite : réfléchit toutes les 20 à 32 s, réflexes lents (6 s), ne lit pas le terrain, marche
//!   sans attendre les retardataires et reste en colonne trop longtemps, s'arrête à une mauvaise portée, voit tard les
//!   cavaliers et oublie parfois le carré, charge sans discernement, ne contre-charge pas, choisit mal les cibles de ses
//!   canons, engage sa réserve d'emblée, ne surveille pas ses flancs, ne relève personne, décroche tôt ; en défense, ni
//!   contre-attaques choisies, ni écran, ni contre-pente, ni retour offensif, ni arrière-garde ;
//! - normal : correcte : terrain, cohésion, carrés, charges choisies, contre-charges, mitraille prudente, ordre dispersé,
//!   réserves pour les trous, les relèves et les flancs, batteries enlevées à la baïonnette ;
//! - difficile : réfléchit toutes les 6 s ; s'arrête à pleine portée efficace et avance par bonds réguliers ; terrain plus
//!   fouillé (crêtes, haies, lisières, canons cachés) ; attend que l'artillerie ait ébranlé l'ennemi ; réserves qui
//!   prolongent une ligne débordée et contre-attaquent les percées ; légers qui prennent l'ennemi de flanc ; cavalerie
//!   qui ne s'expose pas aux contre-charges ; contre-offensive plus tôt ; le général va chercher ses fuyards plus loin ;
//!   en défense, contre-attaques locales un peu plus tôt et plus loin (les voisins suivent), retour offensif plus prompt,
//!   arrière-garde plus longue.
//!   (Attaque en rase campagne : les clés rupture, pt_k, pt_every, masse_mor, masse_n, exploit_k, bound_feu, halves,
//!   pursue_r et aveugle de LEVELS ; rupture=False ou masse_n=0 les éteignent. Banc à une graine, parité, IA normale des
//!   deux côtés : l'assaillant gagnait 0 batailles en rase campagne sur 8 avant ce volet, 3 après (à deux graines, 4
//!   sur 16, avec ou sans « aveugle » ; toujours aucune en 1870). Ni échelons de Frédéric, ni attaque des points d'appui, ni défilement pendant la
//!   préparation, ni batterie volante : spécifiés (tasks/todo-ia-bataille.md), pas réalisés.)
//!   (Défense vivante : les clés ca_*, res_ca, cav_opp, screen, ro_*, cp, breach_ca, retake, rg, rg_t, volley_def et xfire de
//!   LEVELS ; ca_thr=99 ou ro_k=99 les éteignent pour les essais. Compteurs dans mem['stats'].)
//!   (Places : les clés batter, forlorn, div_lead, bonus_wave, garde, sortie, b_counter, coupure, breach_volley et ilots de
//!   LEVELS ; facile n'a ni enfants perdus, ni brèche neuve, ni garde, ni sortie, ni coupure, ni îlots. Banc à une graine :
//!   avant ce volet, 4 assauts de place sur 8 allaient jusqu'à la nuit ; après, aucun : tous décidés en 2 h 30 à 6 h,
//!   mais l'assaillant n'emportait jamais la place : dans le cœur, ses colonnes fusillaient les maisons sans y entrer,
//!   ignoraient les cavaliers qui le gardaient, ne relançaient pas une charge arrêtée court, et ses fuyards ralliés
//!   attendaient la vague suivante. Corrigé : 4 places prises sur 24 au banc à trois graines, 4 sur les 8 où la brèche
//!   est abordable et l'assaillant nettement plus nombreux, aucune contre une garnison presque aussi forte que lui ; la
//!   graine 2 a une place cernée d'eau, où les colonnes n'abordent pas.
//!   Ni attaque à l'aube, ni escalade de diversion, ni redoutes tenues, ni cavalerie hors du
//!   village, ni choix de cibles propre aux canons du rempart : spécifiés, pas réalisés.)
//!   (L'ordre oblique a été retiré, et les essais d'aile refusée, d'attaque concentrée de flanc au bout de l'aile ennemie
//!   et de contre-batterie d'abord n'ont pas été gardés : sur 96 batailles chacun, ils faisaient perdre l'assaillant plus
//!   souvent ; voir le rapport de mise au point.)
//!
//! Vue : l'IA ne lit que les ennemis repérés par son camp (battle.visible_enemies) et sa mémoire de ce qu'elle a vu
//! (positions, effectifs, état ; batteries et leur portée de mitraille), plus ce que le joueur sait aussi : le terrain
//! (brèches comprises), les zones de déploiement, l'effectif de départ annoncé par les éclaireurs, et ce que la vue du
//! client montre des unités repérées (formation, moral, portées). Sa mémoire (battle.ai_mem['s0' | 's1']) ne contient que
//! des types JSON : elle est enregistrée avec la bataille. Le journal des grands moments (mem['journal']) sert aux
//! comptes rendus.
#![allow(unused_variables, unused_imports)] // (squelette : à retirer une fois les corps écrits)

mod deploiement;
mod reflexion;
mod ligne;
mod manoeuvres;
mod armes;

pub use deploiement::*;
pub use reflexion::*;
pub use ligne::*;
pub use manoeuvres::*;
pub use armes::*;

use crate::py::{self, Random, Val};
use crate::tactics::battle::{self as BT, TacticalBattle};
use crate::tactics::orders as OR;
use crate::tactics::units as U;
use crate::tactics::terrain::{
    CELL, COLS, H, T_BARRICADE, T_BATI, T_BOIS, T_BRECHE, T_FORET_T, T_MARAIS_T, T_MUR, T_PORTE, T_ROCHE, T_VIGNE_T, W,
};
use crate::{dict, list, py_const, pyset, tup};

pub const WOODS: [i64; 2] = [T_BOIS, T_FORET_T];
pub const ROUGH: [i64; 9] = [T_BOIS, T_FORET_T, T_MARAIS_T, T_VIGNE_T, T_BATI, T_MUR, T_PORTE, T_BRECHE, T_BARRICADE];
pub const SCREEN: [i64; 5] = [T_BOIS, T_FORET_T, T_BATI, T_MUR, T_PORTE];
pub const WALLS: [i64; 4] = [T_MUR, T_PORTE, T_BRECHE, T_BARRICADE];
// vulnérabilité des cibles au boulet et à la mitraille (celle du moteur) : pour choisir les cibles des canons
py_const!(BALL, BT::VUL_BALL()); // (le même objet que battle::VUL_BALL)
py_const!(GRAPE, BT::VUL_GRAPE());
py_const!(DOCTRINE, tup!["ordre linéaire", "colonnes et tirailleurs", "le feu d'abord, en ordre dispersé"]);
py_const!(MANOEUVRE, tup!["feu de bataillon, puis la réserve jetée sur le point faible",
    "grande batterie et colonnes sur le point de rupture",
    "le feu fixe le centre, la réserve enveloppe l'aile ennemie"]);
py_const!(PLAN_LABEL, dict!{"frontal" => "assaut frontal coordonné", "artillerie" => "préparation d'artillerie, puis assaut",
    "debordement" => "débordement par un flanc", "tenir" => "tenir la position et user l'adversaire",
    "harcelement" => "escarmouche, puis retraite", "assaut" => "assaut de la place", "place" => "défense de la place"});
py_const!(WING, dict!{-1 => "l'aile gauche", 1 => "l'aile droite", 0 => "la réserve"});
pub const LEG: f64 = 450.0; // une longue marche se donne par étapes (recherches de chemin courtes)
// hauteurs pour la vue (celles du moteur) : les canons (officiers à cheval) voient par-dessus les haies proches
py_const!(EYES, BT::HEIGHT()); // (le même objet que battle::HEIGHT)
pub const GUN_EYE: f64 = 3.0; // EYES['artillerie']
// la mitraille ne fait de vrais ravages qu'à moins de 60 % de sa portée (le moteur l'éparpille au-delà : battle.grape_k),
// et elle est terrible sous 150 m (×1,5 à 100 m, ×1,6 dès 90 m : battle.GRAPE_CLOSE) : c'est cette zone (plus 40 m) que la
// ligne évite ; une batterie en ordre ne s'aborde pas de face (_gun_front), sauf déjà ébranlée ou en nombre
pub const GRAPE_DEADLY: f64 = 0.6;
// maisons et barricades (battle.py, ordres 'maisons' et 'barricade') : la garnison d'une place (rues, cœur, îlots)
// entre dans les maisons quand l'ennemi repéré est à moins d'ABRI_FOE ; l'infanterie du défenseur que des cavaliers
// ennemis menacent (à moins de la moitié d'ABRI_CAV, ou qui marchent droit sur elle à moins d'ABRI_CAV) se barricade
// quand le moteur le permet (pas les légers, qui vont et viennent devant la ligne) ; l'assaillant ne se barricade
// jamais
pub const ABRI_FOE: f64 = 600.0;
pub const ABRI_CAV: f64 = 800.0;
py_const!(ABRI_ROLES, tup!["rue", "coeur", "ilot"]);
pub const ABRI_PART: i64 = 3; // au plus une barricade pour trois bataillons d'infanterie de ligne du camp (au moins une)
// devant une barricade dressée pendant la bataille (_barrage) : les canons la battent jusqu'à y ouvrir une brèche
// (BARR_GUN : nos fantassins à moins de 500 m devant elle, à portée efficace) ; la cavalerie ne charge jamais la troupe
// qui est derrière (ni celle des maisons) : elle la prend par un bout ou par la brèche s'il y a la place, sinon elle
// attend ; l'infanterie passe par la brèche, sinon par un bout quand la barricade ne ferme pas le passage, sinon ne
// l'aborde de face qu'à BARR_SUP contre un au corps à corps (la barricade comptée : ×1,5)
pub const BARR_GUN: f64 = 500.0;
pub const BARR_SUP: f64 = 1.5;
pub const BARR_OFF: f64 = 60.0;

// l'assaillant qui mène l'attaque (plans frontal, artillerie, débordement) ne décroche qu'avec ce supplément de pertes :
// il sait qu'on n'emporte pas une position sans le payer (même valeur à tous les niveaux)
pub const ATT_TENACITY: f64 = 0.05;
// combat égal qui s'éternise : passé wd_loss + WD_EVEN_LOSS de pertes, on cède si le rapport de forces vu est sous
// wd_ratio + WD_EVEN
pub const WD_EVEN_LOSS: f64 = 0.07;
pub const WD_EVEN: f64 = 0.2;
pub const FIRE_LONG: f64 = 900.0; // durée de fusillade avant la baïonnette à forces égales (s)
pub const FIRE_LONG_D: [f64; 3] = [1200.0, FIRE_LONG, FIRE_LONG]; // selon l'époque (_era) : ordre linéaire, Empire, fusil rayé
pub const FIRE_RATIO: [f64; 3] = [1.5, 1.3, 1.3]; // rapport des forces au corps à corps voulu après la fusillade
// assaut d'une place : vagues de plus après la première, au plus (avec les troupes ralliées depuis, qui ne restent plus
// en réserve : une seule suffit, deux feraient tomber les places bien plus souvent qu'avant)
pub const ASSAULT_WAVES: i64 = 1;
pub const BREACH_WAIT: f64 = 1.8; // assaut d'une place : sans brèche, on attend jusqu'à 1,8 fois la préparation avant d'escalader
// obstination selon la situation (_tenacity) : supplément de pertes accepté avant de décrocher quand l'ennemi a perdu
// plus que nous (tués, blessés, prisonniers, à l'aune d'EXCHANGE : TEN_TRIED_K fois l'écart, au plus TEN_TRIED), quand le
// rapport de forces vu est favorable, quand l'ennemi a des troupes en déroute ou est ébranlé, qu'il nous reste des
// réserves fraîches, que la ligne du défenseur tient une bonne position ; au plus TEN_MAX en tout. Rien de tout cela :
// on décroche plus tôt (TEN_NONE)
pub const EXCHANGE: f64 = 1.2; // (l'assaillant perd d'ordinaire 20 % de plus que le défenseur à couvert)
pub const TEN_TRIED: f64 = 0.12;
pub const TEN_TRIED_K: f64 = 2.0;
pub const TEN_RATIO: f64 = 0.03;
pub const TEN_ROUT: f64 = 0.03;
pub const TEN_RES: f64 = 0.03;
pub const TEN_POS: f64 = 0.04;
pub const TEN_MAX: f64 = 0.18;
pub const TEN_NONE: f64 = -0.03;
// le général va chercher ses fuyards jusqu'à FETCH_REACH (m) selon le niveau (facile : il ne bouge pas), sans
// s'approcher à moins de FETCH_SAFE de l'ennemi repéré (hors de portée de fusil)
pub const FETCH_REACH: [f64; 3] = [0.0, 900.0, 1200.0];
pub const FETCH_SAFE: f64 = 330.0;

// réglages des trois niveaux (voir « Niveaux » dans la docstring) : des entiers, des flottants, des booléens et le
// tuple halt, tels que le Python les écrit (`L.at("n").i()`, `L.atf("bound")`, `L.getb("cohesion")`)
py_const!(LEVELS, dict!{
    "facile" => dict!{
        "n" => 0, "period" => 20.0, "jitter" => 12.0, "reflex" => 6.0, "sq_r" => 210.0, "sq_miss" => 0.3,
        "sq_late" => true, "terrain" => 0, "cohesion" => false, "bound" => 600.0, "halt" => tup![0.5, 1.45],
        "prep" => 300, "prep_max" => 480, "cav_r" => 330.0, "cav_pick" => false, "counter" => false,
        "col_late" => true, "res_early" => true, "flank" => false, "relief" => false, "art_pick" => false,
        "wd_loss" => 0.18, "wd_ratio" => 0.95, "harass" => 0.8, "counter_k" => 99.0, "gen_move" => false,
        "grape" => 0, "assault_prep" => 2400, "span" => 0, "r_k" => 1.0, "wood" => false, "skirm" => 0,
        "cav_safe" => false, "storm" => false, "extend" => false, "flankfire" => false, "ten_k" => 0.0,
        "ca_thr" => 99.0, "ca_reach" => 120.0, "ca_mor" => 50, "ca_cool" => 300.0, "res_ca" => false,
        "cav_opp" => false, "screen" => 0, "ro_k" => 99.0, "ro_ebb" => 300.0, "ro_stop" => 0.06, "ro_depth" => 600.0,
        "cp" => 0, "breach_ca" => false, "retake" => false, "rg" => false, "rg_t" => 600.0, "volley_def" => false,
        "xfire" => false, "rupture" => false, "pt_k" => 1.0, "pt_every" => 0.0, "masse_mor" => 0, "masse_n" => 0,
        "exploit_k" => 1.0, "bound_feu" => 600.0, "halves" => false, "pursue_r" => 0.0, "batter" => 0.0,
        "forlorn" => 0.0, "div_lead" => 150.0, "bonus_wave" => 0, "garde" => false, "sortie" => 0, "b_counter" => 0.0,
        "coupure" => 0, "breach_volley" => false, "ilots" => 0,
    },
    "normal" => dict!{
        "n" => 1, "period" => 10.0, "jitter" => 4.0, "reflex" => 2.0, "sq_r" => 330.0, "sq_miss" => 0.0,
        "sq_late" => false, "terrain" => 1, "cohesion" => true, "bound" => 220.0, "halt" => tup![0.82, 0.92],
        "prep" => 720, "prep_max" => 1500, "cav_r" => 430.0, "cav_pick" => true, "counter" => true,
        "col_late" => false, "res_early" => false, "flank" => true, "relief" => true, "art_pick" => true,
        "wd_loss" => 0.22, "wd_ratio" => 0.8, "harass" => 0.6, "counter_k" => 2.0, "gen_move" => true, "grape" => 1,
        "assault_prep" => 3600, "span" => 30, "r_k" => 1.0, "wood" => false, "skirm" => 2, "cav_safe" => false,
        "storm" => true, "extend" => false, "flankfire" => false, "ten_k" => 1.0, "ca_thr" => 1.0,
        "ca_reach" => 160.0, "ca_mor" => 60, "ca_cool" => 240.0, "res_ca" => true, "cav_opp" => true, "screen" => 1,
        "ro_k" => 1.0, "ro_ebb" => 300.0, "ro_stop" => 0.06, "ro_depth" => 600.0, "cp" => 1, "breach_ca" => true,
        "retake" => true, "rg" => true, "rg_t" => 600.0, "volley_def" => true, "xfire" => true, "rupture" => true,
        "pt_k" => 1.6, "pt_every" => 0.0, "masse_mor" => 70, "masse_n" => 1, "exploit_k" => 1.3, "bound_feu" => 150.0,
        "halves" => false, "pursue_r" => 600.0, "batter" => 0.5, "forlorn" => 60.0, "div_lead" => 150.0,
        "bonus_wave" => 1, "garde" => true, "sortie" => 1, "b_counter" => 300.0, "coupure" => 1,
        "breach_volley" => false, "ilots" => 2,
    },
    "difficile" => dict!{
        "n" => 2, "period" => 6.0, "jitter" => 0.0, "reflex" => 2.0, "sq_r" => 330.0, "sq_miss" => 0.0,
        "sq_late" => false, "terrain" => 2, "cohesion" => true, "bound" => 220.0, "halt" => tup![0.88, 0.98],
        "prep" => 900, "prep_max" => 2100, "cav_r" => 430.0, "cav_pick" => true, "counter" => true,
        "col_late" => false, "res_early" => false, "flank" => true, "relief" => true, "art_pick" => true,
        "wd_loss" => 0.25, "wd_ratio" => 0.75, "harass" => 0.6, "counter_k" => 1.5, "gen_move" => true, "grape" => 1,
        "assault_prep" => 4200, "span" => 60, "r_k" => 1.8, "wood" => true, "skirm" => 2, "cav_safe" => true,
        "storm" => true, "extend" => true, "flankfire" => true, "ten_k" => 1.0, "ca_thr" => 0.9, "ca_reach" => 180.0,
        "ca_mor" => 58, "ca_cool" => 180.0, "res_ca" => true, "cav_opp" => true, "screen" => 1, "ro_k" => 0.9,
        "ro_ebb" => 180.0, "ro_stop" => 0.08, "ro_depth" => 800.0, "cp" => 1, "breach_ca" => true, "retake" => true,
        "rg" => true, "rg_t" => 900.0, "volley_def" => true, "xfire" => true, "rupture" => true, "pt_k" => 2.0,
        "pt_every" => 300.0, "masse_mor" => 72, "masse_n" => 2, "exploit_k" => 1.6, "bound_feu" => 120.0,
        "halves" => true, "pursue_r" => 700.0, "batter" => 0.5, "forlorn" => 90.0, "div_lead" => 300.0,
        "bonus_wave" => 1, "garde" => true, "sortie" => 2, "b_counter" => 400.0, "coupure" => 1,
        "breach_volley" => true, "ilots" => 4,
    },
});

/// Un repérage du gros de l'ennemi (`_body`) : (id, x, y, cls, form) ; x, y sont des entiers de mem['vu'], relus en `f64`.
pub type Repere = (Val, f64, f64, String, Val);
/// Une batterie ennemie connue (`_gun_zones`) : (x, y, rayon de mitraille meurtrière + 40 m, id).
pub type Canon = (f64, f64, f64, Val);
/// Un ennemi repéré récemment (`_known_targets`) : (x, y, cls).
pub type Cible = (f64, f64, String);
