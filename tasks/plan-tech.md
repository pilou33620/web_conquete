# Plan : les technologies et le rendu qui suit l'époque, phases 0 et 1

Spec : `SPEC-TECH.md` (validée le 18/10/2026). Tâches : `tasks/todo-tech.md` (T51 à T68, à la suite de l'étape 8).

## Vue d'ensemble

Phase 0 (modules `visuels` et `arbre`) : une table des marques visibles, les marques de chaque camp et l'arme de chaque
régiment envoyées à la bataille, la branche « Civil et social », 21 technologies et leurs effets nouveaux, la batterie
de mitrailleuses. Phase 1 (module `bataille-armes`) : poudre sans fumée, piquiers, une pièce par génération
d'artillerie, la pièce de Reffye, les vrais drapeaux d'époque.

La phase 0 change les règles : on mesure l'équilibre avant (référence) et après, avec un banc qu'il faut d'abord
écrire (T51). La phase 1 ne change que le rendu.

## Décisions d'architecture

- **D1. `rules.VISUALS` et `rules.marks(techs)`.** Une table (marque → technologie) et une fonction pure qui rend la
  liste des marques d'un camp. `make_spec` envoie `marks=[[…], […]]` ; `rules_payload` envoie la table (la carte s'en
  servira en phase 2). `art_cheval` reste tel quel : il sert aux règles.
- **D2. `arm` dans la vue d'une unité** (`Unit.view`), pour toutes les unités : le client choisit pique, fumée et pièce
  d'après lui. C'est un ajout au contrat ; aucun champ ne change.
- **D3. La branche garde l'identifiant `civil`.** Seuls le nom affiché et la phrase du panneau changent : les
  sauvegardes, les goûts des IA (`pers['tech']`, `AI_TASTE`) restent valables.
- **D4. Un effet nouveau = une clé `fx` lue à un seul endroit par `g.mod`.** Les effets des technologies se recalculent
  au chargement (`views.from_dict` → `recompute_mods`) : changer un `fx`, y compris retirer l'ancien bonus de la
  mitrailleuse, touche les vieilles parties sans migration.

  | Clé | Technologie | Où |
  |---|---|---|
  | `interest` | `caisse_epargne` | `monthly` (engine.py) : le trésor positif rapporte 2 % l'an |
  | `city_livres` | `gaz` | `node_output` : +5 % de livres pour `ville` et `capitale` |
  | `build_cost` | `ciment` | une fonction de coût et de délai commune à la construction, à l'IA et aux prix affichés |
  | `upstream` | `vapeur_fluviale` | `_water_speed` : la remontée va aussi vite que la descente |
  | `weary` | `suffrage` | lassitude : la hausse mensuelle ×0,75 |
  | `revolt` | `mutuelles` | révolte mensuelle : chance ×0,5 (voir « Écarts à la spec ») |
  | `strikes` | `syndicats` | une fois par an, une ville à l'ordre bas perd un mois d'industrie (`n['tm']`, comme les effets des villes) |
  | `wounded` | `croix_rouge` | `bridge.finish` et `apply_typed_losses` : un quart des pertes reviennent |
  | `alert` | `telephone` | bilan du tour : les armées ennemies qui arrivent chez vous au tour suivant (`TT.eta`) |
  | `intel` | `photographie` | vue des armées ennemies repérées : expérience et arme des régiments |
  | `breach` | `dynamite` | une brèche de plus à l'assaut (`terrain.py`, seuil levé) et `fort_eff` des batailles automatiques |
  | `balloon` | `aerostiers` | `_update_vision` : tout ennemi à 1 500 m d'un général valide est vu |
  | `entrench` | `retranchements` | `_fire` : pertes ×0,75 pour l'infanterie arrêtée depuis 5 min (nouvel attribut `still_t`) |
  | `shell` | `melinite` | `_fire` : le couvert de la cible compte moitié moins contre l'artillerie de ce camp |

- **D5. Atténuation des événements par l'étiquette `ev`.** Les effets temporaires (`tmods`) et la perte de population
  d'un événement portent l'identifiant de l'événement ; `recompute_mods` et `EV.apply` les multiplient par
  l'atténuation du camp (`ATTENUE = {cholera: vaccine, epidemie: vaccine, blocus: betterave, phylloxera: bouillie}`).
  Un camp qui trouve la technologie après l'événement en profite aussi. Les anciens `tmods` sans étiquette restent
  entiers.
- **D6. Mitrailleuses : un type de la classe `artillerie`.** Il prend les formations, avant-trains, munitions et la
  capture de l'artillerie. Les ~13 tests littéraux `type == 'artillerie'` de la campagne (relevés : engine.py,
  ai.py, army_actions.py) passent par la classe. Ses portées, sa cadence et son feu ont leur table par type dans
  `tactics/units.py`. Il tire comme une salve (bande étroite), sans boulet ni mitraille ; le serveur envoie
  `kind='salve'`, et le client reconnaît le type pour l'effet.
- **D7. Piquiers : une sorte de figurine `piquier`, côté client seulement.** C'est le fantassin, avec une pique sur l'os
  du fusil (comme la hampe du drapeau). `layout` met un homme sur cinq, au centre, pour l'infanterie d'arme 0. Ses
  gestes sont ceux du porte-drapeau (pique dressée), sauf la charge et la mêlée, où il prend les gestes du fusil
  (pique croisée). Aucune animation nouvelle.
- **D8. Une pièce par génération, sortes créées à la demande.** Une table génération → modèle (`ancien`, `gribeauval`,
  `valee`, `lahitte`, `bange`, `75`, et `reffye`). `Troops` ne crée que les sortes présentes dans la bataille.
- **D9. La fumée suit une fonction pure** `smokeless(un, marks)` (gestes.js) : infanterie d'arme ≥ 7, artillerie et
  mitrailleuses d'un camp marqué `sans_fumee`. `effets.js` choisit alors l'éclair et un voile léger.
- **D10. Drapeaux : `drapeau(year)` (gestes.js) et une planche de drapeaux.** Les étoffes de la bataille sont peintes
  dans une seule texture : avant 1791, les quartiers de chaque régiment sont tirés de la liste des couleurs historiques
  d'après son nom. Chaque étoffe y prend sa case par l'attribut `aFace`, libre pour elles (les drapeaux ne portent plus
  la couleur du camp) : aucun attribut de plus. Le haut de la hampe (lance, pique, aigle, coq) et la cravate sont dans
  le modèle du porte-drapeau, déjà construit pour l'année.
- **D11. Banc d'équilibre `outils/simuler.py`.** Il fait jouer N campagnes aux IA seules, sur des graines fixes, de
  l'année A à B. Il rend : erreurs, nombre et durée des guerres, places de chaque camp à la fin, écart entre le premier
  et le dernier, technologies trouvées. La référence est mesurée avant les effets (T51) et gardée dans
  `tasks/equilibre-reference.md`.

## Écarts à la spec trouvés en lisant le code (acceptés le 18/10/2026)

1. **Mutuelles** : une révolte ne coûte pas d'ordre public, la place change de camp. Je propose : « les places
   mal assimilées se révoltent moitié moins souvent ».
2. **Fresnel** : le jeu ne perd jamais de navires. On prend la variante de la spec : commerce +10 %, ports +15 %.
3. **Mildiou** : il n'existe pas dans le jeu. Je propose : la bouillie bordelaise atténue le phylloxéra de moitié,
   et un événement « mildiou » (1882) apparaît, avec deux choix, comme le phylloxéra.
4. **Les 62 parties** : c'était une simulation faite à la main, pas un banc. T51 l'écrit.
5. **Ciment** : les prix affichés et ceux qu'estiment les IA baissent aussi (une seule fonction de coût).

## Graphe des dépendances

```
T51 banc d'équilibre (référence)
T52 VISUALS, marques, arm ──────────────┐
T53 arbre (label, 21 technologies) ─┬── T54 … T58 effets ── T59 mitrailleuses (campagne) ── T60 (bataille) ── T61 (interface)
                                    │                                                                      │
                                    └────────── point 0 (équilibre comparé à T51) ◄────────────────────────┘
T52 ── T62 fumée ── T63 piquiers ── point 1a ── T64 pièces ── T65 cartes et recul ── T66 Reffye ── point 1b ── T67 drapeaux ── T68 revue
```

La phase 1 ne dépend que de T52 (et de T60 pour la pièce de Reffye) : elle peut commencer avant la fin de la phase 0,
si tu préfères voir le rendu plus tôt.

## Liste des tâches

### Phase 0 : socle et arbre
- T51 Banc d'équilibre et mesure de référence
- T52 Marques visibles, arme des régiments envoyée à la bataille
- T53 Branche « Civil et social », 21 technologies dans l'arbre
- T54 Effets économiques (caisse d'épargne, gaz, ciment, vapeur, Fresnel)
- T55 Effets sur la société (vaccine, betterave, bouillie et mildiou, suffrage, mutuelles, syndicats, moissonneuses)
- T56 Renseignement (photographie, téléphone)
- T57 Après la bataille et à l'assaut (Croix-Rouge, dynamite)
- T58 Pendant la bataille (aérostiers, retranchements, mélinite)
- T59 Mitrailleuses, campagne (type, classe, levée, IA, ancien bonus retiré)
- T60 Mitrailleuses, bataille (portées, cadence, feu, IA de combat)
- T61 Mitrailleuses, interface (levée, carte d'unité, fanion)
- **Point 0** : tous les bancs, équilibre comparé à la référence, une vieille sauvegarde jouée un an, revue avec toi

### Phase 1 : bataille-armes
- T62 Poudre noire, puis sans fumée
- T63 Piquiers
- **Point 1a** : galerie (1700, 1890), revue avec toi
- T64 Une pièce par génération d'artillerie
- T65 Pièces sur les cartes d'unités, recul du canon de 75
- T66 Pièce de Reffye, servants, crépitement
- **Point 1b** : galerie (une pièce par génération, une batterie de mitrailleuses qui tire), iPad
- T67 Vrais drapeaux d'époque
- T68 Revue complète, README, galerie des six époques, état de la spec, graphe à mettre à jour

## Risques et parades

| Risque | Impact | Parade |
|---|---|---|
| Les effets nouveaux déséquilibrent la campagne (intérêts, recrues, blessés qui reviennent) | Haut | Banc T51 avant/après ; valeurs dans les tables, réglables d'un mot ; point 0 |
| Le passage de `type == 'artillerie'` à la classe oublie un endroit | Haut | Relevé fait (13 endroits) ; `grep` dans la vérification de T59 ; banc : une armée de mitrailleuses en siège, en retraite, en ravitaillement |
| Mitrailleuse trop forte ou inutile | Moyen | Bancs de bataille de T60 (contre une ligne, contre une batterie), réglage par table |
| Trop de sortes de figurines (pièces, piquiers, Reffye) : mémoire et images par seconde sur iPad | Moyen | Sortes créées à la demande ; plafonds de la qualité ; mesure à chaque point |
| Planche des drapeaux : beaucoup de régiments | Faible | Cases de 64 × 48 ; une planche de 1 024 × 1 024 tient 300 drapeaux ; au-delà, couleurs reprises |
| Dates ou modèles faux | Faible | Chaque date et chaque drapeau vérifiés à la construction (source dans le commentaire de la table) |
| Une sauvegarde au milieu d'une bataille tactique (nouvel attribut `still_t`) | Faible | Valeur par défaut au chargement ; banc |

## Choix du 18/10/2026

- Les cinq écarts ci-dessus sont acceptés (mildiou compris).
- Ordre : phase 0, puis phase 1.
- Construction : `/build auto` sur tout le plan, revue complète (`/review`) obligatoire à la fin (T68).
