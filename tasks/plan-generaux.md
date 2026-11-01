# Plan : des généraux qui évoluent (SPEC-GENERAUX.md, validée le 31/10/2026)

Banc d'équilibre « avant » lancé le 31/10 sur une copie de `fe1c2f4` (`/tmp/banc-avant-1790.txt`, `/tmp/banc-avant-1700.txt`).

- [x] G1 : données et grades : `id`, `talents`, `medailles`, `etats`, `promo` (migration des sauvegardes) ; 5 grades et
  seuils (`rules.GENERAL_XP`), Maréchal unique par camp ; `gen_title`, `views._gen`, `units.general` suivent la liste ;
  états de service notés à chaque bataille
- [x] G2 : réserve de généraux par camp (`f['generaux']`) : fusion, armée nouvelle, nomination par le joueur
- [x] G3 : risques : tirage en résolution automatique (tableau de la spec), sort de l'état-major en bataille
  commandée ; blessure (colonel intérimaire, retour en 1 à 3 mois), mort
- [x] G4 : captifs : liste par camp, rachat et échange (actions de diplomatie, IA comprises), libération à la paix
- [x] G5 : talents (`rules.GENERAL_TALENTS`), promotion en attente, choix des IA, effets branchés
- [x] G6 : médailles automatiques selon l'époque
- [x] G7 : interface : fiche du général, fenêtre de promotion, panneau « Généraux » (rachat, échange, nomination)
- [x] G8 : tests (341, seuls les trois test_vite du Pi échouent), banc « après » (tasks/equilibre-reference.md), README, revue corrigée (31/10–1er/11)
