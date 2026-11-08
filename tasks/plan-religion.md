# Plan : religion, révoltes et guérilla (SPEC-RELIGION.md, décidée le 8/11/2026)

Un agent, une branche (`worktree-agent-a1be36b6285a70732`), commits par étapes. Le code va dans deux nouveaux modules
(`game/religion.py` : confession et politique ; `game/revoltes.py` : bandes, insurrections, brigands, partisans),
branchés par quelques lignes sur `engine.py`, `events.py`, `views.py`, `ai.py`, `server.py`, pour limiter les conflits
avec les quatre autres chantiers en cours.

- [ ] R1 : `game/religion.py` : part de réformés, ferveur, politiques et leurs effets (ordre public, livres, exil,
  conversions), départ et migration ; commande `culte` ; tests/test_religion.py (décisions 1 à 6, 30)
- [ ] R2 : événements religieux datés et aléatoire, effets `culte` et `bande` des événements (décisions 7, 8)
- [ ] R3 : `game/revoltes.py` : bandes (naissance, attaque, marche, croissance, contre-guérilla, combat contre une
  armée), insurrections, apaiser ; tests/test_revoltes.py (décisions 9 à 14)
- [ ] R4 : brigands, partisans, amnistie, lever des partisans, soutenir, mission d'espion « Soulever » (16 à 20)
- [ ] R5 : événements datés des révoltes (15)
- [ ] R6 : IA : politique, répression, apaisement, soutien, partisans (21 à 23)
- [ ] R7 : vues et interface : panneau de ville, impôts, marques sur la carte, espionnage (24 à 28) ; tests JS
- [ ] R8 : banc d'équilibre 1700 et 1790 avec et sans (`CONQUETE_SANS_RELIGION=1`, ou le commit de départ `f2a7433`) ;
  `tasks/equilibre-reference.md`
- [ ] R9 : revue (logique, sauvegardes, performance à 89 camps), README, `tasks/idees-fonctionnalites.md`, essai réel
  de l'interface (serveur + Playwright)
