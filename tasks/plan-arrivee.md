# Plan : choisir à l'arrivée devant une ville (SPEC-TOURS.md, « Évolution du 18/10/2026 »)

## Vue d'ensemble

Quand une armée du joueur arrive devant une ville qui n'est pas à lui (sa cible, ou une ville rencontrée en chemin),
elle s'arrête et un **choix en attente** est posé sur l'armée ; une fenêtre l'affiche d'elle-même : commander la
bataille, résolution automatique, rallier, négocier, assiéger ou bloquer, contribution, attendre. Après un choix sans
combat, l'armée reprend sa route avec la marche qui lui reste ; après un assaut, elle s'arrête. Tâches :
`tasks/todo-arrivee.md`.

## Décisions d'architecture

1. **Le choix vit sur l'armée** : `a['ask'] = {node, path, target}` (le chemin et la cible mis de côté pour reprendre
   la route). L'armée est en halte (`state 'idle'`, `hold`), son chemin vidé : aucune marche ni le code périodique ne
   la font repartir tant que le choix attend. Pas de nouvelle structure dans la partie ; une ancienne sauvegarde n'a
   pas la clé et se charge telle quelle.
2. **Un seul point d'entrée** : `engine.arrive_node`, juste après les cas qui ne changent pas (allié, voisin en paix,
   retraite, « Traverser » en chemin, place investie par un autre camp, bataille déjà sur place, place sans défense
   prise d'office, siège à nous qu'on rejoint). Seulement pour **le joueur** et **à l'arrivée en marche** : le
   contrôle périodique (armée restée sur une place hostile, l. 2389) et les IA gardent l'ancien comportement.
3. **Les choix réutilisent l'existant** (`army_actions`) : `negotiate`, `contribution`, `blockade`, le siège et
   l'assaut d'`arrive_node`, `start_battle`. Nouvelle fonction `army_actions.choose(g, code, a, what)` qui les
   appelle puis lève le choix et, pour un choix sans combat, rend à l'armée son chemin et la remet en marche
   (`turns.settle` la fait repartir). Le bouton « Rallier ou attaquer » d'une armée en halte rouvre le choix.
4. **Assaut au mode déjà choisi** : la bataille est démarrée (`start_battle`, assaut même sur une place à remparts,
   comme « Donner l'assaut » au premier jour d'un siège), puis son mode est fixé (`manuel` : bataille tactique créée
   comme par « Commander la bataille » ; `auto` : réglée sur-le-champ) sans repasser par la fenêtre « attente ».
5. **Attendre le joueur** : `bridge.on_speed` refuse « Tour suivant » et la reprise du temps tant qu'un choix attend
   (même chemin que la bataille en attente) ; en temps réel, l'arrivée met le jeu en pause.
6. **Affichage** : `views.player_state` envoie `asks` (armée, ville, options permises avec leur raison, calculées par
   `army_actions` comme la fiche de la place) ; `ui.js` ouvre la fenêtre « arrivée » comme celle des batailles (une à
   la fois), et la commande `arrive` du serveur transmet le choix.

## Graphe des dépendances

```
army_actions.choose + options ──┐
engine.arrive_node (choix posé) ┼──→ server (commande arrive) ──→ views (asks) ──→ ui.js (fenêtre)
bridge (assaut à mode fixé,     ┘
        on_speed)
```

## Liste des tâches

### Phase 1 : le moteur
- [ ] T1 : l'arrivée pose le choix ; « Attendre » ; « Tour suivant » attend
- [ ] T2 : les autres choix (assaut manuel ou automatique, rallier, négocier, contribution, siège, blocus)

### Point de contrôle 1
- [ ] `python3 tests/lancer.py` ; le cas du rapport joué au banc (Guyenne 1700, trois détachements)

### Phase 2 : l'écran
- [ ] T3 : état envoyé, commande du serveur, fenêtre « arrivée »
- [ ] T4 : README, essai sur le vrai serveur (Chromium sans écran), /review

### Point de contrôle final
- [ ] Critères de réussite 1 à 5 de la spec ; revue faite et corrigée

## Risques

| Risque | Impact | Parade |
|---|---|---|
| `arrive_node` sert à tous (IA, temps réel, contrôle périodique) | Haut | choix posé seulement pour le joueur, à l'arrivée en marche ; bancs IA et temps réel inchangés |
| Une armée en choix repartirait (chemin, code périodique) | Moyen | chemin mis de côté dans `ask`, halte ; banc « Tour suivant » refusé, armée immobile |
| Bataille manuelle démarrée pendant une autre | Moyen | refus comme aujourd'hui (« une autre bataille est déjà en cours »), le choix reste ouvert |
| Plusieurs détachements arrivent en même temps | Bas | une fenêtre à la fois ; les autres choix attendent leur tour |
| Anciennes sauvegardes | Bas | pas de nouvelle clé obligatoire ; banc de chargement |

## Questions ouvertes

Aucune (spec validée le 18/10/2026).
