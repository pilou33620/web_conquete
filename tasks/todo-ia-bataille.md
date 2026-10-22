# À faire : IA de bataille et suites des chantiers « réalisme »

Ce fichier rassemble ce qui reste à faire après le chantier « réalisme des batailles » (octobre 2026).
Précision au tir, valeurs chiffrées et « Compléter les rangs » sont faits et sur `main`.
L'IA de bataille aussi (voir ses restes ci-dessous).

## 1. IA de bataille (game/tactics/ai.py) : réalisée, avec des restes

Les trois volets sont faits (défense en rase campagne, attaque en rase campagne, places). On les mesure avec
`python3 outils/banc_ia.py --graines 1 --proc 4`, à comparer avec tasks/banc-ia-reference.md.

| Mesure | Référence | Après | Après l'assaut du cœur |
|---|---|---|---|
| Victoires de l'assaillant / du défenseur | 2 / 14 | 3 / 13 | 5 / 11 |
| Places prises | 0 sur 8 | 0 sur 8 | 2 sur 8 |
| Durée moyenne | 413 min | 250 min | 222 min |
| Batailles de places allées jusqu'à la nuit | 7 sur 8 | 0 sur 8 | 0 sur 8 |
| Pertes moyennes (assaillant / défenseur) | 17 % / 20 % | 21 % / 22 % | 21 % / 20 % |
| Calcul moyen (max) | 6,0 s (14,7 s) | 3,8 s (6,5 s) | 3,5 s (6,8 s) |
| Contre-attaques notées | 76 | 202 | 172 |
| Tirailleurs notés | 0 | 44 | 44 |
| Assauts notés | 141 | 359 | 322 |
| Brèches notées | 29 | 194 | 152 |

Banc des places seul (`python3 outils/banc_ia.py --lieux forteresse --graines 3 --proc 4`, 24 batailles) : avant
l'assaut du cœur, 0 place prise, pertes 24 % / 24 %, durée moyenne 279 min ; après, 4 prises (1700, 1790, 1813 ; en
1 h 30 à 3 h, l'assaillant perdant 11 à 22 %, la garnison 16 à 34 %), pertes 23 % / 22 %, durée 247 min.

Règles du moteur ajoutées ensuite (battle.py, pour le joueur comme pour l'IA) :
- **Reddition d'une place** (SURR_*, _surrender) : brèche ouverte depuis 20 min, une heure sous le canon, 30 % de
  pertes, moral moyen de la garnison (fuyards compris) sous 55, assaillant en état de combattre deux fois plus
  nombreux : « La garnison capitule… », elle est prisonnière, la place est prise en campagne (bridge.finish).
- **La brèche est un goulet** (BRECHE_*, _in_breach) : sur la brèche et à une case de ses bords, l'assaillant n'engage
  que 180 hommes en mêlée, s'y bat à ×0,8 et prend ×1,4 au feu.
- **Village barricadé** : skirmish.KINDS a un lieu 'village' (sans remparts, barricades au niveau BAR_LEVEL), au banc
  (`--lieux village`) mais pas dans l'écran du mode Bataille (ui.js ne propose que bataille et forteresse).

Banc des places (24 batailles) : avant, 6 prises (toutes d'assaut), pertes 24 % / 21 %, 190 min ; avec la reddition
seule, 8 prises dont 3 redditions (une en 1870) ; avec le goulet en plus, 4 prises (3 redditions : 1700, 1790, 1870 ;
1 assaut, 1700, 26 % / 26 % en 3 h 30), pertes 26 % / 27 % (la garnison rendue compte pour 100 %), 189 min. Banc des
villages (16 batailles) : pas d'erreur ni de bataille figée ; l'assaillant attaque toujours les barricades et la
garnison tient les maisons ; rôle « att » : 8 prises sur 8 en 1 h à 1 h 30 (6 à 14 % de pertes) ; rôle « def » :
1 prise sur 8.

Reste à faire :
- **Places : 6 prises sur 24 au banc des places (25 %), la spécification visait 30 à 50 %.** La cause des 0 sur 24
  était dans l'IA, pas dans le moteur : arrivées au cœur, les colonnes fusillaient les maisons sans y entrer,
  ignoraient les cavaliers de la garnison qui le gardaient (un seul défenseur debout à moins de HEART_FREE suffit à le
  tenir), ne relançaient pas une charge arrêtée court (l'ordre restait « charge », l'IA croyait la charge en cours), et
  les fuyards ralliés attendaient la vague suivante pendant que l'assaut s'éteignait. Fort Médoc (graine 2) était
  posé dans l'estuaire par la carte de campagne, trop grossière : la place est maintenant bâtie au sec (remparts et
  glacis compris), une chaussée et son pont la relient à la terre ferme (terrain.py, _mainland, _causeway), et
  l'assaillant arrive par le bord le plus sec (battle.py, _zones). Fort Médoc se prend 2 fois sur 4 quand
  l'assaillant est en force. Restent :
  - rôle « def » (l'IA attaque avec l'armée tirée au sort, à peine plus nombreuse que la garnison du joueur) : aucune
    prise, ce qui est juste, mais la brèche tombe vite (10 min) devant une garnison fraîche ;
  - en 1870 : l'assaut ne prend toujours rien (les colonnes arrivent au cœur sans cartouches et sous 50 de moral) ;
    la place tombe par reddition (1 fois sur 3) ;
  - avec le goulet, la prise d'assaut coûte plus cher mais devient rare (1 sur 12 en rôle « att ») : les places
    prises le sont surtout par reddition ; à surveiller sur plus de graines ;
  - certaines brèches sont franchies en quelques minutes (1700, graine 2) : la garnison ne les garnit pas assez vite ;
  - au village barricadé, l'assaillant à deux contre un l'emporte en une heure à peu de frais ; le logement dans la
    brèche (A4) aiderait à garder ce qui est pris.
- **En rase campagne, l'assaillant gagne encore peu** : 3 batailles sur 8, et aucune en 1870. Il faut vérifier sur
  plus de graines (`--graines 3`), parce qu'une seule graine fait beaucoup bouger les chiffres.
- **« Finir automatiquement »** : l'armée du joueur reprise en cours de route n'a pas les réglages du déploiement
  (écran de tirailleurs, contre-pente, salve, feux croisés).
- **Laissé de côté :**
  - la batterie de réserve ;
  - les enfants perdus pris dans un bataillon de ligne faute de légers ;
  - le logement dans la brèche ;
  - les redoutes tenues ;
  - la cavalerie postée hors du village ;
  - le choix de cibles propre aux canons du rempart ;
  - le bonus de contre-batterie pendant la préparation.
- **Non vérifié :** la campagne simulée (outils/simuler.py).

Le premier jet de l'IA (branches `wip-batailles-realisme` et `wip-ia-bataille`) est dépassé : ces branches peuvent
être supprimées.

Pour mémoire, les spécifications complètes rédigées par les agents de conception :


---

SPÉCIFICATION — IA de bataille, volet DÉFENSE EN RASE CAMPAGNE (game/tactics/ai.py)

Ce que fait le code aujourd'hui (constaté à la lecture)
- Le plan 'tenir' met la ligne en mode 'poste' : chaque bataillon retourne sans cesse à mem['post'] (_think_field, branche défenseur). Il ne bouge que par _bayonets (portée 120 m, cible au moral < 40, ou à moins de 45 % de son effectif, ou en mêlée, ou de flanc avec un moral < 65).
- La contre-attaque générale (_think_field, l. 1322) ne part que si sit['ratio'] ≥ counter_k (2,0 en normal, 1,5 en difficile), avec en plus e_routed ≥ 2 et un moral > 50. Ces conditions ne sont presque jamais réunies, d'où les batailles « binaires ».
- Les légers ('avant') restent à 110 m devant la ligne et se replient sur les ailes de la ligne dès que l'infanterie ennemie est à 170 m ou la cavalerie à 380 m. Ils ne reviennent jamais en avant.
- Les canons sont fixes en mode 'poste' (ils ne bougent que lorsqu'ils sont aveugles).
- Il n'y a pas d'arrière-garde : think() rend la main dès que b.withdrawing[side] est vrai.
- En normal, la ligne défensive passe en tirailleurs (_march_form, skirm=2) à 720 m de l'ennemi, à toutes les époques. Or le moteur considère qu'une troupe en tirailleurs n'est jamais « en ordre » : elle ne reçoit pas une charge de pied ferme, et elle ne vaut que ×0,7 au corps à corps.

Les règles du moteur sur lesquelles tout repose (battle.py, rien à y changer)
- FORMED = 50 : sous ce moral, une troupe chargée de face n'est plus « en ordre », et le choc porte en plein.
- Feu de défense contre une charge : il n'existe que si la cible a au moins une cartouche (ammo ≥ 1), n'est pas en manœuvre et n'est ni en mêlée, ni en ralliement, ni elle-même en train de charger.
- FALTER = 50 : une charge d'infanterie dont le moral tombe sous 50 après la salve de défense s'arrête court. Le chargeur doit donc partir avec de la marge, soit un moral d'au moins 60.
- Une troupe qui marche (u.path) ne tire pas, sauf en tirailleurs.
- Un feu reçu de flanc (angle > 1,2 rad) coûte 1,4 fois plus de moral, de dos (angle > 2,3 rad) 1,8 fois plus (_damage).
- Ce que l'IA peut lire d'un ennemi repéré (Unit.view) : moral, état, formation, munitions, effectif, effectif de départ, fatigue, orientation. Elle ne voit PAS e.busy : je n'ajoute aucune lecture de busy, ce serait tricher.

PRINCIPES
1. Un seul fichier : game/tactics/ai.py, plus une nouvelle classe de tests dans tests/test_bataille.py et éventuellement un outil de banc. Ne pas toucher battle.py ni units.py.
2. Chaque nouveau comportement est commandé par une clé de LEVELS. On peut donc l'éteindre par spec['ai_tweak'] pour les comparaisons A/B du banc, sans toucher au code.
3. La mémoire reste en types JSON. Nouvelles clés : 'era', 'ca_t', 'scr', 'crest', 'crest_t', 'ro', 'ro_end', 'near_t', 'pressed', 'rg', 'retake_t', 'refuse', 'co_t', 'stats'. Les créer par setdefault, pour que _adopt et les anciennes sauvegardes marchent.
4. Les niveaux ne changent que la qualité des décisions (seuils de lecture, délais, coordination), jamais les dégâts.
5. _bayonets et _cav_target servent aussi à l'assaillant :
   - les règles propres à la défense ne s'appliquent que si `dfn = side == 1 and mem['plan'] in ('tenir', 'harcelement') and mem.get('mode') == 'poste'` ;
   - les nouveaux multiplicateurs généraux de la cavalerie (§3) s'appliquent à tous ;
   - le prévenir au volet « attaque ».
6. Messages du journal en français, au ton d'époque, avec _note_once. On compte chaque événement dans mem['stats'] (dict de compteurs) pour le banc.

================================================================
0. OUTILS COMMUNS (nouveaux)
================================================================
_era(b, side) → 0, 1 ou 2, calculé une fois et rangé dans mem['era'] (deploy et _adopt) :
    def _era(b, side):
        """Époque tactique : 0 guerre en dentelles (avant 1789), 1 Révolution et Empire, 2 armes rayées (fusil rayé ou
        mieux, ou 1850 et après) : le feu et le couvert dominent."""
        y = (b.spec.get('year') if isinstance(getattr(b, 'spec', None), dict) else None) or 1790
        arm = max((u.arm or 0 for u in b.units_of(side) if u.cls == 'inf'), default=0)
        return 2 if arm >= 4 or y >= 1850 else (0 if y < 1789 else 1)
(spec['year'] est fourni par bridge.make_spec. Les scénarios donnent : '1700' → 0, '1790' et '1813' → 1, '1870' → 2.)

_cas(b, side, mem) → (cas, e_cas) : le calcul des tués, blessés et prisonniers des deux camps, sorti de _tenacity tel quel. _tenacity l'appelle désormais, et _retour aussi.

_flotte(b, e, u=None) → (score, raison) : l'assaillant « flotte-t-il » ? Ne s'applique qu'à l'infanterie valide, et ne lit que des champs visibles. Points cumulés :
- e.state == 'melee' : +1,0 (« aux prises »)
- e.state == 'ralliement' : +0,8 (« il reforme ses rangs »)
- moral < 40 : +1,0 ; moral de 40 à 49 : +0,7 (« ébranlé », sous FORMED) ; moral de 50 à 59 : +0,3
- e.ammo < 1 : +0,8 (« sans cartouches », donc pas de feu de défense) ; ammo < 0,15 × ammo0 : +0,3
- effectif < 0,5 × effectif de départ : +0,4 (« décimé »)
- fatigue > 75 : +0,3 (« épuisé »)
- si u est donné et _ang(e.dir, atan2(u.y − e.y, u.x − e.x)) > 1,2 : +0,6 (« pris de flanc »)
La raison renvoyée est celle du plus gros apport.

================================================================
1. CONTRE-ATTAQUES LOCALES À LA BAÏONNETTE (_bayonets, branche défensive)
================================================================
On ajoute dans la boucle des candidats un `if dfn and L['cav_pick']: ...; continue`, qui appelle un nouvel assistant _local_counter(b, side, mem, L, u, foes, era, line) → (bv, ratio, e) ou None. Le résultat entre dans `cands` avec bv = 1,0 + score, ce qui conserve la règle go = bv ≥ 1,0. Le hasard du niveau facile (0,12) ne change pas.

Qui peut contre-attaquer :
- un bataillon de rôle 'ligne' ou 'garde_flanc', ou 'res' si L['res_ca'] (normal et difficile) ;
- pas un léger, sauf contre des tirailleurs ou un ennemi dont le score atteint 1,5 ;
- moral ≥ L['ca_mor'] (60 en normal, 58 en difficile, 50 en facile), effectif ≥ 0,5 × effectif de départ, fatigue < 70 ;
- au moins L['ca_cool'] secondes depuis sa dernière contre-attaque (240 s en normal, 180 s en difficile) : il revient à son poste et se reforme ;
- aucun cavalier ennemi à moins de 380 m (600 m à l'époque 2) ;
- la cible n'est pas dans la zone de mitraille meurtrière d'une batterie ennemie connue, à moins que ce soit justement cette batterie (_gun_zones(b, mem, 300)).

Portée et laisse :
- portée = L['ca_reach'] (160 m en normal, 180 m en difficile), multipliée par 0,7 à l'époque 2 ;
- pour la réserve : jusqu'à 200 m, mais seulement si la cible est à moins de 150 m d'un de nos bataillons 'ligne', ou en mêlée avec l'un des nôtres. C'est le « moment décisif » : la colonne de réserve enfonce l'assaillant arrêté devant la ligne ;
- en mode poste, la cible doit être à moins de 260 m du poste du bataillon (mem['post'][uid]).

Quand on charge :
- on calcule s, raison = _flotte(b, e, u) ;
- force = _melee_power(b, u) + 0,5 × la force des nôtres déjà en mêlée avec e (le moteur additionne les forces), et ratio = force / _melee_power(b, e) ;
- on charge si s ≥ L['ca_thr'] (1,0 en normal, 0,9 en difficile) ET ratio ≥ (0,8 si s ≥ 1,5, sinon 1,0) ;
- époque 0 : seuil + 0,3 (dans les armées linéaires, la cavalerie fait l'essentiel de la contre-attaque) ;
- époque 2 : seulement si la raison est « aux prises », « sans cartouches » ou un moral < 40, ou si u lui-même n'a plus de cartouches ;
- faute de cartouches : si u.ammo < 1, que e est à moins de 100 m et que s ≥ 0,6, on charge (« faute de cartouches, à la baïonnette ! »).

Cohésion :
- au plus max(1, ceil(len(ligne) / 3)) bataillons de la ligne en charge à la fois, en comptant ceux déjà en état 'charge' ;
- en difficile, la règle existante des voisins à moins de 220 m s'applique avec ratio ≥ 0,9.

À l'exécution : mem['ca_t'][uid] = round(now), mem['stats']['ca'] += 1, et une note : « {u.name} contre-attaque à la baïonnette le {_foe(e)} ({raison}). »

Retour au poste :
- le poste reste dans want, donc le bataillon y revient de lui-même après le choc ;
- nouveau réflexe _leash(b, side, mem, L, us), appelé dans _reflexes quand le contexte est dfn : un bataillon en état 'charge' dont la cible est en déroute, ou qui s'est éloigné à plus de 300 m de son poste, reçoit l'ordre de revenir (b.order 'move' vers le poste). Pas de poursuite : on reprend sa place.

Formation de la ligne qui défend (_march_form, defending=True seulement) :
- époque 0 : jamais en tirailleurs ;
- époque 1 : en tirailleurs seulement quand l'infanterie ennemie est à plus de 300 m (pour souffrir moins du canon), en ligne en deçà (pour recevoir l'assaut par des salves et pouvoir contre-charger) ;
- époque 2 : rien ne change.
- Feu de salve (clé 'volley_def', normal et difficile, époques 0 et 1) : au déploiement de la ligne du défenseur, b.order(side, ids, 'fire', mode='volley'). C'est « tirez les premiers » à l'envers : on attend que l'ennemi soit à 85 % de la portée efficace pour lâcher une salve groupée.

================================================================
2. CAVALERIE SUR LES TROUPES DÉSORGANISÉES
================================================================
2a. _cav_target, branche infanterie (le `else`). Les multiplicateurs s'appliquent à la valeur v :
- moral < 50 : ×1,8 (le seuil passe de 45 à 50, pour suivre FORMED) ; moral de 50 à 59 : ×1,2 ;
- e.state == 'marche' et formation ligne ou colonne : ×1,4 (« en mouvement, elle ne tire pas ») ;
- e.state == 'charge' : ×2,0, et le malus « ligne fraîche de face » (×0,25) ne s'applique pas (une troupe qui charge ne fait pas de feu de défense) ;
- e.ammo < 1 : ×1,5, sans le malus de face non plus ;
- l'un de nos fantassins a tiré il y a moins de 60 s et se trouve à moins de 200 m de e, qui n'est pas en carré : ×1,3 (« prise entre le feu et le sabre : elle ne peut former le carré sous notre fusillade ») ;
- époque 2 : ×0,4 si e a un moral ≥ 50, au moins une cartouche et n'est ni en mêlée ni en charge (le fusil rayé fauche les escadrons) ; époque 0 : ×1,15.
- Laisse défensive (dfn) : on écarte toute cible à plus de 550 m devant l'ancre (_rel(e.x, e.y, ax, ay, fd)[0] > 550). Exceptions : chariot, état-major et artillerie attelée à moins de 350 m de u.
- On écarte aussi toute cible qui se trouve dans la zone de mitraille meurtrière d'une autre batterie ennemie connue.
- Le seuil bv ≥ 0,55 et l'interdit du carré ne changent pas.

2b. Nouveau réflexe _cav_opportunity(b, side, mem, L, us, foes), dans _reflexes, si L['cav_opp'] (normal et difficile ; facile non). Il est appelé toutes les 2 s, parce qu'une charge d'infanterie ne dure qu'une minute.
- Proies possibles : l'infanterie ennemie en état 'charge' dont la cible est à nous ; celle qui est en mêlée avec l'un des nôtres ; les fuyards à moins de 300 m de notre ligne.
- Le chargeur : le cavalier 'cav' frais le plus proche à moins de 500 m (pas occupé, ni en charge, ni en mêlée ; moral > 50, fatigue < 70, effectif > 0,35 × départ), avec _charge_ok.
- Pas si la proie est escortée : une autre infanterie ennemie à moins de 120 m, hors mêlée.
- En difficile, pas non plus si des cavaliers ennemis frais (plus de 0,7 × u.men) sont à moins de 450 m.
- Chaque escadron attend 120 s entre deux charges (mem['co_t']).
- Note : « la cavalerie de {aile} tombe sur la colonne ennemie qui charge ».

2c. Ralliement en arrière : un cavalier 'cav' qui est au repos à plus de 300 m devant l'ancre retourne à son poste au galop (want avec run=True). C'est la leçon de la brigade de l'Union : les escadrons se reforment derrière la ligne.

================================================================
3. TIRAILLEURS EN AVANT, POUR HARCELER ET RETARDER (_lights_def réécrite, clé 'screen')
================================================================
Profondeur de l'écran, décidée au déploiement (_deploy_field, côté 1, à la place des 110 m) :
- D0 = min(550, max(150, 1,6 × portée efficace des légers)) ;
- époque 0 : 110 m, ou 160 m si le poste est en terrain couvert (ROUGH) ;
- en facile, 110 m comme aujourd'hui ;
- le poste est cherché par _cover_spot (rayon 90 × r_k). mem['post'] est le poste avancé (palier 0).

Trois paliers, rangés dans mem['scr'][uid] = [palier, t] :
- 0 : avancé, à D0 ;
- 1 : à mi-chemin, à max(80, D0 / 2), même latéral, à couvert ;
- 2 : aux ailes de la ligne (le repli actuel : latéral ±(w + 60), profondeur −20).

Reculer d'un palier, au pas de course (run=True) :
- quand de l'infanterie ennemie en ordre (pas des légers) arrive à moins de R = max(170, 0,75 × max(e_légers, e_ennemi)), où e_ennemi = b.ranges(e)[0] ;
- droit au palier 2 si des cavaliers ennemis sont à moins de 380 m et que les légers ne sont pas en terrain couvert, ou si leur moral passe sous 50, ou leur effectif sous 0,6 × départ ;
- en facile : R = 120 m, pas de palier 1.

Se reporter en avant (palier − 1), en normal et difficile :
- aucune infanterie ennemie à moins de 1,6 × R du poste visé depuis 150 s, aucun cavalier à moins de 600 m, moral ≥ 60, phase 'combat' ;
- note : « l'assaut reflue : les tirailleurs se reportent en avant ».

Harceler les canonniers (normal aux époques 1 et 2 ; difficile à toutes) :
- aux paliers 0 et 1, une batterie ennemie à moins de 1,3 × e_légers, sans infanterie ennemie à moins de 200 m d'elle ni cavalier ennemi à moins de 600 m ;
- poste = 0,9 × e_légers de la batterie, à couvert ; b.order(side, [uid], 'attack', target=gid), puis busy.add(uid) ;
- note : « les tirailleurs harcèlent les canonniers de {batterie} ».

Le tir de flanc du difficile (flankfire) reste, après ces règles.

================================================================
4. RETOUR OFFENSIF QUAND L'ATTAQUE S'ESSOUFFLE (_retour, _retour_stop)
================================================================
Mesures, tenues à chaque réflexion du défenseur :
- mem['pressed'] = 1 dès que front ≤ 400 ;
- mem['near_t'] = dernière heure où de l'infanterie ennemie valide (pas des légers) était à moins de 220 m d'un bataillon 'ligne'.

_retour(b, side, mem, L, us, sit, line) remplace le bloc de la ligne 1322, sous la condition plan 'tenir' et L['counter']. On lance le retour offensif si TOUTES ces conditions sont vraies :
a) mem['pressed'] (l'assaut est vraiment venu) ;
b) l'assaut reflue : now − mem['near_t'] ≥ L['ro_ebb'] (300 s en normal, 180 s en difficile), ou sit['e_routed'] ≥ 2 ;
c) nos troupes tiennent : sit['mor'] > 55, sit['loss'] < L['wd_loss'] − 0,05, et b.time_left() > 1200 ;
d) sit['ratio'] ≥ L['ro_k'] (1,0 en normal, 0,9 en difficile ; facile : 99, donc jamais), −0,15 pour un général audacieux, +0,2 pour un prudent ;
e) au moins DEUX signes d'épuisement :
   - e_cas ≥ 1,3 × cas (calculé par _cas) ;
   - le moral moyen de l'infanterie ennemie vue est < 60 ;
   - sit['e_routed'] ≥ 1 ;
   - notre ligne n'a rien pris depuis 180 s (max(u.hit_t) < now − 180 : « son feu a cessé ») ;
f) il nous reste de quoi frapper : au moins une infanterie fraîche en 'res' ou 'garde_flanc' (moral > 60, munitions > 50 %), ou un cavalier frais ;
g) au moins 1 200 s depuis mem['ro_end'].

L'ancienne règle (ratio ≥ counter_k, e_routed ≥ 2, moral > 50) reste comme « contre-attaque générale ». counter_k ne sert plus qu'au choix du plan au déploiement (_choose_plan), où il ne change pas.

Exécution :
- mem['ro'] = dict(t0=round(now), loss0=round(sit['loss'], 3), ax0=mem['ax'], ay0=mem['ay'], er0=sit['e_routed']) ;
- plan 'frontal', mode 'ligne', _recenter(mem, line), _set_phase(b, mem, 'assaut', "l'attaque ennemie s'essouffle : retour offensif (" + raisons + ").") ;
- mem['stats']['ro'] += 1.

_retour_stop, appelé en tête de _think_field quand mem.get('ro'). On arrête si :
- sit['loss'] − loss0 > L['ro_stop'] (0,06 en normal, 0,08 en difficile) ;
- l'ancre a avancé de plus de L['ro_depth'] (600 m en normal, 800 m en difficile) le long de fd, alors que sit['e_routed'] < 2 (« on ne s'aventure pas sous ses canons ») ;
- sit['mor'] < 50 ;
- sit['ratio'] < ro_k − 0,25 ;
- now − t0 > 2400 sans un fuyard ennemi de plus.
Pour arrêter : plan 'tenir', mode 'poste', phase 'combat', mem['ro_end'] = now, on enlève 'ro', et les légers repassent au palier 1. Les postes n'ont pas changé : la ligne réoccupe sa position, et les canons reprennent leur poste (leur gslot n'est pas marqué 'fixe').

================================================================
5. CONTRE-PENTE À LA WELLINGTON (clé 'cp' ; normal et difficile ; époque 1 seulement)
================================================================
À l'époque 0, les lignes se tenaient à la vue de l'ennemi. À l'époque 2, on cherche le champ de tir.

Au déploiement (_deploy_field, côté 1, après _best_depth) :
- _hidden(b, side, x, y) : vrai si aucune des cinq vues b.los(px, py, x, y, GUN_EYE, EYES['inf']) ne passe, depuis cinq points répartis sur le bord avant de ai_zone(1 − side) (latéraux de −0,4 à +0,4 de sa largeur) ;
- si le poste est vu, on cherche derrière lui : reculs de 20, 35, 50 et 65 m (80 m en plus en difficile), décalages latéraux de 0 et ±20 m ;
- on garde le premier point franchissable, plus bas d'au moins 1 m que la crête et caché ; il devient le poste (l'abri), et mem['crest'][uid] garde le point d'origine.
- Coût : au plus 15 essais × 5 vues par bataillon, une seule fois.

En bataille (boucle de la ligne, branche défenseur) :
- on monte sur la crête quand de l'infanterie ennemie (_body, cls 'inf') arrive à moins de Rup = max(260, 2,2 × portée efficace ennemie) du point de crête ;
- on redescend à l'abri quand plus personne n'est à moins de 1,3 × Rup depuis 120 s (mem['crest_t']) ;
- note, une seule fois : « à l'abri derrière la crête, la ligne se porte sur la crête et fait feu ».
- Les légers restent en avant, sur la pente, et les canons sur la crête (_gun_spot cherche déjà la vue).

================================================================
6. RÉSERVES AU MOMENT DÉCISIF, RÉOCCUPATION D'UNE POSITION PERDUE (_roles_update)
================================================================
- Percée : le bloc existant ne dépend plus de L['extend'] mais de L.get('breach_ca', L['extend']), avec breach_ca=True en normal.
- Réoccupation (clé 'retake'). Nouveau bloc, après la percée, pour chaque poste de la ligne (mem['post'] des 'ligne', et mem['was'] des ralliés) :
  - le poste est un point d'appui : cover_at ≥ 0,3, ou une haie ou un muret (feature_at ≥ 2), ou du bâti ;
  - de l'infanterie ennemie valide est à moins de 60 m ;
  - aucun des nôtres n'est à moins de 80 m ;
  - alors on prend la réserve (ou un rallié repassé en 'res') la plus proche à moins de 500 m, avec un moral > 60, si _melee_power(u) ≥ 1,1 × _melee_power(e) (le bonus du bâti est déjà compté) ;
  - à moins de 150 m elle charge, sinon elle reçoit 'attack' ;
  - chaque poste attend 300 s entre deux tentatives (mem['retake_t']) ;
  - note : « l'ennemi tient notre poste de {terrain} : {u} va le reprendre ».

================================================================
7. GARDE DES FLANCS (en plus de l'existant, sous L['flank'])
================================================================
Quand une menace d'au moins 150 hommes pèse sur l'aile s et qu'aucune réserve n'est disponible :
- le bataillon du bout de l'aile refuse le flanc : mem['refuse'][str(s)] = uid, puis want avec dir = fd + s × 0,7 et 40 m en arrière de son poste ;
- la cavalerie de l'aile s prend poste au latéral s × (w + 160), 20 m en arrière, face à fd + s × 0,8.
Les deux reprennent leur place quand la menace disparaît depuis 300 s (même minuterie que guard_t).

================================================================
8. ARTILLERIE QUI JOUE SON RÔLE
================================================================
- Feux croisés au déploiement (normal et difficile, plan 'tenir', au moins 2 batteries) : les deux batteries extérieures au latéral ±(width/2 − 30), 20 m en arrière, orientées vers le centre (fd ∓ 0,25) ; les autres au centre. Le moteur compte 1,4 fois plus de moral pour un feu reçu de biais.
- Déplacement quand l'assaut vient (mode poste, normal et difficile) : la règle de la batterie aveugle s'élargit. Si une infanterie ennemie en ordre est à portée maximale, que la batterie n'a pas tiré depuis 90 s (60 s en difficile) et que personne n'est à moins de 300 m, on cherche un emplacement par _gun_spot_view (rayon 160, au plus 20 m en avant).
- Batterie de réserve (difficile, au moins 3 batteries ; priorité 3, facultatif) : une batterie 'art_res' à 220 m derrière le centre. Elle rejoint le secteur où l'ennemi est à moins de 700 m de la ligne, puis reprend le rôle 'art'.

================================================================
9. ARRIÈRE-GARDE QUI COUVRE LA RETRAITE (clé 'rg'; normal et difficile)
================================================================
think() : remplacer le retour immédiat sur b.withdrawing[side] par :
    if b.withdrawing[side]:
        if L.get('rg') and mem.get('plan') != 'place': _rearguard(b, side, mem, L, us, foes)
        return
(calculer us, L et mem avant ce test). _rearguard ne réfléchit qu'à la cadence de la réflexion lourde (mem['next']).

Premier appel :
- on choisit au plus 2 cavaliers frais (moral > 50, effectif > 0,5 × départ) et 1 bataillon frais (moral > 55, hors mêlée), sauf si sit['ratio'] < 0,45 (déroute générale) ;
- leur poste est l'ancre moins 150 m, face à fd ; les cavaliers à ±200 m de latéral ; l'infanterie en ligne ;
- ordre 'move' (ce qui annule la retraite que b.withdraw leur avait donnée) ;
- mem['rg'] = [ids] ; note : « {noms} forment l'arrière-garde et couvrent la retraite ».

Ensuite :
- les cavaliers chargent, par _cav_target restreint, les cavaliers ennemis à moins de 400 m de nos troupes qui se retirent, et l'infanterie ennemie en marche, en terrain découvert, à moins de 350 m ;
- une unité reçoit 'retreat' (et sort de mem['rg']) dès que now − b.withdraw_t[side] > L['rg_t'] (600 s en normal, 900 s en difficile, toujours moins que les 1 800 s du moteur), ou que son moral passe sous 40, ou que son effectif passe sous 0,4 × départ, ou que de l'infanterie ennemie arrive à moins de 120 m avec un rapport de corps à corps < 0,8.

À mesurer : les prisonniers du camp battu (result['prisoners']).

================================================================
10. RÉGLAGES PAR NIVEAU (nouvelles clés de LEVELS)
================================================================
clé          facile   normal   difficile
ca_thr       —        1,0      0,9      (en facile, le hasard actuel de 0,12)
ca_reach     120      160      180
ca_mor       50       60       58
ca_cool      300      240      180
res_ca       False    True     True
cav_opp      False    True     True
screen       0        1        1
ro_k         99       1,0      0,9
ro_ebb       —        300      180
ro_stop      —        0,06     0,08
ro_depth     —        600      800
cp           0        1        1
breach_ca    False    True     True
retake       False    True     True
rg           False    True     True
rg_t         —        600      900
volley_def   False    True     True
counter_k ne change pas (99, 2,0, 1,5) : il ne sert plus qu'au choix du plan initial.

Ce qui change selon l'époque (mem['era']) :
- 0 (1700-1788) : la ligne ne passe jamais en tirailleurs ; contre-attaque locale plus exigeante (seuil + 0,3) ; cavalerie ×1,15 ; écran de 110 à 160 m, dans les couverts ; pas de contre-pente ; feu de salve.
- 1 (1789-1849) : tout s'applique ; contre-pente ; écran d'environ 200 m ; colonnes de réserve à la baïonnette.
- 2 (fusil rayé, ou 1850 et après) : portée des contre-attaques ×0,7, et seulement contre un ennemi aux prises, sans cartouches ou au moral < 40 ; cavalerie ×0,4 contre l'infanterie en ordre ; écran de 450 à 550 m qui harcèle les canonniers ; ligne en tirailleurs ; pas de feu de salve.

Mettre à jour l'en-tête de ai.py en même temps : paragraphes « Plans – tenir », « Pendant la bataille » (nouveaux paragraphes « Défense vivante » et « Arrière-garde ») et « Niveaux ».

================================================================
11. ORDRE DE RÉALISATION (des morceaux indépendants, chacun passant les tests)
================================================================
P1, essentiel : 0 (outils), 1 (contre-attaques locales et réserve), 2 (cavalerie), 3 (écran), 4 (retour offensif).
P2 : 5 (contre-pente), 9 (arrière-garde), 6 (réoccupation), formation et feu de salve du §1.
P3 : 7 (refus du flanc), 8 (artillerie).

================================================================
12. VÉRIFICATION
================================================================
A. Tests unitaires : nouvelle classe DefenseVivante dans tests/test_bataille.py, avec la fabrique.
Pour chaque test :
- tb = S.new(GEO, dict(me='33', foe='24', era=…, units=dict(ligne=2, legere=1, cavalerie=1), seed=1, role='att')), puis tb.start() : l'IA défend (côté 1) ;
- placer les unités du joueur (face_a_face), régler morale, ammo, state et form ;
- forcer une réflexion : mem['next'] = mem['rnext'] = 0, puis ai.think(tb, 1, 2.0) ;
- lire u.order et u.target.

Les tests :
1. test_contre_attaque_sur_un_bataillon_ebranle : en 1813, un bataillon du joueur à 140 m d'un bataillon IA 'ligne' (moral 80), moral à 45 → l'IA charge cette cible.
2. test_pas_de_contre_attaque_sur_une_ligne_fraiche : même placement, moral 85, munitions pleines → pas de charge.
3. test_1870_contre_attaque_courte : à 150 m et moral 45 → pas de charge ; à 90 m et moral 35 → charge.
4. test_retour_au_poste : après un ordre de charge, la cible passe en 'deroute' et notre bataillon est à plus de 300 m de son poste → _leash donne un 'move' vers le poste.
5. test_cavalerie_sur_troupe_en_marche : un bataillon du joueur en ligne et en 'marche', à 300 m de la cavalerie IA, sans cavalerie du joueur → charge. En carré → pas de charge. En 1870, moral 80 et munitions pleines → pas de charge.
6. test_cavalerie_sur_colonne_qui_charge : un bataillon du joueur reçoit l'ordre 'charge' sur notre ligne → au réflexe suivant, la cavalerie IA à moins de 500 m le charge.
7. test_ecran_de_tirailleurs : en 1813, le poste des légers IA est à au moins 1,4 × leur portée efficace devant la ligne. Une infanterie du joueur à 150 m les fait reculer d'un palier (mem['scr']) ; quand elle repart à 600 m, au bout de 150 s ils reviennent.
8. test_retour_offensif_et_arret : mem['pressed'] = 1, mem['near_t'] = clock − 400, deux unités du joueur en 'deroute', les autres au moral 50 et à 60 % de leur effectif → mem['plan'] == 'frontal' et 'ro' présent. Puis on enlève 8 % de l'effectif IA → plan 'tenir', mode 'poste'.
9. test_contre_pente : avec tb, _ = bataille(demarree=False), imposer une crête parallèle au front dans tb.h (ou choisir une graine qui en a une), relancer ai.deploy(tb, 1) → mem['crest'] n'est pas vide et chaque abri est caché (_hidden).
10. test_arriere_garde : tb.withdraw(1), puis ai.think → 1 à 3 unités dont l'ordre n'est pas 'retreat', et mem['rg'] non vide. Après rg_t + 20 s, toutes sont en 'retreat'.
11. test_memoire_json : json.dumps(tb.ai_mem) passe après une bataille entière (run_to_end), à chacune des quatre époques.

Les suites existantes doivent toutes passer, comme le demande la tâche : test_bataille, test_campagne, test_serveur, test_cartes, et les tests node.

B. Banc IA contre IA. Petit script, outils/banc_bataille.py (ou dans le dossier de travail), à partir de skirmish.new :
- pour chaque époque ('1700', '1790', '1813', '1870'), chaque niveau ('facile', 'normal', 'difficile') et 8 graines, soit 96 batailles par variante ;
- composition : dict(ligne=4, legere=1, cavalerie=2, artillerie=2), role='att', difficulty=niveau, demarree=False ;
- avant autofinish, BT.ACCEL_LEVEL = niveau (autofinish impose ce niveau au camp du joueur) ; puis tb.autofinish() et tb.run_to_end() ;
- variantes A/B sans toucher au code, par tb.spec['ai_tweak'] = {niveau: {...}} : référence = toutes les clés nouvelles éteintes (ro_k=99, ca_thr=99, cav_opp=False, screen=0, cp=0, rg=False, retake=False, breach_ca=False, volley_def=False), puis chaque morceau seul, puis tout ensemble.
- Mesures : victoires de l'assaillant ; pertes de chaque camp et leur rapport ; prisonniers ; durée (tb.clock) ; batailles finies à la nuit ; mem['stats'] (contre-attaques, retours offensifs, charges d'opportunité, arrière-gardes) ; temps de calcul médian de run_to_end.

Critères d'acceptation, en normal contre normal :
- l'assaillant gagne à ±8 points de la référence (on ne casse pas l'équilibre) ;
- au moins une contre-attaque locale dans 60 % des batailles où l'assaillant est venu à moins de 200 m ;
- un retour offensif dans 15 à 40 % des batailles gagnées par le défenseur, et jamais plus de 2 par bataille ;
- les pertes du défenseur n'augmentent pas de plus de 10 % ;
- les prisonniers du camp qui décroche baissent avec l'arrière-garde ;
- en 1870, la cavalerie charge au moins 30 % moins l'infanterie en ordre qu'en 1813 ;
- le difficile défenseur bat le normal assaillant plus souvent que le normal défenseur ne le fait ;
- calcul : au plus +15 % de temps médian (Raspberry Pi).
Une variante qui fait perdre le défenseur plus souvent ne se garde pas sans la corriger. Noter les chiffres dans le rapport de mise au point, comme pour l'ordre oblique.

C. Campagne : outils/simuler.py --parties 3 --epoque 1790 --annees 5 --graine 1, à comparer à tasks/equilibre-reference.md (toutes les mesures doivent rester à ±25 %). Les batailles automatiques de la campagne passent-elles par le moteur tactique ? À vérifier : bridge.resolve_now le fait pour « Finir automatiquement ».

Ce que je laisse de côté :
- le retour offensif d'une seule aile ;
- la lecture de la manœuvre ennemie (busy n'est pas visible : il faudrait l'ajouter à Unit.view, mais c'est battle.py et units.py, hors chantier) ;
- les volets attaque et places.

Risques :
- _bayonets et _cav_target servent aussi à l'assaillant : les multiplicateurs du §2a changent aussi l'attaque, à coordonner avec ce volet ;
- passer la ligne en ligne plutôt qu'en tirailleurs aux époques 0 et 1 lui fait prendre davantage au canon. C'est à mesurer au banc avant de le garder.

**Histoire.** Défense « active », c'était la règle : à Waterloo (1815), la ligne de Wellington attendait couchée derrière la crête de Mont-Saint-Jean, hors de vue des canons français. Elle se levait au dernier moment pour fusiller les colonnes (« Now Maitland, now's your time! » contre la Garde). Pendant ce temps, les tirailleurs et les points d'appui avancés (Hougoumont, La Haye Sainte) usaient l'assaut. Quand le Ier corps de d'Erlon, mis en désordre par les haies et la fusillade, atteignit la crête, la brigade de l'Union chargea et le culbuta. Emportée trop loin, jusqu'à la grande batterie, elle fut ensuite sabrée par les lanciers : d'où la règle de se reformer derrière la ligne. Les contre-attaques locales de bataillons en colonne sur un assaillant qui flotte, et la reprise acharnée de villages perdus, sont la marque des batailles de la Révolution et de l'Empire (Aspern-Essling en 1809, Lützen en 1813). Le « retour offensif » sur une attaque essoufflée en est l'autre face : la contre-attaque de Desaix et de Kellermann à Marengo en 1800, ou la Maison du Roi et la brigade irlandaise contre la colonne anglaise à Fontenoy en 1745. Dans la guerre en dentelles, la ligne restait à la vue de l'ennemi et ménageait son feu (« tirez les premiers »). C'est la cavalerie des ailes qui frappait les troupes désorganisées (Seydlitz à Rossbach, 1757). À partir des années 1850, le fusil rayé puis le Chassepot rendent les charges contre une infanterie en ordre suicidaires (les cuirassiers de Reichshoffen, la Garde prussienne devant Saint-Privat en 1870). Le défenseur tient alors à couvert, avec un écran de tirailleurs qui atteint les canonniers à 500 m, et ne contre-attaque qu'à courte distance. Enfin, une retraite était couverte par une arrière-garde de cavalerie et d'infanterie fraîche, qui retenait la poursuite et limitait les prisonniers (Ney pendant la retraite de Russie, Davout à Hambourg).

---

SPÉCIFICATION — IA de bataille, volet ATTAQUE EN RASE CAMPAGNE (game/tactics/ai.py)
(Conception seule : aucun fichier n'a été modifié. Les mesures ci-dessous viennent de bancs IA contre IA lancés depuis le scratchpad, avec des rustines de source appliquées en mémoire. Les scripts sont dans /tmp/claude-0/-home-user-web-conquete/cf9fc38d-c045-5c7d-9378-c526d2e60451/scratchpad/att_rc/bp.py.)

==================================================================
0. CONSTAT : ce que fait l'IA aujourd'hui, et le banc de référence
==================================================================
Ce qui existe et qu'on GARDE :
- La phase « marche » mène la ligne jusqu'au standoff. La « prepa » met les canons en batterie à 85 % de la portée efficace pendant que la ligne attend. L'« assaut » avance par bonds (_advance, cohésion, retardataires). Le « combat » commence à halt_k × portée, avec la recherche de couvert de _fine_halt. La baïonnette vient après FIRE_LONG.
- _storm_guns enlève de flanc une batterie qui interdit l'approche. _out_of_grape garde la ligne hors de la mitraille. L'assaut général se déclenche quand l'attaque piétine (_decide_withdraw).
- Le plan débordement (_flank_group) envoie la cavalerie et les légers d'une aile. Les réserves comblent les trous, relèvent les bataillons, gardent les flancs (_roles_update). La cavalerie ne fait que des charges choisies (_cav_target). _art_target choisit les cibles, et le poids 'bout' sert déjà à concentrer le feu des places.
- L'obstination (_tenacity), le général qui va chercher ses fuyards, les niveaux.
- On ne reprend PAS ce qui a été essayé et retiré : l'ordre oblique (toute la ligne qui glisse vers une aile), l'aile refusée seule, l'attaque concentrée au bout de l'aile ennemie et la contre-batterie d'abord. Les variantes ci-dessous sont autres et passent toutes par le banc (§ 9).

Défauts relevés (mesurés ou lus dans le code) :
D1. Standoff dans le feu ennemi. En 1870, la ligne attend la fin de la préparation à 430–560 m, dans le feu à volonté du Chassepot (portée efficace 500 m, on tire jusqu'à 1,3 × efficace = 650 m). Journal de la graine 2 (1870, difficile contre normal) : « 8 h 40 la ligne est à portée » puis, à 8 h 43, « 2e Ligne sans cartouches ». Les cartouches ont fondu pendant la préparation.
D2. Ordre dispersé à toutes les époques. _march_form met l'infanterie DE LIGNE en tirailleurs dès qu'elle arrive à moins de 720 m, en 1700 comme en 1813. C'est anachronique avant le fusil rayé (1855 environ).
D3. Pas de point de décision. Chaque batterie choisit sa cible pour elle-même, la réserve ne sert qu'à boucher les trous, rien n'est jeté sur un point faible. Résultat : des fusillades de 3 à 5 h jusqu'à épuisement (journal de la graine 3, 1813 : relèves sans fin, puis « l'attaque piétine »).
D4. Le niveau difficile n'attaque pas mieux que le normal (voir le tableau). Ses avantages actuels jouent en défense.
D5. Rien pour les points d'appui. Après déploiement, 20 batailles sur 24 (1790) ont des défenseurs dans un bois, une forêt ou du bâti : 26 bataillons de ligne en bois, 21 en forêt, sur 122. L'assaillant les fusille sans effet (couvert de 0,35 à 0,55, ×1,4 à ×1,5 au corps à corps pour le défenseur).
D6. Pas de poursuite organisée, pas de cavalerie d'exploitation placée derrière l'effort, pas de batterie qui accompagne l'attaque.
D7. La phase « poursuite » n'arrive que quand plus aucun ennemi n'est en vue. Elle est presque toujours absente du journal.

Banc de référence (24 batailles par case, composition ligne=4, legere=1, cavalerie=2, artillerie=2, grenadiers=1 (en 1700 : ligne=5, sans grenadiers), adversaire tiré au sort par skirmish.FOE_MIX, graines 1 à 24, attaquant = camp 0, niveaux att/déf) :
| époque | parité n/n | parité d/n | parité d/d | 1,43:1 n/n | 1,43:1 d/n |
| 1700 | 4/24 (3,1 h ; pertes 16 %/13 %) | 5 | 3 | 18/24 (4,0 h) | 21 (3,1 h) |
| 1790 | 5 (3,3 h ; 19 %/15 %) | 3 | 3 | 20 (3,6 h) | 19 (4,0 h) |
| 1813 | 5 (3,4 h) | 6 | 0 | 19 (3,7 h) | 19 (4,0 h) |
| 1870 | 1 (3,1 h ; 22 %/14 %) | 0 | 1 | 15 (4,3 h ; 19 %/21 %) | 13 (4,7 h) |
(« 1,43:1 » : défenseur à 70 % de son effectif, redéployé ensuite.)
Ce qu'on attend en histoire : à parité contre une position, l'assaillant perd le plus souvent et y laisse 20 à 30 % d'hommes de plus. Avec 1,4:1 et une bonne attaque, il emporte la décision en 2 à 3 h, pas à la nuit.

Rustines prototypes essayées (essais de conception, ce n'est pas le code final) :
- H1 (standoff hors du feu ennemi, 1870) : 1/24 et 2/24 (d/n), contre 1/24 et 0/24. Neutre, et corrige l'absurdité.
- H2 (pas d'ordre dispersé pour la ligne avant le fusil rayé, les deux camps) : 4/24 en 1700, 1790 et 1813, contre 4, 5 et 5. Neutre : le réalisme ne coûte rien.
- H3 + H4 (point de rupture, puis la réserve s'y jette) : à parité 6/24 en 1700, 3 en 1790, 3 en 1813. À 1,43:1, avec H1 et H2 : 20/24 en 2,8 h (contre 18 en 4,0 h) en 1700, 19 en 3,1 h (contre 20 en 3,6 h) en 1790, 18 en 3,9 h (contre 15 en 4,3 h) en 1870, avec moins de pertes pour l'assaillant. Batailles plus décisives, victoires égales ou meilleures.
- H5 (échelons de 150 s et 90 m par rang, 1700) : 2/24 à parité (contre 4), 20/24 à 1,43:1 (contre 18). Neutre, dans le bruit (écart type ≈ 1,8 sur 24).

==================================================================
1. LA DOCTRINE SELON L'ÉPOQUE
==================================================================
Nouvelle fonction _doctrine(b, side) → 'lineaire' | 'imperiale' | 'moderne' | 'feu', mise en cache dans mem['doct'] au déploiement et dans _adopt.
- year = b.spec.get('year'). Sans année : 1700 si le meilleur arm de notre infanterie vaut 1 ou moins, sinon 1790.
- arm = le plus grand u.arm de notre infanterie.
- 'feu' si arm ≥ 5 (Chassepot, chargement par la culasse). Sinon 'moderne' si arm ≥ 4 (fusil rayé). Sinon 'lineaire' si year < 1789. Sinon 'imperiale'.
- C'est l'armement qui décide, pas l'année seule : en campagne, une faction en retard technique garde la tactique de ses armes.
- Le journal le dit une fois au déploiement : « doctrine de l'époque : ordre linéaire | colonnes et tirailleurs | ordre dispersé | le feu d'abord ».

==================================================================
2. CORRECTIONS (tous niveaux)
==================================================================
C1. Standoff hors du feu ennemi (_think_field, calcul du standoff).
    e_fo = la plus grande portée efficace b.ranges(e)[0] des fantassins ennemis repérés, ou, à défaut, de ceux dont on se souvient (mem['vu'] garde la portée des canons seulement : ajouter à vu, en position 10, la portée efficace de l'infanterie vue, c'est un nombre JSON).
    standoff = max(standoff actuel, 1,3 × e_fo + 60). Valeurs : 1790 → 216 (on garde 430), minié → 450, Chassepot → 710.
    Pendant la « prepa » de la doctrine 'feu', la ligne attend aussi hors de la portée efficace des batteries ennemies connues, si c'est possible : standoff_prepa = max(standoff, min(0,9 × portée efficace de la batterie ennemie, 1100)).
C2. Défilement pendant la préparation (nouveau _defile(b, side, mem, L, x, y, fd)). Pendant « prepa », chaque bataillon de ligne et de réserve cherche, à ±L['def_r'] m en profondeur et par pas de 20 m, la position qui ne voit aucune batterie ennemie connue (_gun_zones) à moins de sa portée efficace : b.los(x, y, gx, gy, EYES['inf'], GUN_EYE) faux, bonus +1,5. La hauteur et le couvert départagent (_spot_score). C'est la contre-pente, les hommes qu'on fait coucher derrière la crête. Recalcul quand l'ancre bouge de plus de 40 m (même clé de cache que lspot).
C3. Ordre dispersé selon l'époque (_march_form, fonction PARTAGÉE avec la défense : prévenir le chef d'orchestre).
    L'infanterie non légère ne passe en 'tirailleurs' que si doctrine ∈ ('moderne', 'feu').
    En 'lineaire' et 'imperiale', elle prend la 'ligne' à moins de 720 m (ou sous le feu) et la 'colonne' au-delà. Exception : la masse et les colonnes d'assaut (§ 4).
    Les légers restent en tirailleurs.
    Variante 'lineaire' : la colonne ne sert qu'à la route, et la ligne se forme dès 900 m de l'ennemi (on marchait déployé).
C4. Distance de feu par doctrine (halt) : on garde halt_k × e_inf.
    - En 'lineaire', le feu de peloton se donne plus près : halt plafonné à 0,8 × e_inf (64 à 80 m).
    - En 'feu', halt = halt_k × e_inf (410 à 490 m), puis l'assaut final (§ 6).
    Dépendance au chantier « portée » : si le moteur expose une fonction de précision (par exemple BT.range_k(d, e, mx)), recaler halt sur la plus grande distance où elle vaut 0,7 (normal) ou 0,8 (difficile), par getattr(BT, 'range_k', None), sans dépendre de son arrivée.
C5. Baïonnette par doctrine (_bayonets, la règle « après la fusillade »). Pour l'assaillant :
    - FIRE_LONG_D = dict(lineaire=1200, imperiale=900, moderne=900, feu=None).
    - 'lineaire' : ratio ≥ 1,5 (on se fusillait longtemps).
    - 'imperiale' : inchangé (ratio ≥ 1,3). Dans le secteur du point de rupture, 600 s et ratio ≥ 1,15.
    - 'feu' : jamais contre une troupe fraîche. Seulement si e.morale < 45, e.men < 0,6 × men0, ou de flanc avec moral < 65.

==================================================================
3. LE CHOIX DE LA MANŒUVRE (mem['var'], sans nouveau plan de campagne)
==================================================================
Dans deploy(), après _choose_plan, et seulement pour side 0 ou une contre-offensive, avec plan ∈ ('frontal', 'artillerie', 'debordement'), fonction _choose_var(b, side, mem, L, g) :
- 'debordement' → 'debordement' (inchangé, plus les ajouts du § 5).
- doctrine 'lineaire' et L['echelon'], au moins 4 bataillons de ligne → 'echelon'. En normal, seulement si une aile ennemie annoncée ou vue est nettement plus faible (≤ 0,75 de l'autre) ou si l'une de nos ailes trouve un flanc dégagé (_open_flank). En difficile, toujours.
- doctrine 'imperiale' et L['rupture'], au moins une batterie → 'rupture'.
- doctrine 'moderne' ou 'feu' et L['rupture'] → 'enveloppe'.
- sinon 'frontal' (comportement actuel).
Le plan 'artillerie' garde sa préparation double. La variante dit seulement OÙ l'effort se porte.
Journal : « manœuvre : attaque en échelons par l'aile droite » / « grande batterie et colonnes sur le point de rupture » / « le feu fixe le centre, la réserve enveloppe l'aile ennemie ».

==================================================================
4. RUPTURE (époque impériale) : grande batterie, point faible, masse, exploitation
==================================================================
4.1 Le point de rupture : _point(b, side, mem, L, sit), appelée dans _think_field en « prepa » et en « combat ».
  On découpe l'ennemi vu en secteurs (un bataillon et ses voisins à moins de 250 m). Pour chaque fantassin e valide :
      res(e) = e.men × (0,5 + e.morale/100) × (1 + 1,5 × cover_at(e))
             + 0,5 × Σ (voisins à moins de 250 m : men × (0,5 + morale/100))
             + 0,3 × distance(e, notre ancre)
             + 400 si une batterie ennemie en ordre (_gun_zones) couvre e à moins de son rayon de mitraille
             + 600 si e tient un point d'appui que nous ne visons pas (§ 7).
  pt = argmin res, avec hystérésis : on garde l'actuel tant que res(actuel) < 1,25 × res(meilleur).
  Normal : choisi une fois à la fin de la marche, revu seulement s'il disparaît. Difficile : revu toutes les L['pt_every'] = 300 s.
  Mémoire : mem['pt'] = [x, y], mem['pt_id'] = id, mem['pt_lat'] = latéral par rapport à l'ancre.
  Brèche : si un bataillon ennemi du secteur part en déroute et qu'aucun fantassin ennemi valide ne reste à moins de 200 m de sa dernière position, pt = cette position (« trouée ») et la note « une trouée s'ouvre : la masse et la cavalerie s'y portent ».
4.2 Grande batterie (_artillery, positions ; _art_target, poids).
  - Positions : en « prepa » et en « combat », pour la variante 'rupture', chaque batterie vise le latéral pt_lat + (k − (n−1)/2) × 100 m au lieu de son latéral propre. Distance : 0,85 × e en prepa (inchangé), 0,7 × e ensuite, jamais dans la mitraille ennemie (_out_of_grape) sauf _grape_dist.
  - Poids : on généralise 'bout'. bout = mem['bout'] pour l'assaut d'une place, sinon mem['pt'] si la variante est 'rupture', 'echelon' ou 'enveloppe'. Le facteur ×1,6 devient L['pt_k'] (normal 1,6, difficile 2,0) pour les cibles à moins de 260 m de pt. Les canons ennemis qui menacent nos lignes gardent leur ×2,0 (pas de contre-batterie d'abord).
  - Préparation en difficile : on garde la règle du moral moyen > 82, mais calculée sur le SECTEUR du point (fantassins à moins de 250 m de pt), plus « pertes du secteur ≥ 12 % » d'après vu0 et vu.
4.3 La masse (nouvelle _masse(b, side, mem, L, us, sit, want, busy), appelée en fin de _think_field). Nouveau rôle 'masse', à ajouter à la liste des rôles qui passent 'rallie' dans _roles_update et à la liste des rôles autorisés à charger dans _bayonets, avec une portée de 130 m comme 'assaut'.
  Déclenchement : phase 'combat' depuis au moins 300 s, et moral moyen du secteur ≤ L['masse_mor'] (normal 70, difficile 72) ou pertes du secteur ≥ 15 %. Au plus L['masse_n'] masses (normal 1, difficile 2), espacées d'au moins 900 s.
  Composition :
  - les bataillons de la réserve (grenadiers d'abord) avec morale ≥ 55, munitions ≥ 40 % et fat < 70, en gardant un bataillon pour les trous si la réserve en compte au moins 3 ;
  - en difficile, plus L['masse_line'] = 1 bataillon de ligne frais pris au latéral le plus proche de pt, remplacé dans la ligne par la règle des trous.
  Mouvement :
  - colonne jusqu'à D_dep = max(200, 2,5 × e_fo) de la cible (≈ 300 m en 1790) ;
  - puis 'ligne', sauf si getattr(BT, 'COL_SHOCK', 1.0) > 1 (option moteur, § 10), auquel cas on reste en colonne ;
  - un rideau de légers devant (§ 4.5) ;
  - but : la position de la cible, face fd.
  Charge : à moins de 160 m, avec _charge_ok, aucun cavalier ennemi à moins de 380 m, et _melee_power(u) ≥ L['masse_ratio'] × _melee_power(cible), soit 1,0 (normal) ou 1,1 (difficile). Cible : le fantassin du secteur au plus faible morale × men. Les voisins de ligne à ratio ≥ 1,0 suivent en difficile (règle existante).
  Échec : la masse est réduite à moins de 50 % de son effectif au lancement, ou son moral moyen tombe sous 40. Ses unités repassent 'res', mem['masse_fail'] augmente de 1, et la note « la masse est repoussée ». Après L['masse_n'] échecs : l'assaut général existant de _decide_withdraw prend le relais.
  Pendant la masse, le reste de la ligne FIXE : pas de nouvel assaut général lancé tant que la masse est en cours (mem['masse_t'] de moins de 900 s).
4.4 Cavalerie d'exploitation (_cavalry).
  En 'rupture', la cavalerie de réserve (wing 0, ou, à défaut, la plus fraîche) attend à 350 m derrière pt_lat, sur _out_of_guns, au lieu de 260 m derrière le centre.
  Dès que la masse est lancée : rayon de charge r ×L['exploit_k'] (normal 1,3, difficile 1,6), et les cibles du secteur en mêlée ou en déroute prennent v ×1,5.
  Au déploiement en 'rupture' et en difficile, on garde une réserve de cavalerie même avec 2 escadrons (aujourd'hui il en faut 3).
4.5 Rideau de tirailleurs (_lights_att).
  En 'rupture', à partir de la phase 'assaut', les légers ne vont plus aux ailes : ils se postent devant le secteur de pt, à 0,9 × leur portée efficace des fantassins ennemis du secteur, à couvert (_cover_spot).
  Quand la masse arrive à moins de 200 m de sa cible, ils s'écartent de 120 m de part et d'autre de son axe, pour ne pas masquer le feu ni recevoir la charge.
4.6 Batterie qui suit (artillerie volante, L['art_vol'], difficile seulement).
  Si on a au moins 2 batteries, la plus proche de pt prend le rôle 'art_vol' au lancement de la masse. Elle se met en batterie à 0,6 × e de la cible, décalée de ±250 m sur le côté de l'axe le plus éloigné des autres batteries ennemies, pour prendre le secteur d'écharpe (le moteur compte ×1,4 au moral pour le feu de flanc).
  Un cavalier ennemi vu à moins de 700 m : elle se replie sur la ligne.
  _artillery la traite comme 'art' avec une position imposée. Le rôle 'art' doit rester accepté partout où il est testé (garder 'art' et lire mem['vol'][id] pour la position).

==================================================================
5. ÉCHELONS (ordre linéaire, Frédéric), DÉBORDEMENT, ENVELOPPEMENT
==================================================================
5.1 Échelons ('echelon', nouvelle _echelon_slot(mem, u, line, now) appelée dans la boucle « ordres de la ligne » de _think_field).
  - Aile forte s = mem['ech'] : celle où l'ennemi vu ou annoncé a le moins de fantassins, sinon le flanc dégagé (_open_flank). Fixée au premier contact.
  - Rang k : 0 pour le bataillon le plus à l'aile forte, croissant vers l'aile refusée.
  - Le rang k reste en retrait de min(L['ech_max'] = 260, L['ech_dd'] = 90 × k) m sur son slot, jusqu'à t_ech + k × L['ech_dt'] (150 s), où t_ech est le début de la phase 'assaut'.
  - _out_of_grape s'applique toujours : l'aile refusée ne marche pas dans la mitraille, c'est ce qui perdait l'ancien ordre oblique.
  - L'ancre ne glisse pas de côté au-delà de la règle existante.
  - Au déploiement : les deux tiers de la cavalerie et la réserve sur l'aile forte (lat = s × width/4), les batteries décalées de s × width/4.
  - pt = le bataillon ennemi au bout de l'aile visée (même mécanisme qu'au § 4.2), et le feu s'y concentre.
5.2 Débordement (on garde _flank_group). Ajouts :
  (a) En difficile, un bataillon de la réserve (légère ou chasseurs d'abord) accompagne le groupe de flanc (rôle 'avant' et drapeau flg). Les canons ennemis de l'aile sont sa cible avec _storm_guns.
  (b) En difficile, 'art_vol' accompagne le groupe à 600 m derrière lui, puis prend l'aile ennemie d'écharpe à 0,7 × e.
  (c) Quand le groupe passe en 'attaque', l'ancre de la ligne garde sa distance, et la ligne fixe par le feu (pas de baïonnette avant que le groupe ait chargé ou que 600 s soient passées).
5.3 Enveloppement (doctrines 'moderne' et 'feu', variante 'enveloppe', dans _masse) : la masse ne va pas au centre.
  - s = l'aile ennemie la moins couverte (bout de la ligne ennemie vue, pas de bois ni de bâti à moins de 150 m).
  - But : lat_bout + s × 150, profondeur front − halt, face fd − s × 0,6 : elle tire dans le flanc de l'aile ennemie.
  - Ordre dispersé. Assaut seulement selon la règle de C5 'feu'.
  - Différence avec l'essai rejeté : la ligne n'est pas portée tout entière à l'aile. Seule la réserve y va, après la préparation, et la ligne fixe de face.

==================================================================
6. 1870 : LIGNE DE TIRAILLEURS PAR BONDS, LE FEU D'ABORD
==================================================================
- Bond : L['bound_feu'] (normal 150 m, difficile 120 m) au lieu de 220 m dès que doctrine == 'feu' et front < 1,6 × e_fo.
- Bonds par moitiés (L['halves'], difficile) : mem['half'] = ±1 change de signe à chaque _advance. Les bataillons dont le latéral × half < 0 restent un demi-bond en arrière (back + bound/2) et tirent pendant que l'autre moitié bondit. Le slot est calculé dans la boucle « ordres de la ligne ».
- En prepa : l'artillerie à 0,85 × e (1 190 à 1 530 m), l'infanterie défilée (C1, C2).
- Assaut final (« le bond à la baïonnette ») : seulement si le moral moyen ennemi vu dans le couloir est < 50, ou si la position est enveloppée (unité de la masse sur le flanc), par la règle C5.
- Cavalerie en 'feu' : dans _cav_target, plus aucune charge sur de l'infanterie à moral ≥ 45, sauf de dos (a > 2,3). Elle garde l'éclairage, la couverture des flancs et la poursuite.
- Mitrailleuses : rien de changé, elles restent sur e (code actuel).

==================================================================
7. POINTS D'APPUI : bois, villages, fermes (assaut en rase campagne)
==================================================================
Nouvelle _strongpoints(b, mem) : la liste des fantassins ennemis vus depuis moins de 300 s, valides, sur une case T_BATI, T_MUR, T_BOIS ou T_FORET_T, ou de couvert ≥ 0,35, regroupés à moins de 160 m. Chaque groupe donne sp = dict(id = l'id du premier, x, y, men, kind = 'bati' | 'bois', ids). Mise en cache dans mem['sp'], revue toutes les 120 s.
Nouvelle _strongpoint_att(b, side, mem, L, us, foes, sit, want, busy), appelée en 'assaut' et en 'combat', pour chaque sp à moins de 600 m devant notre ligne et dans |lat| < width/2 + 200 :
  (1) Masquer et tourner, si sp n'est pas le point de rupture et men(sp) < 0,25 × nos fantassins de ligne, ou s'il est hors de l'axe (|lat_sp − pt_lat| > 300).
      - Un léger (ou le bataillon de ligne le plus proche si aucun léger n'est libre) prend le rôle 'masque' : poste à 0,9 × sa portée efficace, face au sp, à couvert, en tirailleurs (en ligne avant 1855 pour l'infanterie de ligne).
      - Le reste de la ligne continue : _fine_halt ignore les ennemis du sp pour régler sa distance.
      - Note : « le bois de … est masqué par le 1er Légère ; la ligne passe à côté ».
  (2) Préparer, si sp est sur l'axe (on en fait le pt) ou trop fort pour être masqué.
      - Les batteries le visent (poids pt_k) pendant L['sp_prep'] : normal 480 s, difficile 720 s. En difficile, on attend aussi que le moral moyen des défenseurs passe sous 75.
      - Côté d'attaque : s = signe(lat_sp − latéral moyen du corps ennemi), soit le côté le plus éloigné du reste de la ligne ennemie (on évite d'être pris d'écharpe). Point d'approche à 120 m du sp, à l'angle fd + π + s × 0,7.
  (3) Assaut par vagues, maison par maison.
      - Groupe 'assaut_pt' : les 2 bataillons frais les plus forts au corps à corps (grenadiers d'abord ; _melee_power), plus les légers devant.
      - On marche en colonne jusqu'au point d'approche, puis on charge l'unité ennemie la plus proche du sp si _melee_power(u) ≥ L['sp_ratio'] × _melee_power(e) (normal 1,5, difficile 1,6 ; _melee_power compte déjà ×1,4 dans le bâti et ×1,5 sous couvert ≥ 0,5), ou si e.morale < 50. En forêt, où _charge_ok refuse, c'est l'ordre 'attack' (approche au corps à corps).
      - Une seule unité à la fois par cible : le moteur plafonne la pression dans les passages étroits (NARROW), entasser ne sert à rien.
      - Relève : une unité en mêlée depuis plus de 180 s avec un moral < 45 est relevée par la suivante, qui charge la même cible.
      - Prise : la cible cède ou fuit. L'unité occupe sa case (move vers son ancienne position), prend le rôle 'tient_pt', fait face à fd (elle profite alors elle-même du bâti et du couvert), et la vague suivante prend le défenseur suivant du sp.
      - Abandon : au plus L['sp_waves'] vagues (facile 1, normal 2, difficile 3). Ensuite on masque (1) et pt change de point.
  (4) 'feu' : pas d'assaut avant que deux de nos unités tiennent le sp sous le feu sous des angles écartés de plus de 90° (vu depuis le sp), et avant 600 s d'artillerie. Le feu de flanc compte ×1,4 au moral, et l'obus (spec['shell']) perce le couvert.
  Facile : (3) tout de suite, sans préparation ni choix du côté, avec les bataillons les plus proches (maladroit, comme aujourd'hui).
  Nouveaux rôles 'masque', 'assaut_pt' et 'tient_pt' : ajoutés aux listes de rôles de _roles_update (passage en 'rallie') et de _bayonets, et ignorés par la règle des trous. À la fin, ils repassent 'ligne' avec leur latéral d'origine (mem['lat'] gardé à part dans mem['sp_lat']).

==================================================================
8. POURSUITE
==================================================================
Dans _cavalry, avant le choix de cible ordinaire (L['pursue_r'] : facile 0, normal 600, difficile 700).
- Une cavalerie fraîche (morale > 55, fat < 60) qui voit des fuyards (e.state == 'deroute') à moins de pursue_r, sans fantassin ennemi valide à moins de 150 m d'eux et sans cavalier ennemi frais à moins de 450 m, reçoit b.order(side, [id], 'pursue'). Le moteur choisit le fuyard le plus proche, à moins de 700 m.
- Pas plus de la moitié des escadrons à la fois : l'autre moitié reste prête contre une contre-charge.
- Arrêt : fat > 70, ou plus de 900 s de poursuite (mem['pours'][id]). Retour au poste.
- Bois et marais : la règle actuelle s'applique déjà (_charge_ok).
- La phase 'poursuite' de la ligne se déclenche aussi quand sit['e_routed'] ≥ 2 et que le secteur de pt n'a plus de défenseur valide (pas seulement quand plus rien n'est en vue). La ligne avance alors d'un bond par réflexion, jusqu'à la dernière ligne ennemie vue, sans franchir les points d'appui encore tenus.
- Note : « l'ennemi plie : la cavalerie poursuit (1er hussards, 2e dragons) ».

==================================================================
9. PARAMÈTRES PAR NIVEAU (à ajouter à LEVELS)
==================================================================
| clé | facile | normal | difficile |
| def_r (défilement, m) | 0 | 30 | 60 |
| rupture (variantes rupture/enveloppe) | False | True | True |
| pt_k | 1.0 | 1.6 | 2.0 |
| pt_every (s, 0 = choisi une fois) | 0 | 0 | 300 |
| masse_mor | 0 (pas de masse) | 70 | 72 |
| masse_n | 0 | 1 | 2 |
| masse_line | 0 | 0 | 1 |
| masse_ratio | — | 1.0 | 1.1 |
| exploit_k | 1.0 | 1.3 | 1.6 |
| art_vol | False | False | True |
| echelon | False | True (aile ennemie ≤ 0,75) | True |
| ech_dt / ech_dd / ech_max | — | 150 / 90 / 260 | 150 / 90 / 260 |
| bound_feu | 600 (bound) | 150 | 120 |
| halves | False | False | True |
| pursue_r | 0 | 600 | 700 |
| sp (0 rien, 1 assaut direct, 2 complet) | 1 | 2 | 2 |
| sp_prep (s) | 0 | 480 | 720 |
| sp_waves | 1 | 2 | 3 |
| sp_ratio | 1.0 | 1.5 | 1.6 |
Le facile reste maladroit comme aujourd'hui (réserve d'emblée, colonne trop longtemps). Les corrections C1 à C3 s'appliquent pourtant à tous les niveaux, parce qu'elles corrigent une absurdité et non un savoir-faire. Toutes les clés passent par spec['ai_tweak'] pour les bancs : chaque nouveauté se désactive par sa clé.

==================================================================
10. FONCTIONS : liste des changements, et ce qui reste hors chantier
==================================================================
Nouvelles fonctions, à regrouper dans une section « # ---- attaque en rase campagne : doctrine, point de rupture, masse, échelons, points d'appui, poursuite », placée après _flank_group pour limiter les conflits avec les volets défense et places :
_doctrine, _choose_var, _defile, _point, _masse, _echelon_slot, _strongpoints, _strongpoint_att, _pursuit (appelée par _cavalry).
Fonctions modifiées :
- deploy et _deploy_field : variante, aile forte, cavalerie de réserve, batteries décalées, note de doctrine ;
- _adopt : doct et var recalculées, sans masse en cours ;
- _picture : la portée de l'infanterie dans vu[10], lue par défaut avec len(v) > 10 ;
- _think_field (branche de l'assaillant seulement) : standoff, défilement, bonds 'feu', échelons, appels _point, _masse, _strongpoint_att, poursuite ;
- _march_form (PARTAGÉE : C3 touche aussi la défense, à coordonner) ;
- _lights_att ; _cavalry et _cav_target (exploitation, poursuite, interdits de 'feu') ; _artillery (positions de la grande batterie, art_vol) ; _art_target (bout généralisé, pt_k) ; _bayonets (C5 et nouveaux rôles ; PARTAGÉE) ; _roles_update (nouveaux rôles, réserve gardée pour la masse ; PARTAGÉE) ;
- en-tête du module : nouveaux paragraphes « Plans », « Pendant la bataille » et « Niveaux ». Garder la phrase sur les essais retirés et y ajouter les résultats des nouveaux bancs.
Mémoire (JSON seulement) : doct, var, pt, pt_id, pt_lat, masse_t, masse_n, masse_fail, ech, t_ech, half, sp, sp_lat, sp_waves, vol, pours. Tout se lit par mem.get(), donc une vieille sauvegarde se recharge sans erreur.
Coût de calcul : _point en O(n²) sur les ennemis vus (≤ 15), _strongpoints revu toutes les 120 s, _defile seulement quand l'ancre bouge, au plus une recherche de vue de batterie par réflexion (règle 'looked' existante). But : au plus 15 % de temps de calcul de plus par bataille (banc : 4 s par bataille environ aujourd'hui sur le serveur du banc).
Hors chantier, à proposer au chef d'orchestre (optionnel, l'IA s'en passe) : BT.COL_SHOCK, un bonus de choc de la colonne d'attaque (×1,25 au choc, FALTER à 45 pour la colonne). Aujourd'hui, le moteur ne donne à la colonne que la vitesse (×1,1 contre ×0,8 en ligne) et la pénalise au feu (×1,2) et au boulet (×1,5). C'est pourquoi la masse se déploie en ligne avant de charger tant que COL_SHOCK n'existe pas.

==================================================================
11. VÉRIFICATION
==================================================================
11.1 Nouveau banc outils/banc_ia.py (fichier neuf : IA contre IA, sans campagne, sur le modèle du prototype bp.py).
  Arguments : --epoque 1700|1790|1813|1870 (plusieurs possibles), --n 24, --niv att def, --defk 0.7 (le défenseur à 70 %, puis AI.deploy(tb, 1) pour qu'il en tienne compte), --tweak '{"difficile": {"rupture": false}}' (spec['ai_tweak']), --proc.
  Mécanique : skirmish.new avec une graine, BT.ACCEL_LEVEL = niveau de l'attaquant (autofinish impose sinon 'normal' au camp du joueur), spec['ai_levels'] = [att, déf], autofinish(), run_to_end().
  Sortie : victoires de l'assaillant, durée moyenne, pertes des deux camps, motifs de fin, temps de calcul, et le nombre de batailles dont le journal contient « point de rupture », « échelons », « masse », « masqué », « poursuit ».
11.2 Critères d'acceptation : 96 batailles par case (4 époques × 24), parité et 1,43:1.
  - C1 à C3 : victoires de l'assaillant à parité dans ±3/96 de la référence du § 0, et dans ±5/96 à 1,43:1.
  - Chaque nouveauté (rupture, échelon, enveloppe, points d'appui, poursuite, art_vol), mesurée en difficile contre normal, avec et sans sa clé : elle ne fait pas perdre plus de 2/96. Sinon on la retire (clé à False par défaut), comme l'ordre oblique, et on le note dans l'en-tête.
  - Ensemble : à 1,43:1, le difficile contre normal gagne au moins 6 points de plus que le normal contre normal (aujourd'hui, il n'en gagne aucun). La durée moyenne d'une victoire tombe sous 3,3 h (aujourd'hui 3,6 à 4,7 h). Le rapport des pertes assaillant/défenseur ne s'aggrave pas de plus de 10 %.
  - À parité, l'assaillant difficile gagne au plus 30 % des batailles (on reste historique : on n'emporte pas une position à forces égales sans chance).
  - Le facile contre le normal reste nettement plus faible que le normal contre le normal à 1,43:1 (au moins 10 points de moins).
  - Campagne : python3 outils/simuler.py --parties 6 --epoque 1790 --annees 30 --graine 1 --proc 2, puis la même chose pour 1813 : toutes les mesures dans ±25 % de tasks/equilibre-reference.md.
11.3 Bancs unitaires (nouvelle classe IAAttaqueRaseCampagne dans tests/test_bataille.py, avec fabrique.bataille, autofinish et BT.ACCEL_LEVEL réglé puis remis) :
  1. test_la_ligne_attend_hors_du_chassepot : en 1870, phase 'prepa' plus 300 s ; chaque bataillon de ligne de l'assaillant est à au moins 1,2 × e_fo du fantassin ennemi vu le plus proche, et a au moins 90 % de ses cartouches.
  2. test_pas_d_ordre_disperse_avant_le_fusil_raye : en 1790, on échantillonne toutes les 60 s pendant 1 h 30 ; aucune infanterie non légère des deux camps n'est en 'tirailleurs' (hors ordre 'harass'). En 1870, au moins un bataillon de ligne l'est.
  3. test_grande_batterie : en 1813 avec artillerie=3, 600 s après le début de 'prepa' : mem['pt'] est posé, et au moins 2 batteries sur 3 ont une cible à moins de 260 m de pt.
  4. test_la_masse_se_jette_sur_le_point : on fabrique un secteur ennemi à moral 60 (on règle e.morale), phase 'combat' depuis plus de 300 s ; après une réflexion lourde, au moins un bataillon a le rôle 'masse', et la réserve en garde un si elle en avait 3.
  5. test_echelons_de_frederic : en 1700 difficile, 60 s après t_ech, le bataillon de rang 0 est au moins 120 m plus avancé (projection sur fd) que celui du dernier rang ; le journal contient « échelons ».
  6. test_le_point_d_appui_est_masque_ou_enleve : on cherche une case T_BOIS ou T_BATI devant la ligne et on y place un fantassin ennemi (face_a_face) ; _strongpoints le trouve ; après quelques réflexions, une unité a le rôle 'masque' ou 'assaut_pt' selon sa force.
  7. test_la_cavalerie_poursuit : un ennemi en déroute à 450 m d'un escadron frais de l'IA, sans soutien ; après réflexion, l'escadron est en charge sur un fuyard (kind 'charge') ; pas plus de la moitié des escadrons partent.
  8. test_en_1870_pas_de_charge_sur_une_ligne_fraiche : un fantassin ennemi à moral 80, de face, à 300 m de la cavalerie de l'IA ; _cav_target renvoie None.
  9. test_memoire_json : json.dumps(tb.ai_mem) passe après 2 h de bataille, et après une sauvegarde puis un rechargement (TacticalBattle to_dict/from_dict) la bataille continue sans erreur.
  Puis tous les bancs : python3 tests/test_bataille.py, test_campagne.py, test_serveur.py, test_cartes.py et node tests/*.test.mjs (python3 tests/lancer.py).
11.4 Ordre de réalisation conseillé (chaque étape passe le banc avant la suivante) : C1, C2, C3, C4, C5 → rupture (point, grande batterie, masse, rideau) → exploitation et poursuite → points d'appui → échelons → doctrine 'feu' (bonds, enveloppement) → art_vol.

**Histoire.** Ordre linéaire (1700 à 1788) : l'infanterie combattait déployée en lignes de trois rangs et se fusillait à 50 à 100 pas. Frédéric II gagna Leuthen (1757) en portant son effort sur une aile par une attaque en échelons, bataillon après bataillon, l'autre aile restant refusée.
Révolution et Empire : on passe à l'« ordre mixte ». Un rideau de voltigeurs harcèle, les colonnes d'attaque marchent vite et se déploient ou chargent près de l'ennemi. Une grande batterie prépare la percée sur un point choisi (Friedland, Wagram, Borodino, Waterloo : 80 à 100 pièces), une masse de réserve y est jetée, et la cavalerie exploite puis poursuit (Iéna, 1806). On attaque de front pour fixer, puis on déborde (manœuvre sur les derrières). Les troupes attendent la préparation défilées derrière les crêtes, couchées. Les points d'appui se prennent au prix fort et maison par maison, par vagues relevées : Hougoumont et la Haye-Sainte en 1815, Aspern-Essling en 1809.
Fusil rayé (Minié, années 1850), puis Chassepot (1866) : le feu tue à 500 m et davantage. En 1870, les Prussiens avancent en lignes de tirailleurs par bonds, une moitié tirant pendant que l'autre bondit. Le canon Krupp écrase d'abord l'artillerie, l'enveloppement par les ailes passe avant l'assaut frontal. La charge de cavalerie contre de l'infanterie en ordre devient un sacrifice : les cuirassiers de Reichshoffen, Floing à Sedan. Les assauts de front de la Garde prussienne à Saint-Privat lui coûtent 8 000 hommes en une heure.

---

SPÉCIFICATION — IA de bataille, volet ATTAQUE ET DÉFENSE DES PLACES
(conception seule : aucun fichier n'a été modifié. Fichiers visés : game/tactics/ai.py (surtout), game/tactics/battle.py (un nouvel ordre), tests/test_places.py (nouveau), outils/assauts.py (nouveau). terrain.py seulement en option, voir §6.)

======================================================================
0. ÉTAT DES LIEUX (mesuré, pas supposé)
======================================================================
Banc IA contre IA : mode Bataille « forteresse », attaque avec ligne=4, legere=1, cavalerie=1, artillerie=2 (plus les renforts ASSAULT_BONUS, soit environ 2 770 h et 4 batteries) contre la garnison tirée au sort (environ 2 000 h, milice et canons du rempart compris). Graines 1 à 16, 78 batailles :
- normal/normal 1790 : 14 batailles, 0 place prise ; 10 finies à la nuit, 4 où l'assaillant décroche ; brèche ouverte dans 8 sur 14 ; pertes moyennes : 20 % pour l'assaillant, 22 % pour le défenseur.
- difficile/normal : 1 prise sur 14. normal/difficile : 0 sur 12. facile/facile : 0 sur 16. 1700 : 0 sur 10. 1870 : 1 sur 12.
- Au total : 2 places prises sur 78 (3 %). 63 % des batailles finissent à la nuit, souvent après 6 à 7 h sans rien faire.
- Village barricadé (fort=0, bar=0.6, construit à la main) : l'assaillant attend 108 min une brèche qui ne peut pas s'ouvrir. Il donne un assaut, puis ne fait plus rien de 12 h 45 jusqu'à la nuit. Pertes : 15 % pour lui, 46 % pour le défenseur, et le village n'est pas pris.

À GARDER (ça marche) :
- le déploiement de la défense : deux bataillons de chaque côté de la brèche, à l'abri du mur, qui la prennent entre deux feux ; remparts face à l'assaillant ; milice dans les rues ; réserve et cavalerie au cœur ;
- les renforts tirés d'un rempart tranquille vers la brèche attaquée (et la diversion, qui empêche ce rempart d'être « tranquille » : l'effet est réaliste) ;
- la cavalerie du défenseur qui sort charger les batteries isolées et les troupes en désordre (ce sont déjà des sorties, mais sans règle) ;
- le plan d'assaut : préparation, diversion à 150 s, colonnes, seconde vague avec les ralliés, et _aim_breach ;
- côté moteur : brèches (BREACH_PTS), passages étroits (NARROW), maisons (×1,4 en mêlée), obstacle (×0,6 pour l'assaillant), ralliement par les officiers dans la place, cœur HEART_*.

DÉFAUTS À CORRIGER :
- B1. Les canons de l'assaillant battent à peine le rempart. Le moteur ne tire sur le mur (_bombard) que s'il n'y a pas de cible vivante, et l'IA donne toujours une cible (_art_target). Mesuré, graine 1 : 27 points sur les 240 nécessaires en 4 h. Les coups se dispersent aussi sur plusieurs pans (_wall_target prend le point le plus proche de chaque pièce).
- B2. Le regroupement ne dure que 2 min. Dans _think_place_att, « if mem.get('t_breach') … and now - mem['t_breach'] > 120 and t > 120: ready = True » reste vrai pour toute la bataille dès qu'une brèche s'est ouverte : chaque 'regroupe' repart au bout de 120 s (journal, graine 3 : repoussé à 9 h 53, relancé à 9 h 55).
- B3. Le cœur est réattribué en boucle. Dans _think_place_def, garde du cœur : tant que l'unité n'est pas arrivée à 120 m, une nouvelle est choisie et notée à chaque réflexion (graine 3 : plus de 25 fois « court tenir le cœur de la place » en 5 min).
- B4. L'assaillant attend la nuit. Une fois ses vagues épuisées (ASSAULT_WAVES), il ne fait plus rien : pas de nouvel assaut sur une brèche ouverte plus tard (graine 3 : brèche à 11 h 33, ignorée), pas de retraite.
- B5. Village ou bourg sans remparts (fort 0) : BREACH_WAIT s'applique alors que les barricades ne s'ouvrent pas au canon (_wall_target les saute). Les messages parlent de « brèche praticable ». L'assaut vise l'angle face à l'assaillant au lieu d'une ouverture des barricades.
- B6. Une brèche ouverte pendant la bataille ne reçoit pas de postes de flanc. Seul le renfort « hot » (1 ou 2 bataillons) y va.
- B7. Rien n'est prévu pour les ouvrages avancés (redoutes de terrain._redoubts), le retranchement derrière la brèche, le repli maison par maison, la garde des batteries de l'assaillant ou les « enfants perdus ».

======================================================================
1. MOTEUR (battle.py) : l'ordre « bombard » (batterie de brèche)
======================================================================
L'IA ne donne que des ordres que le joueur pourrait donner. On ajoute donc un ordre.
- battle.order(side, ids, 'bombard', x=, y=) : seulement pour l'artillerie (pas les mitrailleuses), du camp 0, dans une place qui a une enceinte (au moins un mur dont kind != 'barricade'), pendant le combat.
  - Effet : u.order = dict(kind='bombard', x=round(x), y=round(y)), u.target = None.
  - Réponses : « Batterie de brèche : on bat le rempart. » ; refus « Il n'y a pas de rempart à battre ici. » ; refus « Seuls les canons battent un rempart. ».
  - Un autre ordre (move, attack…) le remplace, comme d'habitude.
- _wall_target(u, mx, aim=None) : avec aim, prendre parmi les points des murs (hors barricades) à moins de mx de la pièce celui qui est le plus près de aim ; sinon, comme aujourd'hui.
- _fire, avant _pick_target : si l'ordre est 'bombard' et que l'unité est en batterie :
  1. légitime défense : tg = _pick_target(u, g * 1.0), seulement les ennemis à portée de mitraille (g de U.ranges ; 250 à 400 m). S'il y en a un, on tire à mitraille.
  2. sinon : _bombard(u, e, mx, aim=(x, y)), qui passe aim à _wall_target.
- Rien d'autre ne change : BREACH_PTS, _pound et dk restent tels quels. Calcul attendu : une batterie de 8 pièces à portée efficace apporte environ 8 points par coup toutes les 90 à 100 s. Deux batteries ouvrent un mur (fort 1, 240 pts) en environ 25 min, un rempart (fort 2, 480) en environ 50 min, un fort 3 en environ 75 min, ce qui correspond au commentaire de BREACH_PTS.
- Aide-mémoire en tête de battle.py : ajouter la ligne « 'bombard' (x, y) : batterie de brèche… ».
- (Le client n'est pas dans ce chantier. Un bouton « Battre en brèche » dans web/js/battle/doctrine.js sera à prévoir par le chantier interface. Le moteur l'accepte déjà de who='joueur'.)

======================================================================
2. ASSAUT D'UNE PLACE (ai.py : _deploy_place_att, _think_place_att, _artillery, _aim_breach)
======================================================================
Phases : 'prepa' → 'assaut' → 'regroupe' → 'assaut' … → 'investi' (nouvelle phase) → décrochage.

A1. Batterie de brèche (Vauban : battre un seul point, au pied du mur).
- Déploiement (fort ≥ 1) :
  - nb = max(1, ceil(na × L['batter'])) batteries (hors mitrailleuses), les meilleures en arme et en effectif, reçoivent mem['batter'][uid] = [ax_, ay_], le point du mur visé : px + cos(a_b) × (ri + 10), py + sin(a_b) × (ri + 10).
  - Poste : à d_b du point visé, sur la droite vers le rassemblement, décalé de ±55 m × k. d_b = min(0,8 × e, max(300, P_def + 80)), où P_def est la portée maximale des fusils ennemis repérés (b.ranges des unités vues, sinon 300). Ensuite _gun_spot(…, rough=True) au niveau terrain ≥ 1.
  - Les autres batteries gardent les règles actuelles (rôle 'art' : contre-batterie et feu sur la brèche).
- _artillery, plan 'assaut' : une batterie qui a mem['batter'] reçoit, une fois en batterie à son poste, en phase 'prepa', 'regroupe' ou 'investi' : b.order(side, [uid], 'bombard', x=, y=) si son ordre n'est pas déjà 'bombard'. On la met dans busy et on saute _art_target.
- En phase 'assaut' : retour à _art_target (le ×1,6 près de la brèche existe déjà).
- Contre-batterie (batteries sans 'batter') : dans _art_target, une cible artillerie dans la place (b.in_place) vaut ×1,5 de plus pendant la phase 'prepa'.
- _aim_breach : quand le pan visé est tombé, la batterie vise le pan voisin, du côté de a_b, pour élargir l'ouverture (« deux brèches côte à côte »). Une seule fois ; ensuite elle reste sur la dernière brèche.
- Journal : « la batterie de brèche (Nom) ouvre le feu sur le rempart » (_note_once).

A2. Préparation et attente.
- fort ≥ 1 : on garde L['assault_prep'] et BREACH_WAIT.
- fort 0 (village, bourg barricadé) : prep = assault_prep × 0,5, pas de BREACH_WAIT. Textes : « l'artillerie bat les barricades et les maisons ; les colonnes attendent. » puis « les colonnes d'assaut s'élancent sur les barricades ».
- Correction B2 : la règle t_breach ne vaut qu'en 'prepa', et pour une brèche ouverte pendant cette phase (t_breach ≥ t_phase). Une fois utilisée, mem['t_breach'] = None.
- On ne lance aucune vague si b.time_left() < 1800 s : on passe en 'investi'.

A3. Les « enfants perdus », puis les colonnes en échelons (Badajoz 1812, « forlorn hope »).
- À l'instant de l'assaut (passage en 'assaut') : mem['t_go'] = now + L['forlorn'] (facile 0, normal 60, difficile 90 s).
  - Le léger 'avant' court à bout (l'entrée de la brèche), en tirailleurs, run=True. Aujourd'hui il s'arrête à 90 m de la brèche.
  - S'il n'y a pas de léger, en difficile seulement : le bataillon 'assaut' le plus faible (sapeurs d'abord) devient 'enfants' et y va en colonne.
- Les unités 'assaut', triées par qualité (grenadiers en tête), ne partent qu'à t_go + 60 × (rang // 2) s : deux colonnes de front par brèche, puis les suivantes une minute plus tard. La brèche est un passage étroit (NARROW) : on évite l'embouteillage.
- La diversion part 150 s avant l'assaut (normal) ou 300 s avant (difficile, L['div_lead']).

A4. Logement dans la brèche (normal, difficile).
- La première unité 'vague2' qui arrive à bin (juste à l'intérieur) sans ennemi à moins de 100 m devient 'logement' : elle tient bin, en ligne, face au cœur. Les suivants passent ainsi, et une contre-attaque ne rejette pas tout dehors. Une seule unité, qui ne va pas au cœur.
- Journal : « Nom se loge dans la brèche. »

A5. Garde de tranchée (normal, difficile).
- Au déploiement, s'il y a au moins 4 bataillons : le dernier 'vague2' (sinon le bataillon de la diversion) devient 'garde'. Son poste : 90 m devant le centre des batteries de brèche, vers la place, en ligne. Il ne part jamais à l'assaut.
- Il protège les canons contre les sorties de cavalerie (une ligne ferme repousse une charge de face). Mesuré : la cavalerie de la garnison chargeait les « batteries isolées » sans obstacle.

A6. Village ou bourg barricadé (fort 0) : attaquer par les ouvertures, et des deux côtés.
- Nouvelle fonction _gaps(b, pl) → liste d'angles. Pour chaque segment de l'anneau de barricades (map.walls, kind 'barricade', l'anneau à R+15), la case du milieu n'est pas T_BARRICADE et b.passable(x, y, 'inf', 0). Bonus aux ouvertures sur T_ROUTE.
- a_b = l'ouverture la plus proche de fa, à moins de 1,2 rad, sinon fa. La diversion vise une seconde ouverture à au moins 0,8 rad de la première.
- La diversion devient une vraie seconde attaque (Aspern, Plancenoit) : en colonne, elle entre par son ouverture et marche au cœur à partir de t ≥ 120 s de la phase 'assaut'. Avec des remparts, la diversion reste une fausse attaque par le feu.
- Diversion avec remparts : les légers en tirailleurs à 0,9 × leur portée efficace du mur, l'infanterie en ligne à la même distance. Ils fixent les défenseurs du rempart.

A7. Vagues, puis 'investi', puis décrochage (correction B4).
- vagues_max = L['waves'] (inchangé : ASSAULT_WAVES=1 en normal et difficile, 0 en facile).
- Vague de brèche neuve (normal, difficile, L['bonus_wave']=1) : si une brèche s'ouvre après le début de la dernière vague (breach_t > t de cette vague) et que mem['bonus'] < 1, on autorise une vague de plus → 'regroupe' (texte « une nouvelle brèche est praticable : on prépare un nouvel assaut. »).
- Quand la dernière vague est repoussée (règle 'wave' actuelle) et qu'il ne reste aucune vague, on passe en 'investi' :
  - les unités 'assaut', 'vague2', 'res' et 'rallie' rejoignent leurs postes de départ (hors de portée des fusils) ;
  - les batteries de brèche battent toujours le mur (A1) ;
  - les légers tiraillent depuis leurs postes.
- Décrochage en 'investi' (dans _decide_withdraw ou à la fin de _think_place_att, avec b.withdraw(side) et une note) :
  - (aucune batterie de brèche valide avec munitions ≥ 10 %, ou fort 0) et now − t_phase > 1800 s → « l'assaut a échoué : on se retire dans les lignes » ;
  - ou b.time_left() < 2400 s → « la nuit vient : on rentre dans les tranchées ».
- La règle actuelle « la nuit tombe » (900 s) reste en dernier recours.
- Effet attendu : plus de 6 à 7 h d'immobilité. Une bataille d'assaut dure de 2 h 30 à 6 h.

======================================================================
3. DÉFENSE D'UNE PLACE (ai.py : _deploy_place_def, _think_place_def)
======================================================================
D1. Postes de flanc d'une brèche (correction B6).
- Extraire de _deploy_place_def une fonction _breach_posts(mem, pl, a, ri, br) → 2 postes, avec le même calcul qu'aujourd'hui (da = (br + 55) / ri, à rr − 22).
- Dans _think_place_def, quand len(mem['breach']) augmente, les deux postes de la nouvelle brèche sont tenus par les deux bataillons 'mur' tranquilles les plus proches (normal : 1, difficile : 2), ou par la réserve s'il en reste au moins 2.
- Le compteur actuel « moved » (1 ou 2) reste pour les brèches attaquées.

D2. Retranchement derrière la brèche (la « coupure » ou « retirade » de Vauban ; San Sebastián 1813).
- Normal et difficile (L['coupure']=1) : un bataillon tient chaque brèche, à r = ri − 110 sur l'axe de la brèche, en ligne face à la brèche, au meilleur couvert à 50 m (b.best_spot(x, y, 50, 'cover', side)). Il est pris dans la réserve si elle en a au moins 2, sinon dans le rempart le plus éloigné de fa.
- Nouveau rôle 'coupure', à ajouter :
  - à la liste de _roles_update (rallié) ;
  - à la boucle « want » de _think_place_def (forme 'ligne') ;
  - à _bayonets (portée 100 m).
- Difficile (L['breach_volley']) : les bataillons 'breche' et 'coupure' reçoivent b.order(..., 'fire', mode='volley') au premier contact. C'est le feu de salve à bout portant (85 % de la portée efficace, ×1,25 : VOLLEY_*), le feu qu'on attendait de troupes à l'abri derrière une coupure.

D3. Contre-attaque dans la brèche, puis retour offensif (normal, difficile).
- À chaque réflexion, pour chaque centre de brèche q de mem['breach'], cible = une infanterie ennemie vue à moins de 70 m de q avec (morale < 60 ou men < 0,75 × men0 ou state == 'melee').
- Candidats :
  - 'res' (colonne, moral > 55) à moins de L['b_counter'] (normal 300 m, difficile 400 m) ;
  - 'coupure' et 'breche' à moins de 150 m.
- On charge (b.order 'charge') si _charge_ok(b, side, u, e) et _melee_power(u) ≥ 0,8 × _melee_power(e). En difficile, tous les candidats chargent à la même réflexion, et la somme de leurs forces compte.
- Retour offensif : on ne poursuit pas au-delà de la brèche. Une unité non montée à plus de ri + 60 m du centre de la place reçoit son poste (want) dès que sa charge est finie.
- Facile : rien de plus que la règle actuelle (contre-attaque seulement quand l'ennemi est dans la place).
- Journal : « Nom contre-attaque à la baïonnette dans la brèche. » (_note_once, 600 s).

D4. Sorties contre les batteries de siège (Gérone 1809, Dantzig 1807 ; sortie de flanc, avant l'assaut).
- Limite : L['sortie'] sorties au plus (facile 0, normal 1 pour la cavalerie seule, difficile 2 pour la cavalerie ou un bataillon de ligne qui n'est ni 'breche' ni 'coupure'), au moins 1200 s entre deux sorties.
- Conditions :
  - une batterie ennemie vue depuis moins de 60 s, en 'batterie', à moins de 700 m du mur le plus proche ;
  - aucune infanterie ou cavalerie ennemie valide repérée à moins de 350 m d'elle, ni à moins de 250 m du point d'attaque P ;
  - aucune infanterie ennemie à moins de r_in + 250 m du centre (l'assaut n'est pas engagé) ;
  - l'unité de sortie est fraîche : moral > 60, men > 0,6 × men0, fatigue < 50 ;
  - b.path_cost(u → P) ≤ 1,6 × la distance + 300 (il y a une porte assez près).
- P = la batterie + 150 m de côté, perpendiculaire à son u.dir, du côté le plus court pour nous : on ne l'aborde pas de face (GRAPE_POINT).
- Déroulement : mem['sortie'][uid] = [étape, cible, t0], en types JSON.
  - 'sortir' : _goto(P, run=True) ;
  - 'charger' : à moins de 200 m de P → b.order 'charge' ;
  - 'rentrer' : quand la charge est finie (state hors de charge et melee), ou t − t0 > 600 s, ou une infanterie ennemie est à moins de 250 m → _goto(poste, run=True).
- Pendant la sortie, l'unité est dans busy (_cavalry et _bayonets ne la reprennent pas).
- Journal : « sortie de la garnison : Nom tombe sur la batterie du … » et « Nom rentre dans la place. ».

D5. Le cœur jamais dégarni (correction B3).
- Garde du cœur : s'il existe une unité 'coeur' valide, en route vers le cœur ou à moins de 130 m de lui, on ne fait rien. Sinon on en choisit une, notée par _note_once(b, mem, 'coeur' + uid, …, 1800).
- La contre-attaque des intrus (code actuel) n'emploie jamais une unité 'coeur'.
- Rappel du moteur : la place tombe si plus aucun défenseur valide n'est à moins de HEART_FREE (160 m). Le réduit (église ou hôtel de ville, sur du bâti) doit donc toujours être tenu.

D6. Combats de rue, maison par maison (Saragosse 1808-1809, Bazeilles 1870).
- Déploiement : mem['ilots'] = jusqu'à 6 postes [x, y, dir] à 0,5 R du centre, aux angles fa + k × 0,45 (k de −2 à 2), plus un vers le cœur. Chacun est passé par b.best_spot(x, y, 60, 'cover', side) et gardé seulement s'il tombe sur T_BATI.
- Les postes 'rue' de la milice passent aussi par best_spot(…, 50, 'cover') (normal, difficile).
- Déclenchement (L['ilots'] : normal 2, difficile 4 unités au plus) : au moins 300 hommes ennemis dans la place (r < r_in − 5) depuis au moins 60 s (mem['t_inside']).
- Les unités 'mur' ou 'breche' (pas l'artillerie) dont le poste est à moins de 300 m du centre des intrus, et qui n'ont aucun ennemi à moins de 120 m, prennent l'îlot libre le plus proche : rôle 'ilot', en ligne, portée de baïonnette 80 m. Elles se battent dans les maisons (cover 0,55 ; mêlée ×1,4 ; ralliement par les officiers dans la place).
- Journal : « l'ennemi est dans les rues : Nom tient les maisons de … ».

D7. Ouvrages avancés : redoutes (normal, difficile).
- Au déploiement : les murs kind='barricade' dont le centre est au-delà de max(ring) + 60 m sont des redoutes (terrain._redoubts).
- Un léger (tirailleurs), sinon un bataillon faible, tient chacune, au plus 2 : rôle 'ouvrage', poste au centre du carré.
- Il rentre au cœur, comme 'res', si l'infanterie ennemie vue à moins de 250 m dépasse 2 × u.men, ou si son moral passe sous 45. Il ne revient pas.
- Rien pour un village (il n'a pas de redoutes).

D8. Village (fort 0) : la cavalerie hors du bourg.
- Dans les rues, elle est inutile (les maisons freinent ×0,4). Poste : derrière le village, à ±(R + 150) de côté. Elle charge les troupes en désordre (moral < 60) ou en tirailleurs qui sortent du bâti, à moins de 450 m.
- Avec des remparts : comme aujourd'hui (au cœur, sorties D4).

D9. Canons du rempart (_art_target, côté défenseur, plan 'place').
- En l'absence d'infanterie ennemie à moins de 400 m des murs : une batterie ennemie à portée efficace compte ×2 (« on fait taire la batterie de brèche »).
- Une colonne à moins de 260 m d'une brèche compte ×1,6 (le pendant de la règle 'bout' de l'assaillant).

======================================================================
4. NIVEAUX (nouvelles clés de LEVELS, à documenter dans l'en-tête de ai.py)
======================================================================
| clé           | facile | normal | difficile |
|---------------|--------|--------|-----------|
| batter        | 0 (une seule batterie : nb=1) | 0,5 | 0,5 |
| forlorn (s)   | 0      | 60     | 90        |
| div_lead (s)  | 150    | 150    | 300       |
| bonus_wave    | 0      | 1      | 1         |
| garde         | False  | True   | True      |
| sortie        | 0      | 1 (cavalerie) | 2 (cavalerie ou infanterie) |
| b_counter (m) | 0      | 300    | 400       |
| coupure       | 0      | 1      | 1         |
| breach_volley | False  | False  | True      |
| ilots         | 0      | 2      | 4         |
Les redoutes (D7), la cavalerie hors du village (D8), le logement (A4), les ouvertures (A6) et les postes de brèche neuve (D1) suivent L['n'] ≥ 1. Les niveaux ne changent que les décisions, jamais les dégâts (règle du fichier).

======================================================================
5. MÉMOIRE ET PROPRETÉ
======================================================================
- Clés nouvelles en types JSON seulement : batter, t_go, bonus, sortie, n_sortie, t_sortie, ilots, t_inside.
- _adopt (reprise en plein combat) : appelle _deploy_place_att, qui crée batter. Côté défense, ajouter mem.setdefault('ilots', []) et le reste par setdefault.
- Ajouter les rôles 'coupure', 'ilot', 'ouvrage', 'logement', 'garde', 'enfants' aux listes de _roles_update (passage en 'rallie'), de _bayonets et de la boucle want concernée.
- Les ralliés de 'garde' reprennent 'garde', ceux de 'ilot' deviennent 'res'.
- Mettre à jour les docstrings (en-tête de ai.py : Déploiement, Plans 'assaut' et 'place', Niveaux ; aide-mémoire de battle.py pour 'bombard').

======================================================================
6. HORS CHANTIER (noté, pas fait ici)
======================================================================
- Attaque à l'aube ou de nuit (Vauban, Badajoz à 22 h) : le moteur commence à 8 h (START_H, fmt_hour, _hour, client heures.test.mjs) et ne réduit pas la vue la nuit. Il faudrait un spec['start_h'] et une vue de nuit : chantier moteur et client.
- Escalade en diversion alors qu'une brèche existe : battle.costs ne permet l'escalade (T_MUR = 14) qu'en l'absence de toute brèche. Il faudrait des coûts par unité (« échelles »).
- Porte enfoncée par les sapeurs (pétard, puis mine) : T_PORTE → T_BRECHE après 90 s au contact sans défenseur à 50 m. C'est un moteur à part.
- Faubourgs hors des murs : la carte n'en génère pas (terrain._town : bâti dans R × 1,05, enceinte à R + 25). C'est le chantier cartes.
- Coupure en dur : option terrain.py, un arc de T_BARRICADE à r0 − 70 derrière chaque brèche de siège (dmg ≥ 0,12). Elle ne change ni la graine ni la VERSION des cartes existantes sans accord du chantier cartes ; D2 suffit sans elle.
- Capitulation de la garnison (brèche praticable, garnison à moins de 1 contre 2) : c'est une règle de campagne.

======================================================================
7. VÉRIFICATION
======================================================================
7.1 Nouveau banc tests/test_places.py (unittest, en français, comme test_bataille.py).
- Assistant place_ia(fort=1, bar=0.0, typ=None, seed=1, era='1790', niveaux=('normal', 'normal'), units=dict(ligne=4, legere=1, cavalerie=1, artillerie=2)) :
  - S.new(GEO, kind='forteresse', role='att', …) ;
  - pour fort 0 : copie de tb.spec avec spec['place'].update(fort=0, type='village', bar=bar, dmg=0, dyn=0), unités sans src=='rempart', puis BT.TacticalBattle(GEO, spec, units, [0, 1]), bridge.default_deploy pour les deux camps, warm() ;
  - tb.me = None, toutes les unités en ctrl 'ia', spec['ai_levels'] = niveaux, tb.start().
- Tests :
  1. test_la_batterie_de_breche_bat_un_seul_pan : une batterie à 0,8 e du mur, un défenseur visible sur le rempart ; ordre bombard. Après 900 s, le secteur visé a au moins 90 % des points de tb.pound, et la batterie n'a pas tiré sur le défenseur.
  2. test_la_batterie_se_defend_a_mitraille : une colonne ennemie à 200 m → u.target = la colonne.
  3. test_deux_batteries_ouvrent_un_mur_en_moins_d_une_heure : fort 1 → len(tb.breaches) ≥ 1 avant 3600 s.
  4. test_bombard_refuse_hors_d_une_place et test_bombard_refuse_a_l_infanterie.
  5. test_le_regroupement_dure (B2) : mem en 'assaut' avec un t_breach ancien, a_men à 10 % → 'regroupe', et encore 'regroupe' 300 s plus tard.
  6. test_le_coeur_n_est_pas_reattribue (B3) : 30 min de bataille avec des intrus → au plus 2 notes « court tenir le cœur » par unité.
  7. test_sortie_contre_une_batterie_isolee : cavalerie de la garnison, batterie isolée à 500 m du mur, aucune infanterie ennemie à moins de 600 m. En 300 s, ordre 'charge' sur la batterie ; en 1200 s, la cavalerie est revenue à moins de 150 m de son poste (ou en route, l'étape 'rentrer').
  8. test_pas_de_sortie_en_facile.
  9. test_village_attaque_par_une_ouverture : fort 0, bar 0.6 → la case de mem['bout'] vers mem['bin'] n'est pas T_BARRICADE, et la phase 'assaut' commence avant 0,5 × assault_prep + 2 périodes.
  10. test_l_assaut_echoue_on_se_retire (B4) : assaillant sans canons, vagues épuisées → tb.withdrawing[0] dans les 1800 s + 60 s après le passage en 'investi'.
  11. test_breche_neuve_postes_de_flanc (D1) : _apply_breach forcée → dans les 120 s, deux unités ont un poste à moins de 60 m des postes calculés.
  12. test_memoire_json : json.dumps(tb.ai_mem) après 1 h de bataille.

7.2 Outil outils/assauts.py (nouveau, sur le modèle de mon script d'essai). Batailles IA contre IA.
- Options : --forts 1,2,3 --village 0.6 --niveaux normal:normal,difficile:normal,normal:difficile,facile:facile --epoques 1700,1790,1813,1870 --graines 1-12 --proc N.
- Colonnes : n, prises %, nuit %, décroche %, avec brèche %, 1re brèche médiane (min), durée médiane (min), pertes att. %, pertes déf. %, vagues, sorties, temps mort maximal (min).
- Le temps mort est le plus long intervalle sans perte ni coup sur le mur après le premier contact : on avance pas par pas et on suit la somme des u.lost et tb.pound.
- Point de départ mesuré (1790, normal/normal, 14 batailles) : 0 % de prises, 71 % à la nuit, 29 % où l'assaillant décroche, 57 % avec brèche, pertes 20 % et 22 %.
- Cibles après le chantier (12 graines × 4 époques) :
  - normal/normal, fort 1 et 2 : brèche dans au moins 85 % des batailles ; 1re brèche médiane entre 25 et 60 min (fort 1) et entre 45 et 90 min (fort 2) ; prises entre 30 et 50 % ; fin à la nuit dans au plus 25 % ; temps mort maximal d'au plus 60 min ; quand l'assaut est repoussé, l'assaillant perd au moins 1,2 fois plus (en %) que le défenseur ;
  - difficile/normal : de 10 à 25 points de prises de plus que normal/normal. normal/difficile : de 10 à 25 points de moins. facile/facile : pas plus que normal/normal. facile contre normal en défense : au plus 20 % ;
  - village barricadé (bar 0.6), normal/normal : prises entre 35 et 60 %, durée médiane d'au plus 4 h ;
  - assaillant sans canons contre fort 1 (escalade) : au plus 15 % de prises.
- Si les prises dépassent 50 % en normal/normal : baisser d'abord bonus_wave à 0 (le commentaire d'ASSAULT_WAVES met en garde), puis forlorn. Ne pas toucher aux dégâts.

7.3 Non-régression.
- python3 tests/test_bataille.py, tests/test_campagne.py, tests/test_serveur.py, tests/test_cartes.py et tests/test_places.py ; node --test tests/*.test.mjs (rien à attendre du client, puisque l'ordre n'est pas encore exposé).
- Si un test échoue dans un fichier d'un autre chantier, le relancer plus tard et le signaler.
- Campagne : les assauts entre IA se jouent en automatique et ne passent pas par cette IA. Comparer seulement avec python3 outils/bilan.py le taux de prises « commandée » et « auto » par niveau de fortification, après quelques assauts joués en « Finir automatiquement ». L'écart doit rester sous 15 points.

ORDRE DE RÉALISATION CONSEILLÉ
1. Corrections B2, B3, B5 (quelques lignes, gain immédiat).
2. Ordre 'bombard' et A1.
3. A7 ('investi').
4. A3, A4, A5, A6.
5. D1, D2, D3, D5.
6. D4, D6, D7, D8, D9.
7. Tests et outil à chaque étape. Une série outils/assauts.py après les étapes 2, 3 et 6.

**Histoire.** Au XVIIIe siècle, Vauban a fixé la méthode d'attaque des places (Traité de l'attaque des places, 1704) : parallèles ; on fait d'abord taire les canons de la place ; une batterie de brèche frappe un seul point au pied de la muraille jusqu'à ce que la brèche soit « praticable » ; on prépare une diversion ou une fausse attaque ; on donne l'assaut au point du jour ou à la nuit tombante. En tête vont des volontaires, les « enfants perdus » (le « forlorn hope » des Anglais à Badajoz et Ciudad Rodrigo en 1812), puis les grenadiers et les colonnes en échelons. Après eux, une troupe « se loge » dans la brèche pour la garder. Une garde de tranchée protège les batteries contre les sorties.

La défense répond par une coupure (ou retirade) creusée derrière la brèche : à San Sebastián en 1813, les défenseurs prenaient la brèche entre deux feux. Elle contre-attaque à la baïonnette dans la brèche puis rentre sans poursuivre. Elle fait des sorties de flanc contre les batteries et les travaux (Gérone 1809, Dantzig 1807). Elle garde une réserve au réduit et tient les ouvrages avancés, comme les lunettes et les redoutes. Quand l'enceinte est forcée, on se bat maison par maison (Saragosse 1808-1809, Tarragone 1811, Bazeilles 1870).

Les villages sont défendus par leurs lisières, leurs barricades, leurs murs de jardin et l'église, qui sert de réduit : Aspern-Essling, Plancenoit, Hougoumont, Saint-Privat. L'assaillant les prépare au canon, les aborde par les entrées et les attaque de deux côtés, pendant que la cavalerie attend derrière ceux qui en sortent en désordre.

Les assauts sur une brèche praticable réussissaient souvent, à un prix très lourd (Badajoz, Ciudad Rodrigo, Tarragone ; San Sebastián au second assaut). Sans vraie brèche, ils échouaient presque toujours (Burgos 1812, Saint-Jean-d'Acre 1799). Repoussé, l'assiégeant continuait de battre le mur pour un nouvel assaut, ou se retirait dans ses lignes.

---

## 2. Suites des chantiers déjà faits

### Précision au tir
- Banc de campagne outils/simuler.py et ligne du README sur la mousqueterie : pas mis à jour.
- Bonus de tir visé pour les tirailleurs : pas fait.
- Pertes par arme dans le banc d'équilibre : non vérifiées une à une. Seuls le total et la durée l'ont été.

### Valeurs chiffrées (game/tactics/stats.py, web/js/valeurs.js)
- La « Précision » affichée est celle à bout portant. La chute avec la distance, propre à chaque arme, n'apparaît pas :
  un fusil rayé est noté 1,18 fois un silex, mais il fait 2,28 fois plus de pertes à 80 m. Il faut le dire dans la
  bulle d'aide, par exemple avec la demi-justesse D50 dans l'aide de la Portée.
- Les technologies de combat ne sont pas comptées dans les batailles commandées : Feu de rang, Ordre mixte,
  Cuirassiers, Artillerie à cheval, inf_power, all_power. Elles ne servent qu'à la résolution automatique, et donc
  ne figurent pas dans les valeurs. Il faut les faire passer bridge → spec → battle.py, puis les lire dans stats.py.
- stats.py recopie des chiffres de battle.py : 0,8 + xp/250, l'élan 2,2, les traits de général. battle.py devrait
  plutôt appeler stats.xp_k et stats.ELAN, pour éviter que les deux dérivent.
- Les étoiles d'expérience ne se comptent pas de la même façon : xp/20 en bataille (0 à 5), et 10/30/60 en campagne (0 à 3).

### Compléter les rangs
- Laissés de côté exprès :
  - remontes plus lentes pour la cavalerie et l'artillerie ;
  - coût en livres ;
  - ligne « rangs complétés » dans le bilan du mois ;
  - recréation des régiments anéantis.
- Aucun bouton dans le récapitulatif de fin de bataille : le bouton est dans le panneau de l'armée survivante.
- Le cas « armée affaiblie hors de ses places » n'a pas été vu dans le navigateur.
- « Arrêter les renforts » écrit deux messages un peu redondants dans le journal.
- Équilibre simulé sur 2 ans seulement.
