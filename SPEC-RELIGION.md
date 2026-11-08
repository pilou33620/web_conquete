# Spec : religion, révoltes et guérilla (8/11/2026)

État : **décidée par Claude le 8/11/2026** (le joueur, absent, a dit « tu peux tout faire toi »). Troisième chantier de
`tasks/idees-fonctionnalites.md`. Les choix faits à sa place sont marqués « (décision) ».

## Objectif

Donner un fond à l'ordre public : la confession des places et la politique religieuse du camp, des révoltes qui
prennent corps en **bandes armées** sur la carte, des **brigands** sur les routes et des **partisans** dans les pays
occupés. Le camp les réprime, les apaise ou les retourne contre l'ennemi ; les IA vivent les mêmes règles.

## Ce qui existe (relevé du 8/11)

- Ordre public par place (`n['stab']`), qui tend vers une cible (`engine.economy` : impôts, famine, banqueroute,
  lassitude, assimilation, garnison, bâtiments et politique de la ville) ; la production suit l'ordre public.
- **Révolte** d'une place (`engine.monthly`) : ordre public < 0,45, ni garnison ni armée, hors chef-lieu → elle
  redevient indépendante (ou retourne à son département d'origine). **Soulèvement** d'un pays absorbé (`uprisings`).
- Événements locaux de ville (`cities.py`) : « brigands », « émotion populaire »… ; événements datés et aléatoires
  (`events.py`) : Grande Peur (1789), Trois Glorieuses (1830)… ; technologies « gendarmerie » (ordre public +8 %) et
  « secours mutuels » (révoltes −50 %).
- Ravitaillement des armées (`a['supply']`, magasins aux vivres), espionnage (`R.SPY`), journal et récapitulatif du
  mois (les lignes `revolte` importantes y passent déjà).
- Rien sur la religion, ni bandes armées hors des camps, ni partisans (recherche du 8/11 : `relig`, `bandit`,
  `partisan`, `chouan`, `clerg`, `protestan`…).

## Décisions

### Confession des places

1. Chaque place a une **part de réformés** (`n['rp']`, de 0 à 1) : une part par département (Gard 35 %, Bas-Rhin
   luthérien 40 %, Ardèche, Lozère, Drôme, Deux-Sèvres, Charente-Inférieure, Tarn, Béarn…), et des villes connues
   bien plus protestantes (Orthez, Salies, Nérac, Tonneins, Bergerac, Sainte-Foy, Montauban, Nîmes, Alès, Anduze,
   Mazamet, Mulhouse, Montbéliard, Strasbourg…). Les villages varient autour de la part du département (tirage fixe
   par place). Sous 3 %, la place est dite catholique ; « mixte » à partir de 15 %, « protestante » à partir de 50 %.
2. Une **ferveur catholique** par département (×1,6 dans l'Ouest de la chouannerie, le Massif central, le Pays basque,
   la Savoie ; ×1 ailleurs) : elle grossit les réactions des catholiques à une politique anticléricale.
3. Les **juifs** d'Alsace, de Lorraine, de Bordeaux et de Bayonne ne sont pas une confession de place (décision) : ils
   paraissent dans un événement daté, l'émancipation de 1791.

### Politique religieuse du camp

4. Cinq politiques (`f['culte']`), chacune ouverte à son époque :

| Politique | Années | Ordre public des réformés | des catholiques | Autre |
|---|---|---|---|---|
| Tolérance | toujours | — | −2 % avant 1787 (le clergé grogne) | — |
| Contrainte (édit de Fontainebleau) | jusqu'en 1789 | −15 % × part | +2 % | exil des réformés |
| Dragonnades | jusqu'en 1760 | −30 % × part | +4 % | exil et conversions forcées |
| Concordat | dès 1801 | — | +3 % | livres −3 % (le clergé salarié) |
| Clergé soumis à l'État (Constitution civile, puis anticléricalisme, puis laïcité dès 1880) | dès 1790 | — | −8 % × ferveur | livres +4 % (biens du clergé) |

   L'effet sur l'ordre public d'une place mêle les deux confessions selon sa part de réformés. Les livres passent par
   les modificateurs du camp (`recompute_mods`), l'ordre public par la cible de chaque place.
5. **Exil** (contrainte, dragonnades) : chaque mois, une place réformée perd 0,3 % (1 % sous les dragonnades) de sa
   population × sa part ; ces artisans et négociants vont chez le voisin tolérant le plus proche (ses réfugiés,
   `f['refu']`, comme après un sac), sinon au Refuge hors de la carte. Les **conversions forcées** des dragonnades
   baissent la part de réformés de 2 % par mois (un « nouveau converti » reste mal converti : l'ordre public ne suit
   pas tout de suite). Recrues et commerce baissent par la population et l'ordre public, sans règle à part (décision).
6. **Départ** : 1700 → contrainte ; 1790 → tolérance ; 1813 et 1870 → concordat. Une politique sortie de son époque
   passe à la tolérance (ou au concordat après 1801). Une ancienne sauvegarde reçoit la politique de son année.
7. **Événements datés à choix** (`events.py`, ajoutés depuis `game/revoltes.py`) : les nouveaux convertis du Béarn
   (juin 1700, Basses-Pyrénées), les Camisards (juillet 1702 ; Gard, Lozère, Ardèche), l'affaire Calas (1762,
   Haute-Garonne), l'édit de tolérance (novembre 1787, seulement pour un camp qui a des réformés : un événement daté
   peut désormais avoir une condition, `cond`), la Constitution civile du clergé (juillet 1790), l'émancipation des
   juifs (septembre 1791), le Concordat (juillet 1801), les décrets Ferry (1880). Chacun propose de changer de
   politique (effet `culte`), de payer, ou fait naître une bande (effet `bande`). Les assemblées du Désert ne sont pas
   datées (décision) : c'est l'événement aléatoire de la décision 8.
8. **Événement aléatoire** « Une assemblée au Désert » pour un camp qui contraint des réformés : disperser par les
   dragons, fermer les yeux, ou négocier.

### Révoltes

9. **Insurrection** : chaque mois, une place (hors chef-lieu, hors siège) dont l'ordre public est sous 30 % peut se
   soulever même avec une garnison : une **bande d'insurgés** naît sur la place (80 à 1 200 hommes selon la
   population et la colère), avec sa cause (impôts, famine, guerre, religion, occupation). Au plus une insurrection
   par camp et par mois, et trois bandes d'insurgés par camp. La révolte existante d'une place sans garnison
   (sous 45 %) est gardée telle quelle (décision : elle est réglée et mesurée).
10. **Les bandes** (`g.bandes`, une liste sauvegardée) sont posées sur une place : `dict(id, k, n, node, c, sp, why,
    nom, t0)` : genre (insurgés, brigands, partisans), hommes, place, camp visé, camp qui les soutient. Elles ne sont
    pas des armées (décision : rien des armées, batailles, ravitaillement et IA militaire n'a à les connaître) ; leurs
    combats se règlent en un coup, puissance contre puissance.
11. **Chaque mois**, une bande d'insurgés attaque la place où elle se tient si elle appartient au camp visé : plus forte
    que sa défense (milice, garnison, armées, remparts), elle la prend : la place redevient indépendante, ou retourne
    à son département d'origine s'il vit encore (comme la révolte existante). Plus faible, elle perd 30 %. Puis elle
    marche vers la place voisine du camp visé la moins bien défendue. **Jamais un chef-lieu** : une révolte ne raye
    pas un camp de la carte.
12. Une bande grossit de 10 % par mois là où l'ordre public reste bas (sous 50 %), fond de 15 % ailleurs ; sous
    60 hommes elle se disperse. **Contre-guérilla passive** : les garnisons de la place et des places voisines du
    camp visé la saignent chaque mois (davantage avec de la cavalerie ; ×1,5 avec la gendarmerie).
13. **Réprimer** : une armée du camp visé (ou d'un allié) arrêtée sur la place de la bande la combat le jour même :
    puissance de l'armée (cavalerie ×1,8 contre une bande) contre celle de la bande (×1,3 en forêt et en marais,
    ×1,5 en collines et montagnes). Plus forte, elle l'écrase ou la disperse ; plus faible, elle perd du monde et du
    moral.
14. **Apaiser** (concessions) : le camp visé paie 0,8 livre par insurgé ; la bande se disperse et les places alentour
    regagnent 10 % d'ordre public. Pour une bande de **religion**, apaiser fait aussi baisser la contrainte d'un cran
    dans la région (les réformés de ces places reçoivent +10 % d'ordre public pendant un an).
15. **Événements datés** qui font naître des bandes là où leurs départements existent (en géographie 3 ; le Sud-Ouest
    a les siens) : la révolte des Tard-Avisés (1707, Lot), la guerre des Camisards (1702), la Grande Peur et ses
    jacqueries (1789 : on garde l'événement existant, auquel s'ajoute une jacquerie dans les camps qui laissent
    passer l'orage), la Vendée (mars 1793 : Vendée, Maine-et-Loire, Loire-Inférieure, Deux-Sèvres), la chouannerie
    (1794 : Mayenne, Ille-et-Vilaine, Morbihan, Côtes-du-Nord, Sarthe, Orne, Manche), la guerre des Demoiselles (1829,
    Ariège), les canuts (novembre 1831 et avril 1834, Rhône), les journées de juin 1848 (Seine), la Commune (mars
    1871 : Seine, et les communes de Lyon, Marseille, Saint-Étienne, Narbonne, Toulouse, Limoges, Le Creusot), Mandrin
    (1754, brigands). L'événement existant de la Grande Peur est laissé tel quel (décision : `events.py` touché le
    moins possible) ; « les châteaux brûlent » (28 juillet 1789, tous les camps) le suit avec sa jacquerie. En
    géographie 2 : les châteaux brûlés, les nouveaux convertis du Béarn, l'édit de tolérance, la Constitution civile,
    l'émancipation des juifs (Gironde, Basses-Pyrénées), le Concordat, Ferry, et les assemblées au Désert. Chacun
    propose des choix : réprimer d'avance (des régiments), céder (des livres, l'ordre public), ou laisser faire (la
    bande naît plus grosse). Une bande d'événement naît dans une place du département du camp, de préférence agitée
    (et réformée pour une révolte de religion).

### Brigands et partisans

16. **Brigands** : chaque mois, un camp peut voir naître une bande de brigands (60 à 200 hommes) dans une de ses
    places sans garnison hors chef-lieu, de préférence un village en forêt ou en montagne ; plus souvent en guerre, en famine et quand l'ordre public est
    bas ; deux fois moins avec la gendarmerie. Au plus une bande de brigands par camp. Elle ne prend pas de places :
    elle **pille** : le camp perd 0,3 livre par brigand et par mois, la place et ses voisines −40 % de livres pendant
    un mois (convois et marchés ; jamais le chef-lieu, qui a sa maréchaussée), et les armées du camp à moins de 15 km perdent du ravitaillement. Elle change de village une fois
    sur deux.
17. **Amnistie** des brigands : 0,5 livre par brigand, et la moitié s'engage (recrues).
18. **Partisans** : dans une place occupée (tenue par un camp en guerre avec son département d'origine, mal
    assimilée), chaque mois, une chance de voir naître une bande de partisans (80 à 300 hommes) qui sert son pays
    d'origine. Ils ne prennent pas les places (décision : l'équilibre), mais **harcèlent** : les armées de l'occupant à
    moins de 25 km perdent du ravitaillement et 2 % de leurs hommes par mois, la garnison de leur place 5 %, la place
    produit moitié moins pour l'occupant. Ils se dispersent à la paix. Au plus deux bandes de partisans par
    occupant et par pays.
19. **Lever des partisans** : un camp en guerre peut, depuis une de ses places d'origine occupée par l'ennemi, payer
    120 livres et 40 armes pour faire naître une bande de 250 partisans.
20. **Soutenir une révolte** chez un camp en guerre avec soi : 150 livres et 50 armes, la bande grossit de 40 % et son
    soutien est connu. **Fomenter une révolte** : une nouvelle mission d'espion (« Soulever la population », 200 livres,
    en guerre, 50 % de chances) fait naître une bande d'insurgés dans une place ennemie dont l'ordre public est sous
    70 %.

### IA

21. **Politique religieuse** : chaque année, l'IA prend la politique de son époque qui rapporte le plus d'ordre public
    (plus les livres, moins l'exil de ses artisans, pondéré par les habitants) sur ses places ; un camp belliqueux
    préfère la contrainte s'il a peu de réformés. Elle ne prend jamais d'elle-même les dragonnades (seulement par un
    événement). Aux
    événements, elle choisit selon les poids `ai` comme ailleurs.
22. **Répression** : tous les dix jours, pour chaque bande qui la vise, l'IA envoie la plus proche de ses armées au
    repos assez forte (1,3 fois la bande) ; l'armée en chasse n'est plus réaffectée par la réflexion militaire tant
    que la bande vit, qu'elle vise toujours ce camp, et 45 jours au plus. Faute d'armée, elle **apaise** les insurgés qui menacent une place, ou **amnistie** les brigands,
    si son trésor le permet.
23. **En tirer parti** : en guerre et riche, l'IA soutient les révoltes chez l'ennemi et lève des partisans dans ses
    places d'origine occupées.

### Interface

24. **Panneau de ville** : la confession (« catholique », « mixte, 30 % de réformés »…) ; pour ses places, la
    **menace de révolte** (faible, forte, imminente) et ses causes ; s'il y a une bande sur la place, sa ligne
    (genre, hommes, cause, camp qui la soutient) et ses boutons : « Apaiser » ou « Amnistier » (camp visé), « Soutenir »
    (ennemi du camp visé), et dans ses places occupées « Lever des partisans ».
25. **Panneau Production et impôts** : la politique religieuse (liste des politiques de l'époque et leurs effets), et
    le nombre de réformés de vos terres.
26. **Carte** : chaque bande vue (sur vos terres, ou à portée de vos yeux) a sa marque sur sa place : un fanion (rouge
    des insurgés, noir des brigands, vert des partisans) avec ses hommes ; toucher la marque choisit la place.
27. **Récapitulatif du mois et journal** : insurrections, places prises par les bandes, combats contre elles,
    pillages ; les fenêtres d'événements sont celles des événements à choix.
28. **Espionnage** : la mission « Soulever la population » paraît avec les autres, en guerre.

### Géographies, sauvegardes, performance

29. Géographie 2 (Sud-Ouest) : protestants d'Orthez, Salies, Nérac, Tonneins, Bergerac, Sainte-Foy… ; brigands des
    Landes et des Pyrénées ; partisans dans les places occupées. Géographie 3 : toute la France, les événements datés
    là où leurs départements existent.
30. **Anciennes sauvegardes** : `g.bandes` vide, `f['culte']` selon l'année, `n['rp']` d'après la carte
    (`religion.migrate`).
31. **Performance** (89 camps) : un seul passage mensuel sur les places ; l'effet sur l'ordre public est lu d'un cache
    par place ; le contact armées-bandes, chaque jour, ne regarde que les places où se tient une bande.
32. **Interrupteur** du banc : `CONQUETE_SANS_RELIGION=1` coupe tout le chantier (comparaisons d'équilibre).

## Risques

| Risque | Impact | Parade |
|---|---|---|
| Les bandes rayent des camps | Haut | jamais de chef-lieu ; plafonds par camp ; décroissance ; banc |
| L'ordre public s'effondre en 1700 (contrainte) | Moyen | effets proportionnels à la part de réformés, faible en dehors de quelques pays |
| Trop de bruit au journal (89 camps) | Moyen | seules les bandes du joueur, de ses voisins ou qui le visent sont importantes |
| Lenteur en France | Moyen | passage mensuel, cache de l'effet par place, contact limité aux places des bandes |
| Les IA ignorent les bandes | Moyen | chasse et apaisement dans `ai_step`, contre-guérilla passive |
| Anciennes sauvegardes | Bas | `religion.migrate` |

## Critères de réussite

1. Une place réformée sous contrainte s'agite, s'exile, peut se soulever ; la tolérance la calme.
2. Une insurrection fait naître une bande qui prend des places sauf les chefs-lieux ; une armée l'écrase ; des
   livres l'apaisent.
3. Les brigands pillent, les partisans harcèlent l'occupant ; la paix disperse les partisans.
4. Les IA chassent les bandes, apaisent, soutiennent les révoltes chez l'ennemi.
5. Le joueur voit tout cela (ville, impôts, carte, récapitulatif) ; banc d'équilibre dans ±25 % à 1700 et 1790 ;
   tous les tests passent.

## Hors périmètre

Clergé comme ressource ou ordre à part ; juifs et autres confessions comme part des places ; conversions volontaires
et missions ; bandes qui fusionnent ou se déplacent en continu comme des armées ; bataille tactique contre une bande.
