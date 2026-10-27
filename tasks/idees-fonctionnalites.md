# Idées de fonctionnalités à venir (choix du 27/10/2026)

Rien n'est écrit ni codé. Chaque chantier passe par `/spec`, `/plan`, puis `/build` par petites étapes avec l'accord du joueur,
banc d'équilibre (`tasks/equilibre-reference.md`) et `/review` à la fin.

## Retenues par le joueur

Ordre proposé : du moins risqué au plus lourd.

1. **Généraux qui évoluent** : promotions, blessures, rivalités entre officiers, mort ou capture au combat, médailles, petit arbre de talents.
   - S'appuie sur les généraux existants (grade, trait, `gen_title`, niveau en étoiles) : relire `game/engine.py` (`new_general`) et `GENERAL_TRAITS` / `GENERAL_RANKS` dans `game/rules.py` avant la spec.
2. **Mercenaires, douane et mariages**
   - Mercenaires et régiments étrangers à recruter contre des livres.
   - Douane et contrebande aux frontières, en plus du Blocus.
   - Dynastie, mariages et succession : alliances scellées par un mariage, crises de succession (diplomatie, événements à choix).
3. **Religion, révoltes et guérilla** (le plus lourd : ordre public, ravitaillement, IA)
   - Clergé et religion : Camisards, protestants du Béarn, anticléricalisme, jouant sur l'ordre public via les événements à choix.
   - Bandits, chouannerie, jacqueries ; partisans qui coupent routes et ravitaillement.

## Non retenues pour l'instant

Marine et combat naval sur la côte et l'estuaire ; scénarios historiques avec objectifs ; succès et bilan de partie ; multijoueur en réseau local ;
tutoriel plus long ou mode « historien ».

## Avant de commencer

- Vérifier dans `game/data` et le code que rien n'existe déjà sous un autre nom (la recherche du 27/10 n'a trouvé ni religion, ni mercenaires, ni médailles, ni promotions, ni partisans).
- Remettre le graphe à jour (`graphify update .`), il date du 19/10/2026.
- Chaque ajout de règles demande de refaire tourner le banc d'équilibre.
