# Reste à faire (mis en pause le 24/11/2026)

Point de reprise des chantiers « Empire » (`SPEC-EMPIRE.md`) et « agents, politique, diplomatie, équilibre »
(`SPEC-POLITIQUE.md`). Tout ce qui est fait est sur `main` (web_conquete `1dd99a8`, web_engine 2.34.0 `ac985d5`).
Le détail de chaque module (fait, pas fait, écarts) est dans la section « État » de ces deux specs.

## 1. À finir en premier

1. **Page des agents (P8) : en cours, non vérifiée.** Le travail est sauvé dans
   `travaux/p8-page-des-agents-en-cours.patch` (fait sur le commit `39b12f2` ; il ne s'applique plus tel quel sur `main`,
   où les pages de la politique et de la diplomatie ont touché `ui.js`). Pour le reprendre :
   `git checkout -b p8 39b12f2 && git am travaux/p8-page-des-agents-en-cours.patch && git merge main` (conflits attendus
   dans `web/js/ui.js`, à résoudre en gardant les deux côtés). Contenu : pions 3D des agents (`web/js/hex/agents.js`,
   `maillageAgent` de web_engine), fenêtre de l'agent (`web/js/agents.js` : missions et chance de réussite, scènes
   `sceneMission`), recrutement dans le panneau des places, essais (`tests/agents.test.mjs`,
   `rust/conquete/tests/partie_agents.rs`). Il en était à **déboguer le bouton du duel** ; restaient : prêtre en poste,
   diplomate en ambassade, captures, vérification dans le navigateur.
2. **Retirer l'ancien espion** (commande `spy`, `g.spies`, `rules.spy`, bouton de `ui.js`) une fois P8 fini.
3. **Colonne de boutons à droite (le rail) sur iPad** : avec les boutons Gouvernement et agents, elle risque de ne plus
   tenir en 768 px de haut ; réduire les boutons ou les regrouper (`--rail-n` dans `style.css`).

## 2. Équilibre (outil sur le PC du joueur)

- Lancer `lancer-equilibre.cmd` (Windows) ou `./lancer-equilibre.sh` sur un PC puissant (série par défaut : 9 cartes ×
  32 parties de 50 ans, 2 à 5 h sur 8 à 16 cœurs ; `--rapide` pour un essai), puis donner
  `equilibre/resume-<date>.json` à l'assistant pour les réglages. Le lanceur Windows et le téléchargement de
  l'exécutable n'ont pas encore été essayés pour de vrai.
- Points déjà repérés à régler : révolutions des IA très rares hors des dates historiques ; l'IA recrute peu de prêtres
  (2 contre 64 diplomates en Europe sur l'essai rapide) et garde au plus 2 agents par type ; seuils des ultimatums et
  valeur des clauses diplomatiques ; équilibre des navires jamais mesuré sur une longue partie.

## 3. Moteur : manques connus

- **Diplomatie** : pas d'estimation de l'accueil d'une proposition avant l'envoi ; la vue ne donne ni les technologies
  des autres camps, ni leurs alliances entre eux, ni le montant réel du tribut d'un protectorat, ni l'échéance
  (`expires`) des propositions reçues ; l'IA n'échange pas d'elle-même régions ni technologies avec les autres IA.
- **Politique** : `POL_IMPOT`, `POL_INJUSTICE` et l'effet du cadastre ne sont pas envoyés à la page (elle recopie les
  constantes) ; titre « Révolution de Royaume de France » (`R::de` sur le nom long) ; `me.politique.revolution` vide
  pendant la décision de guerre civile ; les camps rebelles n'ont ni flotte ni caractère.
- **Agents** : l'entretien n'apparaît pas dans `me.upkeep` ; pas de défense active des universités par l'IA ;
  l'assassinat d'un général écrit « tombé au combat » ; pas de scène propre pour inciter, voler une technologie, poste à
  l'université, dénoncer, expulsion (web_engine).
- **Marine et commerce** : `chemin_mer` abandonne au-delà de 400 000 cases (un trajet très long comme Antilles–Québec
  peut échouer, donc pas de route commerciale) ; routes commerciales seulement dans un même théâtre ; comptoirs
  seulement sur la carte Monde ; les corsaires ne pillent pas les comptoirs ; l'IA ne ramène pas ses flottes
  d'expédition ; le revenu du commerce est un taux par jour recalculé chaque mois.
- **Vitesse du tour des IA** : 2,4 s sur la carte Monde ici (plus sur Raspberry). Pistes qui changent un peu les
  parties (accord du joueur nécessaire) : départage des chemins sur l'eau (≈ 0,16 s gagnées), puissance des camps
  calculée en un passage ; le gros gain viendrait de structures typées au lieu des `Val` (gros chantier).

## 4. Page et rendu (web_engine d'abord, règle du joueur)

- **Carte** : noms des chenaux des Grands Lacs (Sainte-Marie, Sainte-Claire, Détroit) ; petits lacs étroits devenus de
  la terre aux niveaux 4 et 8 cases (vérifier Finlande et Canada) ; quelques traits sur le ruban du Saint-Laurent de très
  près ; lagune de Venise et rades bretonnes plus petites qu'une case de 5 km.
- **Marine** : départs ennemis visibles seulement s'ils sont vus ; interception d'une armée en cabotage sans scène ;
  bataille navale hors de la vue non montrée.
- **Armées en figurines** : les arbres du décor peuvent traverser une troupe ; une colonne qui traverse une ville passe
  sur les maisons.
- **Bâtiments** : ils peuvent changer d'hexagone quand un chantier commence dans la ville ; plantations identiques à tous
  les niveaux.
- **Nuit** : les lumières 2D de `ciel.js` se superposent à celles du moteur 3D ; armées et étiquettes 2D ne suivent pas
  l'éclairage.

## 5. Mesures à faire sur le vrai matériel

- Raspberry Pi et iPad : fluidité réelle (tout a été mesuré en simulation, processeur ralenti, sans carte graphique),
  seuils de la qualité automatique (55 / 36 ms), temps du tour des IA, ouverture de la carte Monde.

## 6. Plus tard : ce qui manque encore pour ressembler à Empire Total War (hors graphismes)

- **Batailles terrestres dirigées par le joueur** (placement, formations, ordres ; une bataille au tour par tour sur
  hexagones suffirait) — retirées le 17/11/2026 par décision du joueur : à lui de trancher.
- **Batailles navales dirigées par le joueur.**
- **Variété des unités** (gardes, régiments nationaux, unités propres à chaque pays, cartes d'unité, chevrons).
- **Objectifs de campagne** (régions à tenir avant une date, campagne courte ou longue, épisodes historiques).
- **Finition de l'interface** (encyclopédie, infobulles, raccourcis, conseiller) et **son / musique** (à vérifier).

## Pour les prochaines sessions

- Les agents parallèles doivent être lancés **depuis le dossier du dépôt web_conquete** (sinon leur copie isolée se crée
  dans web_engine).
- Compiler avec un dossier `CARGO_TARGET_DIR` propre à chaque agent, **dans** le dépôt (le serveur cherche `web/` à
  côté), et en release seulement : un dossier partagé fait échouer des tests au hasard.
