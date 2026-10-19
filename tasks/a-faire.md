# À faire : technologies et rendu selon l'époque (point du 19/10/2026)

Le détail des tâches est dans `tasks/todo-tech.md`, la spec dans `SPEC-TECH.md`, le plan dans `tasks/plan-tech.md`.
Les phases 0 (règles), 1 (batailles) et 2a (le train) sont écrites, revues et commitées. Il reste ce qui suit.

## 1. En cours sur le Pi (rien à faire, il faut attendre)

- [x] Banc d'équilibre 1870 → 1895, avant et après le train (`/tmp/eq3-avant-1870.txt`, `/tmp/eq3-apres-1870.txt`).
  - Résultat : tout reste dans ±25 % ; il y a environ 40 tronçons construits par partie.
  - Guerres : 8,8 → 8,5 (−3 %).
  - Durée d'une guerre : 3,1 → 3,8 mois (+23 %, **près de la limite**).
  - Écart de places : 81,7 → 77,2 (−6 %).
  - Trésor : +20 %.
  - Hommes : +5 %.
- [x] Banc d'équilibre 1813 → 1853, avant et après : tout reste dans ±25 % (guerres +14 %, durée −3 %, écart −8 %,
  trésor −7 %), environ 37 tronçons par partie.

## 2. Ce qui me reste pour finir la phase 2a (tâche T78)

- [x] Lire les bancs et les écrire dans `tasks/equilibre-reference.md` : **Point 2a-1 franchi**. Deux mesures sont
  proches de la limite en 1870 : la durée des guerres (+23 %) et le trésor (+20 %).
- [x] Prendre une sauvegarde faite avec le code d'avant le train, la charger avec le nouveau code et la jouer un an.
- [x] Refaire la capture de contrôle de la carte avec les corrections de la revue. Elle a dépassé son délai à cause de
  la charge du Pi.
- [x] Ajouter une section « Le train » à la galerie (`captures-3d/animations/`) :
  - rails et gares ;
  - un chantier ;
  - une ligne coupée ;
  - des trains qui roulent ;
  - le panneau « Voie ferrée » ;
  - une armée en train.
- [x] Noter l'état de la phase 2a dans `SPEC-TECH.md` et cocher T69 à T78 dans `tasks/todo-tech.md`.
- [x] Mettre le graphe à jour (`graphify update .`), puis commiter.

## 2 bis. Bugs signalés le 19/10/2026 (corrigés, commit `22e1f41`)

- [x] La fenêtre « Devant la ville » se rouvrait en boucle quand on la fermait : la fermer vaut maintenant « Attendre ».
- [x] Sortir une armée de la garnison : le bouton s'appelle « Sortir de la garnison (former une armée) » ; après « Mettre
  en garnison », le panneau de la ville défile jusqu'à lui, et le message dit où le trouver.

## 3. Ce qui t'attend, toi

- [ ] **L'essai sur l'iPad** (Point 1b), en bataille :
  - les images par seconde ;
  - les piquiers ;
  - la fumée, puis la poudre sans fumée ;
  - les canons de chaque génération ;
  - les mitrailleuses ;
  - les drapeaux.
- [ ] **L'essai sur l'iPad de la carte avec les trains** : la carte doit rester fluide une fois zoomée.
- [ ] **Ton avis sur la galerie « Le train »** (port 8799, en haut de la page).
- [ ] **GitHub.** Rien n'est poussé.
  - Il y a environ 40 commits sur le Pi seulement.
  - GitHub a aussi un commit que le Pi n'a pas : `d6db56b` « Spec, étape 9 : le rendu d'Ultimate General », du
    18/10 à 22 h 47.
  - Les deux ont divergé : il faudra fusionner ce commit avant de pousser. Dis-moi quand.

## 4. La suite (chaque morceau passera par spec, plan et ton accord avant le code)

- [ ] **Phase 2b : l'industrie sur la carte.**
  - Télégraphes : poteaux et fils le long des routes.
  - Bateaux à vapeur sur les fleuves.
  - Usines et cheminées dans les villes industrielles.
- [ ] **Phase 2c : le paysage.**
  - Les champs, les canaux et les forêts changent avec l'agriculture et l'industrie.
- [ ] **Phase 2d : l'allure de la carte.**
  - Les drapeaux d'époque sur les villes.
  - Les passants et les voitures selon le siècle.
  - Le style de la carte (gravure, puis lithographie, puis carte d'état-major).
- [ ] **Phase 3 : les découvertes.**
  - Une mise en scène sur la carte quand une technologie est trouvée.
  - La fenêtre « gravure ».
  - La frise des découvertes.
  - Le bandeau qui annonce les découvertes des IA.
- [ ] **Phase 4 : le décor des batailles.**
  - Les retranchements et les ballons d'observation visibles.
  - Les voies ferrées, les poteaux télégraphiques et les usines sur le terrain de bataille, selon l'année.
