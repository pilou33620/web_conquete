# Spec : la bataille par stratégie (16/11/2026)

État : **moteur fait le 16/11/2026** (lot 1). La page (animation sur l'hexagone, fenêtres) est le lot 2 : elle se lit
sur le contrat de la fin de ce document.

## Décision du joueur

Le champ de bataille tactique disparaît. Toutes les batailles se règlent sur la carte de campagne : quand deux armées
se rencontrent, ou qu'une place est attaquée, le joueur choisit une **stratégie**, la bataille se résout par
**phases**, et la page en montre une petite scène sur l'hexagone. La maquette validée (`maquette-v7.html`, bloc « la
bataille par stratégie », et `armee.js`) a donné le modèle, les noms et les chiffres de départ.

## Inventaire : ce qui existait, ce qui est repris, ce qui est ajouté

Le moteur réglait déjà seul les batailles sans le joueur (`engine/batailles.rs` : `update_battles`, `end_battle`).
**Cette résolution est gardée et devient la seule** : rien n'est doublé, la stratégie y remplace le plan de bataille.

| # | Point | Existait (où) | Repris | Ajouté |
|---|---|---|---|---|
| 1 | Plus de bataille tactique | Modes « ordres » et « manuel » (`tactics/bridge.rs` `command`), mode Bataille (`tactics/skirmish.rs`, `/api/skirmish`, `/api/tactic`, `/api/tactic_map`), réglage `settings.battles` (demander, auto, auto_petites) | Le réglage ; l'attente du choix (`mode: "attente"`, la campagne figée : `bridge::frozen`) | Les modes et les routes sont refusés ; une sauvegarde avec bataille tactique redemande la stratégie (`bridge::load_from`, `views::migrate`) |
| 2 | Cinq armes | Trois classes (`rules.UNIT_CLS` : inf, cavalerie, artillerie) et `LIGHT_UNITS` (légère, chasseurs) | Les classes (armement, vulnérabilités `unit_vul`) | `rules.ARMES`, `ARME_DE`, `arme_de` : légère et chasseurs sont les **tirailleurs**, les **grenadiers** une arme à part (ajout du 16/11/2026) ; effectifs par arme dans les vues |
| 3 | Situations | Place ou non (`bt['node']`), remparts (`n['fort']`), ouvrages provisoires (`army_actions` : barricades, redoutes, `works_level`), posture « retranchée » d'une armée (+20 %) | Tout | `engine::situation` (campagne, position, ville, fort), `ouvrage` ; `rules.SITUATIONS` |
| 4 | Stratégies | Cinq plans par armée (`rules.PLANS`, `a['pl']`, `choose_tactics`), formations par phase (`choose_formation`) | Les formations (la stratégie les commande : carrés, colonnes) ; les effets des plans passent dans les stratégies (préparation d'artillerie, débordement en terrain ouvert, tenir, harcèlement qui décroche au bout d'un jour) | `rules.STRATS` (20 stratégies, contres +20 % `CONTRE`, découverte exigée), par camp (`side['strat']`) ; choix du joueur (`tac choose`), des IA (`choose_strategy`) |
| 5 | Phases, journal | Trois phases selon l'âge de la bataille et le moral (`battle_phase`, `rules.PHASES`, `PHASE_W`) ; un journal technique dans `logs/` (`battle_log.rs`) | Les phases et leur durée | L'**escarmouche** (premier dixième de jour) ; poids par arme (`PHASE_W`) ; journal par phase dans la bataille (`bt['journal']`), rendu avec le résultat |
| 6 | Technologies | Armement par régiment (`rules.ARMS` : ×0,85 à ×2,05 pour les fusils, ×0,85 à ×2,3 pour les canons), manœuvres (`MANEUVERS`, `REG_KEYS` : feu de rang +12 %, feu de peloton, ordre mixte, hussards, cuirassiers, artillerie à cheval, voltigeurs…) | Tout, sans changer les chiffres : l'armement fait déjà de gros écarts | `rules.TECH_ARME` (les découvertes de chaque arme, citées au journal) ; l'ordre mixte ouvre « Attaque en colonnes » |
| 7 | Terrain | `geo.TERRAIN` (bonus de défense : forêt +10 %, collines +15 %, montagne +30 % ; couvert), terrain par sorte de régiment (`UNITS[..]['terrain']` : légère ×1,3 en forêt, cavalerie ×0,55 en forêt, ×1,0 en vignoble contre ×1,4 en plaine), rivière à franchir (assaillant −15 %), débarquement | Tout | Rien de chiffré ; le journal le dit (`pese_depart`) |
| 8 | Temps, moral, fatigue | Feu selon le temps (`rules.WEATHER` : pluie ×0,75, neige ×0,8, brouillard ×0,85), boue (`mud_k`, marche), moral et expérience dans `reg_power`, fatigue et munitions (`bridge::reg_k`, `army_tick`), ravitaillement (×0,75 à ×1), moral plancher après une défaite | Tout | La charge freinée par la boue (`BOUE_CHARGE` ×0,8) et la neige (`NEIGE_CHARGE` ×0,85) ; le brouillard sert les embuscades (`BROUILLARD_EMBUS` ×1,15) et gêne la reconnaissance |
| 9 | Renforts, reconnaissance | Une armée amie à moins de 3 km d'une bataille la rejoint (`detect_contacts`, `join_battle`) ; espions (`intel_active`), hussards, général éclaireur | `join_battle` ; les espions | `engine::renforts` : à la charge, les armées amies libres à moins de `RENFORT_KM` (8 km, deux hexagones) entrent en ligne ; `engine::reconnaissance` (`RECO_*`) |
| 10 | Après la bataille | Poursuite automatique d'un vaincu rompu (`PURSUIT_CAV`, `PURSUIT_FOOT`), prisonniers (`PRISON_*`, échange et rachat : `diplomacy`), sort et expérience du général (`risques_general`, `general_xp`, SPEC-GENERAUX.md), +8 d'expérience aux régiments vainqueurs | Tout | Le **choix** de la poursuite (`tac pursue`, `POURSUITE_FAT`) ; **prises** : drapeaux et canons au prestige (`PRISE_CANONS`, `PRESTIGE_*`) ; +3 d'expérience aux vaincus survivants |
| 11 | Sièges | Fenêtre d'arrivée devant une place (`army_actions::ask_choices`, `choose`) : assiéger (brèche au canon, `update_sieges`), bloquer (`blockade`, famine `blockade_tick`), assaut ; reddition d'une place affamée | Tout | Le choix « assaut » remplace « ordres », « manuel », « auto » ; à la reddition, **la garnison sort avec les honneurs** et se replie (ses hommes sont sauvés) |
| 12 | Pour l'écran | `force_ratio` (devant une place), `g.sites` (champs de bataille récents, 120 jours, hors des places), vue des batailles (`views::player_state`) | `g.sites`, la vue | Commande `apercu` ; traces aussi devant les places ; situation, ouvrage, armes, stratégies, journal dans la vue |
| 13 | Batailles entre IA | La même résolution | — | Par construction : un seul chemin |

Ce qui n'est **pas** repris de la maquette : son bonus chiffré par situation (+15 %, +25 %, +35 %, +60 %). Le moteur
avait déjà le terrain, le retranchement et les remparts (puissance ×(1 + 0,35 × niveau), pertes ÷(1 + 0,55 × niveau)) :
un bonus de plus les aurait doublés.

## Règles

- **Armes** (`rules.ARME_DE`) : infanterie (ligne, sapeurs, garde, suisses, irlandais, légion, milice),
  cavalerie (cavalerie, Royal-Allemand), artillerie (artillerie, mitrailleuses), tirailleurs (légère, chasseurs),
  grenadiers.
- **Grenadiers** (cinquième arme, demandée le 16/11/2026) : l'infanterie d'élite de choc. La sorte de régiment existait
  (200 hommes contre 300, 260 livres contre 150, puissance ×1,45, expérience 30 et moral +10 à la levée, baïonnette
  requise ; les IA en lèvent un par armée type, `ai::MIX`) : rien n'y change, le recrutement et le coût non plus. Ajouté :
  leur poids par phase (`PHASE_W` : comme l'infanterie à la fusillade, ×1,4 à la charge, presque rien avant), ce que
  chaque stratégie leur change (`STRATS[..].m.grenadiers` : colonnes ×1,5, bastions ×1,35, remparts, sortie et
  bombarder ×1,3, frontal et contre-attaque ×1,25, harcèlement et repli ×0,6), ×1,3 à l'assaut d'une position, d'une
  ville ou d'un fort (`GREN_ASSAUT`), ×1,25 pour y tenir (`GREN_OUVRAGE`), et un moral qui cède 40 % moins vite sous
  les pertes (`GREN_MORAL`). Ils restent de la classe « inf » : fusils, manœuvres et talents de l'infanterie les
  touchent, ils forment ligne, colonne et carré, et s'aguerrissent comme les autres. La poursuite est l'affaire de la
  cavalerie : ils n'y ajoutent rien.
- **Situations** (`engine::situation`) : *fort* (place de type fort, à remparts), *ville* (toute autre place à remparts),
  *position* (place ouverte barricadée, ou armée défenseur en posture « retranchée »), sinon *campagne*.
- **Stratégies** (`rules.STRATS`, `SITUATIONS`) : celles de la maquette. Écarts : « Assaut frontal » donne +10 % à
  chaque arme (sans cela aucune IA ne le choisissait) ; « Débordement » et « Tourner la position » mettent la cavalerie
  à ×0,8 hors terrain ouvert, et prennent l'ennemi de flanc (moral ×1,35) si elle est plus nombreuse en terrain ouvert ;
  « Repli en bon ordre » décroche après la canonnade (un quart de jour), « Harcèlement » au bout d'un jour si l'ennemi
  tient mieux ; « Tenir la ligne », « remparts », « bastions », « jusqu'au bout » : le moral cède 30 % moins vite. Le
  défenseur d'une place ne peut pas choisir le repli.
- **Choix des IA** (`choose_strategy`) : la note d'une stratégie est la part de chaque arme dans la puissance du camp
  × ce que la stratégie lui change, ÷ la racine de ses pertes propres, × le contre (dans les deux sens) de la stratégie que la
  composition ennemie conseille, +15 % si le général l'aime (son trait), +10 % d'embuscade à couvert, carrés selon la
  cavalerie d'en face ; ±8 % de hasard propre à la bataille. À moins de la moitié de la puissance adverse en rase
  campagne : repli (défense) ou harcèlement (attaque).
- **Phases** : escarmouche (âge < 0,1 jour), canonnade (< 0,25), fusillade, charge (au bout d'un jour, ou plus tôt :
  moral sous 45, armée très montée). Une embuscade commence à la fusillade. Une bataille peut finir avant la charge.
- **Fin** : comme avant (`battle_yield`, `rules.WD_*`) ; la poursuite : `PURSUIT_CAV` (5 %) des vaincus qui
  décrochent, le double s'ils sont rompus, +35 de fatigue au vainqueur ; sans poursuite, `PURSUIT_FOOT` (2 %) d'une
  armée rompue seulement. Le général (IA) poursuit si la fatigue moyenne de ses hommes est sous 60.
- **Prises** : un drapeau par régiment vaincu anéanti (et par régiment de la garnison d'une place prise), 8 canons par
  batterie perdue et par batterie du rempart d'une place prise (aucun canon si le vaincu décroche) ; +0,5 de prestige
  par drapeau, +0,1 par canon (`f['glory']`), comptés au bilan (`stats.drapeaux`, `stats.canons`).
- **Reconnaissance** : chance que l'annonce soit vraie = 45 % + jusqu'à 25 % selon la part de cavalerie (plein à 15 %
  de cavaliers) + 10 % (hussards) + 10 % (général éclaireur) − 20 % (brouillard), 85 % avec un espion dans la place,
  90 % au plus. Sans cavalerie ni espion : rien n'est annoncé.

## Contrat pour la page

### `/api/map`
- `skirmish` n'existe plus. `rules` gagne : `armes` `{inf, cav, art, tir, grenadiers → libellé}`, `arme_de` `{sorte de régiment →
  arme}`, `strats` `{id → {label, desc, m: {arme → ×}, pertes, bat: [ids], tech: id | null}}`, `situations` `{campagne |
  position | ville | fort → {label, att, def, desc, s_att: [ids], s_def: [ids]}}`, `contre` (1.2), `phase_w`,
  `tech_arme`, `renfort_km`, `poursuite` `{cav, fatigue}`. `phases` a quatre entrées, dans l'ordre. `plans` n'a plus
  cours (encore envoyé, à retirer avec l'ancienne page) ; `formations` ne sert plus qu'à nommer la formation.

### `/api/state`
- `tac` n'existe plus. `settings.battles` : `demander` | `auto` | `auto_petites` (inchangé).
- `armies[].armes` : `{inf, cav, art, tir, grenadiers}` en hommes (0 s'il n'y en a pas) (armées en vue, les vôtres et les autres).
- `armies[].ask.c` : les choix devant une place : `assaut`, et selon la place `rallier`, `negocier`, `assieger`,
  `bloquer`, `contribution`, `attendre` (valeur : `""` si permis, sinon la raison). `ordres`, `manuel`, `auto` ont disparu.
- `battles[]` : champs d'avant (`id, x, y, node, amb, age, terrain, phase, land, river, sides, mode`) et :
  `mode` : `attente` (votre stratégie), `auto` (en cours), `poursuite` (gagnée : poursuivre ?) ; `sit` ; `moi` (0
  assaillant, 1 défenseur, `null` si vous n'y êtes pas) ; `ouvrage` (`null` ou `{type: fort | remparts | barricade |
  redoute, camp: 1, niv, breche}`) ; `meteo` ; `journal` (lignes des phases finies) ; `pese` (`[{c, t}]`) ;
  `sides[].armes`, `sides[].strat` (la vôtre ; celle de l'ennemi seulement quand `mode` vaut `poursuite`),
  `sides[].renf` (noms des armées venues en renfort) ; `sides[].tac[]` n'a plus `pl`.
  En `attente` : `choix` `[{id, why}]`, `defaut` (ce que votre général choisirait), `reco` (`null` ou `{strat, p}`).
  En `poursuite` : `fin` `{w, repli}`.
- `sites[]` (traces, 120 jours) : `[x, y, âge en jours, pertes assaillant, pertes défenseur, assaillant, défenseur,
  vainqueur (0 | 1), prisonniers, place | null, situation]` : deux champs de plus, et les batailles devant une place y
  sont maintenant.
- `events[]` : la fin d'une bataille (`kind: "battle_end"`) porte `bid, node, sit, w, repli, strats: [att, def],
  journal, pese, poursuite, prisonniers, prises: {drapeaux, canons}, generaux: [[camp, nom, blesse | tue | pris]]` en
  plus de `win, a, d, la, ld` ; la reddition d'une place affamée (`kind: "capture"`) porte `capitulation: {node, par,
  de, honneurs, saufs}`.

### `/api/cmd`
- `{cmd: "tac", sub: "choose", bid, strat}` : votre stratégie ; ou `{…, mode: "auto"}` : le général choisit.
  `mode: "ordres"` et `"manuel"` sont refusés. Réponse `{ok, msg, bid}`.
- `{cmd: "tac", sub: "pursue", bid, v: true | false}` : poursuivre ou tenir le terrain.
- `{cmd: "tac", sub: "settings", battles}` : inchangé. Les autres sous-commandes `tac` sont inconnues.
- `{cmd: "arrive", army, value: "assaut"}` : l'escalade ; la réponse porte `bid`.
- `{cmd: "apercu", army, target: {army: id} | {node: n}}` : `{ok, ratio, mot, sit, terrain, moi: {men, armes}, lui:
  {men, armes}, sur}`.
- `/api/skirmish`, `/api/tactic`, `/api/tactic_map` : 404.

## Suite

- Supprimer le module `tactics` (20 000 lignes) : il n'est plus appelé en jeu, mais `bridge.rs` porte encore les
  munitions et la fatigue de campagne (`reg_k`, `march_k`, `army_tick`, `campaign_tick`, `auto_battle_tick`), le réglage
  des batailles, `on_battle_start`, `en_attente`, `command` : à déplacer d'abord dans `engine`. Avec lui : les binaires
  `banc_ia` et `bataille_hex`, les essais `bancs_bataille`, `batailles`, `plans`, `pont`, `terrain`, `terrain_ville`,
  `unites`, `bancs_plans`, `bancs_abris`, les escarmouches de `campagnes.rs`, et leurs références.
- Retirer `rules.PLANS`, `a['pl']`, `a['tac_auto']`, `a['rx']`, `square_reflex` (plus jamais déclenché), les champs
  `Game.tactical`, `tac_done`, `tac_preview`, et `rules.formations` / `plans` de `/api/map` quand la page ne les lit plus.
- « L'armée qui poursuit s'éloigne » : seule la fatigue est comptée ; elle ne quitte pas son hexagone.
