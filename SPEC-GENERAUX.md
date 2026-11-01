# Spec : des généraux qui évoluent (31/10/2026)

État : **validée le 31/10/2026**. Premier chantier de `tasks/idees-fonctionnalites.md`.

## Objectif

Les généraux deviennent des personnages suivis d'une bataille à l'autre : ils montent en grade jusqu'à maréchal,
choisissent des talents, reçoivent des médailles, sont blessés, tués ou pris, rachetés, échangés ou libérés à la paix.
Les IA vivent les mêmes règles.

## Choix du joueur (questionnaires du 27/10 et du 31/10/2026)

- Blessé : un colonel le remplace, il revient au bout de 1 à 3 mois et reprend son armée.
- Tué ; pris : rachat en livres, échange contre un général ennemi détenu, libéré à la paix.
- Talents : un petit arbre par trait ; à chaque promotion, choix entre 2 talents de son arbre ou 1 talent commun.
- Grades : Lieutenant général et Maréchal en plus ; Lieutenant général à l'expérience, Maréchal un seul par camp et
  après des victoires.
- Médailles automatiques après des exploits.
- Risque selon la bataille, le trait et, en bataille commandée, le sort de l'unité d'état-major.
- Mêmes règles pour les IA (elles choisissent leurs talents seules).
- Interface : fiche du général, fenêtre de promotion, liste des généraux. Pas de rivalités.

## Ce qui existe (relevé du 31/10)

- Un général = `dict(name, trait, lvl, xp)` (`engine.new_general`, engine.py:1461), un par armée. 8 traits
  (`rules.GENERAL_TRAITS`), 3 grades (`GENERAL_RANKS`), +5 % de puissance par grade (`gen_level_k`).
- Expérience : `general_xp` au vainqueur de `end_battle` (+1 une vraie bataille, +0,34 sinon) ; seuils 3 et 7.
- Mort : 12 % au vaincu en résolution automatique (engine.py:3190) ; 50 % si l'état-major est blessé en bataille
  commandée (tactics/bridge.py:526). Remplacé aussitôt par un colonel neuf. Ni blessure durable, ni capture.
- Fusion : le meilleur garde l'armée, l'autre disparaît (engine.py:3990).
- Bataille commandée : unité d'état-major de 30 hommes (`units.general`), blessée sous 22 hommes (battle.py:2474).
- Prisonniers : un simple nombre par camp (`f['prisoners']`), échange et rachat par la diplomatie
  (`diplomacy.exchange_prisoners`). La paix passe toujours par `diplomacy.make_peace`.
- Trois endroits supposent 3 grades : `views._gen`, `engine.gen_title`, `units.general` (`min(2, …)`).

## Décisions

1. **Le général** garde sa forme et gagne : `id`, `talents` (liste), `medailles` (liste), `etats` (ses 12 dernières
   batailles : date, lieu, issue), `promo` (choix en attente ou absent). Une ancienne sauvegarde reçoit ces clés
   vides (`views.migrate`).
2. **Grades** (`GENERAL_RANKS`, 5) : Colonel, Général de brigade (3 points), Général de division (7), Lieutenant
   général (12), Maréchal (18 points, 5 victoires, et seulement si son camp n'en a pas). +5 % par grade jusqu'au général
   de division, comme aujourd'hui ; lieutenant général et maréchal sont des titres (réglé au banc du 31/10). Les trois endroits à 3 grades suivent la liste.
3. **Talents** (`rules.GENERAL_TALENTS`) : par trait, deux talents au premier étage et un au second (il faut l'un
   des deux premiers) ; quatre talents communs. Une promotion propose deux talents de son arbre encore libres et un
   commun tiré au sort. Chaque talent est un petit effet chiffré (+3 à +15 %) qui s'ajoute aux effets de technologie
   des régiments de son armée (mêmes clés : puissance d'une arme, feu de ligne ou de carré, charge, couvert des légers,
   montagne, attelages) : il agit ainsi en résolution automatique comme en bataille commandée. (Construit le 31/10 :
   les talents de campagne d'abord imaginés, magasins, pontonnier, négociateur, demandaient chacun un branchement à
   part ; ils sont remplacés par des talents de combat, liste dans `rules.GENERAL_TALENTS`.)
4. **Promotion** : le joueur choisit dans une fenêtre qui s'ouvre d'elle-même (comme la fenêtre d'arrivée) ; rien
   n'attend son choix (le talent est seulement en suspens). Une IA choisit aussitôt, selon son trait.
5. **Risques** à chaque bataille de campagne (résolution automatique), pour chaque général engagé :

   | | blessé | tué | pris |
   |---|---|---|---|
   | vainqueur | 4 % | 1 % | — |
   | vaincu | 10 % | 4 % | 6 % |
   | armée anéantie ou rendue | 15 % | 10 % | 50 % |

   Audacieux ×1,5, Prudent ×0,6 ; assaut de brèche ×1,5. Remplace le 12 % d'aujourd'hui.
   **En bataille commandée**, pas de tirage : l'état-major blessé (sous 22 hommes) → blessé ; détruit → tué ; pris
   ou encerclé → pris. Remplace le 50 % du pont.
6. **Blessure** : 1 à 3 mois selon la gravité. Un colonel intérimaire (sans talents) commande ; au retour, le général
   reprend son armée, ou attend dans la **réserve** de son camp si elle n'existe plus. Une armée nouvelle prend le
   meilleur général de la réserve avant d'en créer un.
7. **Capture** : le général rejoint la liste des captifs du vainqueur. Trois sorties, par l'« échange de prisonniers »
   qui existe déjà (mêmes boutons, mêmes réponses des IA) : **échange** un pour un, les plus gradés ensemble, puis
   **rachat** du surplus selon le grade (`rules.GENERAL_RANCON`) ; **libéré à la paix** (`make_peace`).
8. **Médailles** automatiques, nom selon l'époque (Ordre de Saint-Louis avant 1792, arme d'honneur jusqu'en 1803,
   Légion d'honneur ensuite) : victoire à un contre deux, prise d'une place forte, armée ennemie anéantie, siège
   repoussé. Chaque médaille : +1 point d'expérience et +2 de moral de départ pour son armée (3 médailles comptent
   au plus).
9. **Fusion** : le général écarté passe dans la réserve au lieu de disparaître.
10. **Interface** : la fiche de l'armée montre grade, talents, médailles, blessure, états de service ; fenêtre de
    promotion ; un panneau « Généraux » : vos généraux (armée, réserve, blessés), vos captifs, vos généraux captifs,
    avec les boutons de rachat et d'échange, et un bouton pour nommer un général de la réserve à la tête d'une armée
    qui est dans une de vos places.
11. **Équilibre** : le banc (`outils/simuler.py`, `tasks/equilibre-reference.md`) avant et après ; les écarts de
    plus de 25 % se corrigent par les chiffres des talents et des risques.

## Risques

| Risque | Impact | Parade |
|---|---|---|
| Trop de généraux tués : on ne voit jamais de maréchal | Moyen | risques réglés au banc (nombre de maréchaux par partie de 30 ans) |
| Talents qui s'empilent et déséquilibrent | Moyen | effets petits et ciblés ; banc avant/après |
| Un grade au-delà de 3 fait planter l'affichage | Haut | les trois endroits suivent la liste dès la première étape ; test |
| Réserve et captifs qui grossissent sans fin | Bas | libérés à la paix ; réserve plafonnée (les plus vieux partent en retraite) |
| Anciennes sauvegardes | Bas | `views.migrate` complète les clés |

## Critères de réussite

1. Un général peut aller de colonel à maréchal ; un seul maréchal par camp.
2. Blessure, mort et capture arrivent en résolution automatique et en bataille commandée, avec les bons chiffres.
3. Un captif se rachète, s'échange, ou revient à la paix ; un blessé reprend son armée.
4. La fenêtre de promotion s'ouvre et le talent choisi agit ; les IA choisissent seules.
5. Le banc d'équilibre reste dans ses tolérances ; tous les tests passent.

## Hors périmètre

Rivalités entre officiers ; âge et retraite au-delà du plafond de la réserve ; portraits nouveaux.
