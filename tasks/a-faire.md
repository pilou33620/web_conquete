# À faire : le rendu d'Ultimate General (point du 20/10/2026)

Specs : `SPEC-RENDU.md` (étape 9, parties A à D) et `SPEC-CARTES.md`. Tout ce qui est coché est poussé sur `main`.
**Tout ce qui reste, partie par partie (avec les décisions D1 à D7 à prendre et l'ordre de livraison) : `SPEC-SUITE.md`.**

## Fait le 20/10/2026

- [x] 9a l'image (heures, après-rendu) `ab67ed2` ; 9b les sols `221f9e8` ; 9c le relief `f960c54` ; 9d les bois `8c09442` ;
  9e le piétinement `b8ea6e0`.
- [x] Caméra en biais `6a232ec` ; interface de bataille en ardoise `0e74063` ; 9h en partie (liseré de lumière, ombre de
  régiment) `3620899`.
- [x] Régiments en bandes denses, parcelles arrondies, couleurs vives `ae8b2a3` ; fumée en bancs `ccee138`.
- [x] Le panneau « Bataille seule » ne remonte plus quand on ajoute une unité `b552391` ; herbe en volume (9f) `eb96ca5`.
- [x] Cheval animé Quaternius (CC0) (9j) `8584bd4`.
- [x] Cartes de bataille composées comme celles d'UGAR, le verger, le glacis dégagé `6c4bc0c` ; une bataille en cours
  d'une ancienne sauvegarde garde sa carte (`terrain_v1.py`, à ne jamais modifier) `c8e88b9`.
- [x] Carte de campagne à la manière d'UGAR (relief ombré, saisons, côtes, forêts, plaques, interface en ardoise) `810efca`.

## Bloqué : il me faut tes deux téléchargements (dans le dossier Téléchargements)

- [ ] **Les soldats** : [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) de Quaternius
  (CC0), fichier `Universal Base Characters[Standard].zip` (122 Mo) : « Download Now », puis « No thanks, just take me
  to the downloads ». Itch.io refuse le téléchargement depuis mon navigateur (« invalid key »). Autre solution : tu
  m'autorises à passer par ton Chrome (Claude in Chrome).
  - Ensuite : allégés dans Blender (`outils/` du bloc-notes de travail), habillés des uniformes d'époque, posés sur
    notre squelette d'animation, cuits comme le cheval (`web/js/battle/dev/cheval.mjs`).
- [ ] **Le canon** : [Napoleonic Era Cannon](https://sketchfab.com/3d-models/none-4f8d69ba311745dda220dbde960d5fc6) de
  MenOfMena (CC-BY), en glTF. Sketchfab demande un compte connecté.
  - Ensuite : allégé, intégré aux pièces d'artillerie, auteur crédité dans `LICENCE.txt`.
- [ ] (Au choix) le cheval de henry_7 (CC-BY, Sketchfab), si le cheval Quaternius ne suffit pas de près.

## Ce qui reste du rendu des batailles (SPEC-RENDU)

- [ ] **9g l'atmosphère** : brouillard selon la hauteur, ciel et horizon (bien visibles avec la nouvelle caméra), eau (A6, A7).
- [ ] **9h la fin** : reflets du métal (baïonnettes, canons), occlusion calculée par sommet.
- [ ] **9i l'atlas d'uniformes** : coordonnées de texture et atlas peint par le code (boutons, galons, buffleteries).
- [ ] **9k la foule** : imposteurs animés de loin, budgets relevés (B3, B5) ; imposteurs d'arbres (A5.2) si l'iPad peine.
- [ ] **9l la lisibilité** : lignes de front, mode ligne de vue (B7).
- [ ] Sol (A1) : courbure (creux plus verts), triplanaire des pentes raides, neige comme 9ᵉ sol.
- [ ] Haies (A5.6) : un vrai feuillage au lieu de bandes extrudées.
- [ ] Piétinement (A4) : enregistrer la boue avec la bataille ; ornières des pièces ; débris (chapeaux, fusils, roues) ;
  boue luisante sous la pluie.
- [ ] Cartes de bataille (SPEC-CARTES C3.3) : les rangs d'arbres le long des chemins creux.

## Ce qui reste de la carte de campagne (SPEC-RENDU, partie D)

- [ ] La vue 3D inclinée comme UGAR (gros chantier : la carte est aujourd'hui un canevas 2D en tuiles).
- [ ] Les portraits des généraux sur la carte, à côté de leur armée.
- [ ] Des figurines pour les armées en marche (aujourd'hui des blocs vus de dessus).
- [ ] Le panneau de la date et des vitesses en bas à droite, et des cartes de régiment en portrait, comme en bataille.
- [ ] À accorder avec la phase 2d plus bas (« le style de la carte selon l'époque : gravure, lithographie, état-major ») :
  le style UGAR devient la base, les époques le feraient varier.

## À vérifier par toi

- [ ] Sur l'iPad, en qualité **Haute** (la qualité automatique peut redescendre en Basse) : images par seconde en
  bataille avec l'herbe, le cheval et la fumée.
- [ ] Sur le Raspberry Pi : le temps de chargement de la carte de campagne (le relief est peint au chargement et à chaque
  changement de saison, 0,1 s sur un PC, peut-être 1 s sur le Pi).
- [ ] Ton avis sur la ressemblance avec UGAR : batailles, carte de campagne, interface.

## Connu, sans rapport avec ce chantier

- [ ] Deux tests de campagne échouent déjà sur `main` : `test_deux_decisions_au_meme_moment` et
  `test_une_decision_arrete_le_tour_des_ia_puis_il_reprend` (`tests/test_campagne.py`).

---

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
