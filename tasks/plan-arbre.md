# Plan : l'arbre des technologies, la recherche libre et la modernisation des armées

Spec : `SPEC-ARBRE.md` (validée le 23/10/2026, avec l'affichage des manœuvres ennemies repérées). Tâches :
`tasks/todo-arbre.md` (A1 à A8).

## Vue d'ensemble

Quatre modules, dans cet ordre :
1. `branches` : la branche militaire en deux.
2. `recherche-libre` : plus de date, prérequis entre branches, durée selon l'étage.
3. `arbre-ecran` : la fenêtre en arbre.
4. `moderniser` : les manœuvres par régiment, le bouton.

Les deux premiers changent le rythme de toute la campagne, on mesure au banc (A7). Le quatrième touche les trois
moteurs de combat : la résolution automatique, la bataille tactique et les fiches de l'interface.

## Décisions d'architecture

- **D1. Une seule table des technologies, réécrite au chargement des règles.** `TECHS` garde ses lignes. On ajoute
  trois choses :
  - `MILITAIRE_INF`, l'ensemble des technologies militaires qui vont dans `infanterie` (les autres vont dans
    `artillerie`) ;
  - `REQ_PLUS`, les prérequis entre branches ;
  - le calcul de l'étage et de la durée (spec, « Durée selon l'étage »).

  Tout est fait une fois dans `rules.py`, juste après `TECH = {…}` : le reste du code lit `t['branch']`, `t['req']` et
  `t['days']` comme aujourd'hui.
- **D2. Sauvegardes : migration dans `views.from_dict`.**
  - `f['research']` reçoit les clés des cinq branches ; une recherche `militaire` en cours va dans la branche de sa
    technologie.
  - Chaque régiment sans `man` reçoit les manœuvres que son camp connaît pour sa classe (D4).
  - `recompute_mods` y est déjà appelé.
- **D3. `AI_TASTE` et le goût `militaire`.** Le goût des IA garde la valeur `militaire` (personnalités, `AI_TASTE`
  inchangés). `ai.research` traduit : le goût `militaire` préfère `infanterie` et `artillerie`.
- **D4. `rules.MANEUVERS = {tech: classe}` et `rules.REG_KEYS`.**
  - `MANEUVERS` : feu de rang, feu de peloton, ordre mixte, retranchements, voltigeurs → `inf` ; hussards,
    cuirassiers → `cavalerie` ; artillerie à cheval, mélinite → `artillerie`.
  - `REG_KEYS` : les clés d'effet qui jouent par régiment, soit `stats.TECH_MODS` plus `legere_cover`, `entrench`,
    `shell` et `art_speed`.
  - Une seule fonction, **`engine.reg_mods(code, r)`**, rend les effets d'un régiment : ceux du camp, moins les
    `REG_KEYS` de deux sortes de technologies.
    - Les manœuvres de sa classe que le camp connaît et que le régiment n'a pas apprises.
    - Les armes de sa classe plus récentes que son `arm` ; les unités à armement fixe (`arm_name`) ne sont pas
      concernées.
  - Le calcul est une soustraction sur le dict du camp, sans cache : quelques technologies par régiment.
- **D5. Les trois moteurs de combat lisent `reg_mods`.**
  - `engine.reg_power` et la résolution automatique (`self.mod(owner, 'ligne_fire')`… dans `update_battles`) lisent
    `reg_mods`.
  - En bataille tactique, `bridge.make_spec` met `md` dans chaque unité (comme `arm`). `battle.tech(side)` devient
    `battle.tech_of(u)` : il rend `u.md` s'il existe, sinon le dict du camp, pour que le banc d'essai et les scénarios
    sans campagne marchent tels quels. `entrench` et `shell` passent par `u.md`.
  - Le verrou de la colonne « ordre mixte » (`orders.py`) reste au niveau du camp.
  - Les fiches de l'interface (`views._reg`) lisent `reg_mods`.
- **D6. L'entraînement est porté par le régiment.** Pendant 10 jours, `r['drill'] = dict(t=fin, arm=niveau, man=[…])`.
  - Un seul passage quotidien sur `all_regs` applique ce qui est fini : armes (et −15 % d'expérience si elles
    changent), puis manœuvres.
  - Pour les armées comme pour les garnisons. Le prix est payé au lancement.
  - Une armée qui reçoit un ordre de marche efface les `drill` de ses régiments (`army_actions`, là où la marche
    commence).
  - En tour par tour, l'armée perd 10 jours de marche (`mp`).
  - `rearm` et `rearm_cost` deviennent `modernize` et `modernize_cost` ; tous leurs appelants suivent (`ai.py`,
    `server.py`, commande `rearm` du client gardée comme alias jusqu'à A6).
- **D7. La fenêtre en arbre reste dans `ui.techModal`.**
  - `this.techTab` (onglet) et `this.techSel` (case choisie) entrent dans la signature de rafraîchissement.
  - Placement : colonne = étage dans la branche ; ligne = rang moyen des parents (une passe), puis coût. Les cases sont
    en `position:absolute`, les traits dans un `<svg>` sous les cases.
  - La fonction de placement est pure (`arbrePlace(techs, branche)` → positions et traits), testée dans
    `tests/interface.test.mjs`.

## Ordre et dépendances

```
A1 branches ─► A2 recherche libre ─► A3 arbre-écran
     └───────► A4 manœuvres (moteur) ─► A5 manœuvres (bataille tactique) ─► A6 Moderniser (bouton, IA)
A2, A6 ─► A7 banc et réglages ─► A8 doc et revue
```

## Risques

| Risque | Parade |
|---|---|
| Recherches de 2 à 24 ans : l'IA peut s'enliser (une mauvaise recherche longue bloque une branche) | `ai.research` choisit d'abord les armes ; le banc A7 mesure les dates des grandes armes |
| Les effets par régiment changent l'équilibre des batailles automatiques | Les vieilles parties gardent toutes les manœuvres (D2) ; le banc compare à la référence |
| `reg_mods` oublié quelque part : effet encore national | A4 et A5 cherchent tous les `mod(…, k)` et `tech(side)` avec `k` dans `REG_KEYS`, et un test vérifie un régiment sans manœuvre dans chaque moteur |
| Le Pi : le banc long (1700 à 1890) prend environ 2 h | Lancé en arrière-plan, 2 parties ; les bancs de 30 ans restent la référence |
