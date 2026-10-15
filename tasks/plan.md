# Plan : tour par tour à la Total War (SPEC-TOURS.md)

## Vue d'ensemble

Trois parties, dans cet ordre : (1) le tour des IA calculé d'un coup, avec des arrêts seulement quand le joueur doit
choisir ; (2) les villes neutres prises tout de suite pendant le tour du joueur ; (3) le temps compté en tours,
d'abord dans les règles (production, recherche, échéances), puis à l'écran (sièges, marche, taux). Chaque tâche
laisse le jeu jouable et passe `python3 tests/lancer.py`.

## Décisions d'architecture

1. **La simulation reste continue, en jours.** Le tour des IA joue toujours le mois pas à pas (`g.step`) : on ne
   change que sa vitesse (aussi vite que possible) et ses arrêts. Les IA jouent comme avant.
2. **Le tour des IA par tranches de temps réel.** `turns.advance` calcule autant de pas qu'il peut en ~0,25 s par
   appel (la boucle du serveur l'appelle toutes les 0,1 s) : le mois se joue en 1 à 2 s et le serveur continue de
   répondre au navigateur pendant le calcul (la barre montre la progression). Le rythme (`PACES`) disparaît ; le champ
   `pace` des anciennes sauvegardes est ignoré.
3. **Les arrêts se décident en un seul endroit** (`turns.watch`) : on garde `bataille` (seulement si le joueur y a des
   armées ou une place), `decision` et `fin`. Les grands moments qui arrêtent le temps d'eux-mêmes (`alert_pause`) ne
   l'arrêtent plus en tour par tour. Après le choix (bataille ou décision), le tour des IA reprend tout seul.
4. **Tout le temps « en tours » passe par trois aides de `game/turns.py`**, pour ne pas disperser la conversion :
   - `work(g, dt)` : jours de travail d'un pas, `dt × 30 / longueur du mois` (règle A : un tour = 30 jours de travail,
     février comme mars). Sert à la file de production, à la recherche, aux politiques de ville.
   - `deadline(g, n)` : le début du n-ième tour du joueur à venir (le 1er d'un mois, 0 h). Pendant le tour du joueur,
     `n` mois après aujourd'hui ; pendant le tour des IA, `n` mois après la fin du mois en cours (règle B : le joueur a
     toujours n tours entiers). Sert aux trêves, droits de passage, propositions, décisions, gardes, délais d'attente…
   - `tours_left(g, until)` et `tours(days)` : pour l'affichage (« dans 2 tours », « ⅕ de tour »).
   Côté navigateur, une seule aide de texte (`toursTxt` dans `ui.js`) pour « au prochain tour / dans N tours ».
5. **Les durées arrondies sont écrites en tours dans `rules.py`** (et `cities.py`, `army_actions.py`) puis converties
   par `deadline` ou en jours de travail (× 30) : pas de table de conversion à part.
6. **Anciennes sauvegardes** : au chargement, une échéance en plein milieu d'un mois est repoussée au début du tour
   suivant (`turns.migrate`) ; les files de production gardent leurs jours restants (déjà des jours de travail).
7. **Le temps réel garde les mêmes règles** : un tour y est un mois du calendrier, `work` et `deadline` y valent.

## Graphe des dépendances

```
T1 tour des IA d'un coup ──► T2 arrêts réduits ──► (Point 1)
T3 ville neutre prise tout de suite ─────────────► (Point 1)
T4 aides de temps (work, deadline, tours_left) ──┬─► T5 production ──► T6 recherche et politiques
                                                 ├─► T7 échéances diplomatiques et événements
                                                 └─► T8 actions d'armée et espions ──► (Point 2)
T9 sièges en tours, T10 marche en tours, T11 taux par tour + nettoyage des « jours » ──► (Point final)
```

T1–T3 et T4 sont indépendants ; T5–T8 dépendent de T4 ; T9–T11 seulement de l'aide d'affichage (T4).

## Risques

| Risque | Impact | Parade |
|---|---|---|
| Un mois de fin de partie (beaucoup de guerres) dépasse 3 s sur le Raspberry | Moyen | T1 mesure un mois en 1790 et sur une sauvegarde avancée de `saves/` ; si trop lent, la barre de progression le rend supportable (pas de blocage du serveur) |
| L'arrondi des technologies (28 à 84 j → 1 à 3 tours) change le rythme de recherche des IA comme du joueur | Faible | même règle pour tous ; T6 compare le nombre de technologies d'une IA après 24 mois, avant et après |
| Une durée oubliée reste affichée en jours | Faible | T11 : le banc de l'interface cherche « jour » / « N j » dans les panneaux de campagne |
| Une proposition ou une décision créée pendant le tour des IA expire avant que le joueur la voie | Moyen | `deadline` compte à partir du tour suivant ; banc dédié en T4 et T7 |
| Les reprises automatiques (après une bataille ou une décision) relancent le mois alors que le joueur voulait regarder | Faible | la reprise n'a lieu que si le tour des IA était en cours (`tour['end']` non nul) |

## Liste des tâches

Le détail (critères, vérification, fichiers) est dans `tasks/todo.md`.

### Partie 1 : le tour des IA
- T1 : le tour des IA calculé d'un coup, sans rythme
- T2 : arrêts seulement quand le joueur doit choisir, reprise automatique
- T3 : ville neutre prise tout de suite pendant le tour du joueur
- **Point 1** : tu joues trois tours

### Partie 2 : les règles en tours
- T4 : aides de temps en tours (`work`, `deadline`, `tours_left`) et anciennes sauvegardes
- T5 : production à capacité par tour
- T6 : recherche et politiques de ville en tours
- T7 : trêves, droits de passage, propositions, décisions et événements en tours
- T8 : actions d'armée et espions en tours
- **Point 2** : tu vérifies une ville, les technologies et la diplomatie

### Partie 3 : l'écran en tours
- T9 : sièges et blocus en tours
- T10 : marche en tours (jauge, estimation d'arrivée)
- T11 : taux par tour, tutoriel, README, chasse aux derniers « jours »
- **Point final** : /review, puis tu essaies sur l'iPad et le PC
