"""Règles du jeu : départements, unités, technologies, bâtiments, météo."""

RESOURCES = ['livres', 'vivres', 'fer', 'bois', 'armes', 'outils', 'recrues']
RES_LABEL = dict(livres='Livres', vivres='Vivres', fer='Fer', bois='Bois', armes='Armes', outils='Outils', recrues='Recrues')

# ------------------------------------------------------------------ départements
FACTIONS = {
    '33': dict(name='Gironde', short='Gironde', capital='Bordeaux', color='#c0392b', adj='girondin',
               title='Le Négoce bordelais',
               pros=['Port de Bordeaux : +25 % de livres', 'Accords commerciaux +25 %', 'Vins : +30 % de revenus viticoles'],
               cons=['Milice bourgeoise : infanterie −8 %', 'Recrues −15 %'],
               mods=dict(livres=0.25, trade=0.25, vin=0.30, inf_power=-0.08, recrues=-0.15),
               personality=dict(aggr=0.45, trade=0.9, expand=0.6, tech='civil'), specialty='livres'),
    '24': dict(name='Dordogne', short='Dordogne', capital='Périgueux', color='#2e8b3a', adj='périgourdin',
               title='Les Forges du Périgord',
               pros=['Forges : +40 % de fer', 'Canons coulés sur place : artillerie −20 %', 'Châteaux : fortifications +10 %'],
               cons=['Pays rural : livres −10 %', 'Relief : routes −5 %'],
               mods=dict(fer=0.40, art_cost=-0.20, fort_bonus=0.10, livres=-0.10, road_speed=-0.05),
               personality=dict(aggr=0.55, trade=0.5, expand=0.7, tech='industriel'), specialty='fer'),
    '40': dict(name='Landes', short='Landes', capital='Mont-de-Marsan', color='#e0a526', adj='landais',
               title='Les Échassiers des Landes',
               pros=['Embuscades +35 %', 'Usure dans landes et marais −60 %', 'Résine et pins : +30 % de bois', 'Cachés plus facilement'],
               cons=['Sol pauvre : vivres −25 %', 'Livres −10 %'],
               mods=dict(ambush=0.35, marsh_attr=-0.60, bois=0.30, stealth=1, vivres=-0.25, livres=-0.10),
               personality=dict(aggr=0.6, trade=0.5, expand=0.8, tech='militaire'), specialty='bois'),
    '47': dict(name='Lot-et-Garonne', short='Lot-et-G.', capital='Agen', color='#8e44ad', adj='agenais',
               title="Le Grenier de l'Aquitaine",
               pros=['Blé et prunes : +35 % de vivres', 'Recrues +15 %', 'Entretien des troupes −20 %'],
               cons=['Plaine ouverte : fortifications −10 %', 'Industrie −15 %'],
               mods=dict(vivres=0.35, recrues=0.15, upkeep=-0.20, fort_bonus=-0.10, industrie=-0.15),
               personality=dict(aggr=0.35, trade=0.8, expand=0.6, tech='agricole'), specialty='vivres'),
    '64': dict(name='Basses-Pyrénées', short='B.-Pyrénées', capital='Pau', color='#2b3fc4', adj='béarnais',
               title='Les Montagnards basques et béarnais',
               pros=['Infanterie +12 %', 'Combat et marche en montagne +25 %', 'Port de Bayonne : livres +10 %'],
               cons=['Isolement : industrie −10 %', 'Commerce −15 %', 'Vivres −10 %'],
               mods=dict(inf_power=0.12, mountain=0.25, livres=0.10, industrie=-0.10, trade=-0.15, vivres=-0.10),
               personality=dict(aggr=0.7, trade=0.4, expand=0.7, tech='militaire'), specialty='recrues'),
}
# Production minimale garantie par jour tant que le département tient son chef-lieu
# (modulée par ses traits : forges du Périgord, pins des Landes, grenier agenais… ; les vivres suivent les saisons)
FLOOR = dict(livres=20, vivres=16, fer=9, bois=9, recrues=8)

# cours ordinaires du marché (Game.new_day les fait varier autour) : la seule source de ces prix
MARKET_BASE = dict(vivres=0.6, fer=2.0, bois=1.0, armes=3.5, outils=3.0, recrues=0.5)

NEUTRAL = 'neutre'
NEUTRAL_COLOR = '#8d8a7a'

# ------------------------------------------------------------------ unités
UNITS = {
    'ligne': dict(name='Infanterie de ligne', short='Ligne', men=300, speed=22, power=1.0,
                  cost=dict(livres=150, armes=40, recrues=300), days=12, upkeep_v=0.6, upkeep_l=1.0,
                  terrain={'Plaine': 1.0, 'Forêt': 0.9, 'Marais': 0.85, 'Montagne': 0.9}),
    'legere': dict(name='Infanterie légère (voltigeurs)', short='Légère', men=240, speed=26, power=0.95,
                   cost=dict(livres=170, armes=35, recrues=240), days=14, upkeep_v=0.6, upkeep_l=1.15,
                   terrain={'Plaine': 0.9, 'Forêt': 1.3, 'Lande': 1.2, 'Marais': 1.2, 'Montagne': 1.25, 'Collines': 1.1, 'Vignoble': 1.1}),
    'cavalerie': dict(name='Cavalerie (dragons, hussards)', short='Cavalerie', men=200, speed=40, power=1.35,
                      cost=dict(livres=260, armes=25, recrues=200, vivres=60), days=18, upkeep_v=1.1, upkeep_l=1.6,
                      terrain={'Plaine': 1.4, 'Lande': 1.1, 'Vignoble': 1.0, 'Forêt': 0.55, 'Marais': 0.45, 'Montagne': 0.5,
                               'Haute montagne': 0.3, 'Collines': 0.9, 'Dunes': 0.6}),
    'artillerie': dict(name='Artillerie (batterie de 8 pièces)', short='Artillerie', men=120, speed=16, power=2.6,
                       cost=dict(livres=300, armes=60, fer=40, bois=30, recrues=120), days=24, upkeep_v=0.8, upkeep_l=2.2,
                       terrain={'Plaine': 1.3, 'Collines': 1.15, 'Vignoble': 1.0, 'Forêt': 0.5, 'Marais': 0.5, 'Montagne': 0.6,
                                'Haute montagne': 0.4, 'Lande': 0.9}),
    'grenadiers': dict(name="Grenadiers (compagnies d'élite)", short='Grenadiers', men=200, speed=22, power=1.45,
                       cost=dict(livres=260, armes=45, recrues=200), days=20, upkeep_v=0.7, upkeep_l=1.7,
                       terrain={'Plaine': 1.0, 'Forêt': 0.9, 'Marais': 0.85, 'Montagne': 0.9}, xp0=30, morale0=10,
                       req='baionnette', desc='Infanterie d’élite : frappe fort, tient sous le feu, coûte cher.'),
    'chasseurs': dict(name='Chasseurs basques (montagnards)', short='Chasseurs', men=200, speed=27, power=0.95,
                      cost=dict(livres=160, armes=30, recrues=200), days=14, upkeep_v=0.6, upkeep_l=1.1,
                      terrain={'Plaine': 0.85, 'Forêt': 1.25, 'Lande': 1.0, 'Marais': 1.0, 'Vignoble': 1.05, 'Collines': 1.35,
                               'Montagne': 1.6, 'Haute montagne': 1.7},
                      where=('64',), desc='Infanterie légère des montagnes : redoutable en relief, s’use peu dans les cols. '
                                          'Levée seulement en Pays basque et en Béarn.'),
    'mitrailleuses': dict(name='Mitrailleuses (batterie de Reffye)', short='Mitrailleuses', men=90, speed=16, power=2.2,
                          cost=dict(livres=320, armes=70, fer=40, bois=20, recrues=90), days=24, upkeep_v=0.7, upkeep_l=2.0,
                          terrain={'Plaine': 1.3, 'Collines': 1.15, 'Vignoble': 1.0, 'Forêt': 0.5, 'Marais': 0.5,
                                   'Montagne': 0.6, 'Haute montagne': 0.4, 'Lande': 0.9},
                          req='mitrailleuse', arm_name='Reffye',
                          desc='Six mitrailleuses de Reffye : un feu roulant à 1 200 mètres, redoutable contre l’infanterie '
                               'à découvert, mais impuissant contre les remparts.'),
    'sapeurs': dict(name='Sapeurs du génie', short='Sapeurs', men=150, speed=20, power=0.55,
                    cost=dict(livres=200, armes=20, outils=30, recrues=150), days=16, upkeep_v=0.6, upkeep_l=1.3,
                    terrain={'Plaine': 1.0, 'Forêt': 0.9, 'Marais': 0.9, 'Montagne': 0.9},
                    desc='Peu combatifs, mais chaque compagnie accélère les sièges et jette des ponts : '
                         'l’armée franchit les fleuves sans attendre le bac.'),
    'garde': dict(name='Garde nationale', short='Garde nat.', men=300, speed=20, power=0.55,
                  cost=dict(livres=50, armes=15, recrues=200), days=6, upkeep_v=0.3, upkeep_l=0.3,
                  terrain={'Plaine': 1.0, 'Forêt': 0.9, 'Marais': 0.9, 'Montagne': 0.9}, garrison_only=True,
                  desc='Milice citoyenne bon marché, levée même dans un village : elle ne quitte pas sa ville, '
                       'mais la défend avec ardeur (+30 %).'),
}
UNIT_ORDER = ['ligne', 'legere', 'grenadiers', 'chasseurs', 'cavalerie', 'artillerie', 'mitrailleuses', 'sapeurs', 'garde']
UNIT_CLS = {'cavalerie': 'cavalerie', 'artillerie': 'artillerie', 'mitrailleuses': 'artillerie'}   # tout le reste est de l'infanterie
LIGHT_UNITS = ('legere', 'chasseurs')
READY = {'grenadiers': 'prêts', 'chasseurs': 'prêts', 'sapeurs': 'prêts', 'mitrailleuses': 'prêtes'}   # les autres noms sont féminins
for _k, _u in UNITS.items():
    _u.setdefault('ready', READY.get(_k, 'prête'))
    _u.setdefault('cls', UNIT_CLS.get(_k, 'inf'))
    _u.setdefault('light', _k in LIGHT_UNITS)
    _u.setdefault('garrison_only', False)
    _u.setdefault('req', None)
    _u.setdefault('desc', '')
    _u.setdefault('arm_name', None)   # armement fixe (pas de réarmement) : la pièce de Reffye
UNITS['ligne']['desc'] = 'Le gros de l’armée : feu de ligne, colonne d’assaut ou carré.'
UNITS['legere']['desc'] = 'Voltigeurs : rapides, à l’aise en forêt, en lande et en marais, tendent des embuscades.'
UNITS['cavalerie']['desc'] = 'Dragons et hussards : charge en terrain ouvert, poursuite, éclairage.'
UNITS['artillerie']['desc'] = 'Batterie de 8 pièces : domine la canonnade et ouvre les brèches.'
# Population : chaque agrandissement ouvre de la place (+10 %), que les habitants remplissent mois après mois
# si la ville est sûre, nourrie et pas trop imposée ; ses ateliers produisent davantage une fois les faubourgs
# remplis. La production suit la population (son remplissage), la taille des villes suit l'histoire (POP_CURVES).
POP_NATURAL = 0.05           # croissance possible sans agrandissement
POP_PER_LEVEL = 0.10         # place gagnée à chaque agrandissement
DEV_PROD = 0.30              # production gagnée à chaque agrandissement, faubourgs remplis (aux prix de 1790 : un
                             # faubourg compte un peu plus en 1700, un peu moins en 1890, quand tout a grandi)
POP_RATE = 0.12              # part de la place libre comblée chaque mois, dans de bonnes conditions
DEV_NAMES = {
    'village': ['Village', 'Village agrandi', 'Gros bourg', 'Bourg prospère'],
    'fort': ['Place forte', 'Quartier neuf', 'Ville de garnison', 'Ville forte prospère'],
    'ville': ['Ville close', 'Premiers faubourgs', 'Nouveaux quartiers', 'Grande ville'],
    'capitale': ['Ville close', 'Premiers faubourgs', 'Nouveaux quartiers', 'Métropole'],
}
DEPOT_KM = 30.0              # rayon d'action d'un magasin aux vivres
DEPOT_FOOD = 0.15            # vivres par jour et par centaine d'hommes ravitaillés par un magasin
PRISONER_FOOD = 0.003        # vivres par jour et par prisonnier
PRISONER_RANSOM = 2          # livres par prisonnier racheté
SAPEUR_SIEGE = 0.04
PROPOSAL_TOURS = 1           # validité d'une proposition reçue : le tour qui suit (turns.deadline)
PEACE_TRUCE = 4              # trêve après une paix signée (tours)


def de(nom):
    """« de » élidé devant une voyelle ou un h muet : d'Agen, d'avril, de Bordeaux."""
    if nom.startswith('Le '):
        return 'du ' + nom[3:]       # le Bugue → du Bugue
    if nom.startswith('Les '):
        return 'des ' + nom[4:]
    return f"d'{nom}" if nom[:1].lower() in 'aeiouyhâàéèêîïôöûü' else f"de {nom}"


def num(x, dec=1):
    """Nombre à la française : virgule décimale, signe moins typographique."""
    s = f"{abs(x):.{dec}f}".replace('.', ',')
    return ('−' if x < 0 else '+') + s


def nb(x):
    """Entier à la française, milliers séparés par une espace fine insécable : « 5 350 habitants »."""
    s = f"{abs(int(round(x))):,}".replace(',', ' ')
    return ('−' if x < -0.5 else '') + s


def pl(n, sing, plur=None):
    """« 1 vignoble », « 3 vignobles »."""
    return f"{n} {sing if abs(n) < 2 else (plur or sing + 's')}"          # avancée du siège par jour et par compagnie de sapeurs
GARDE_HOME = 1.3             # la Garde nationale défend sa propre ville

MILICE_POWER = 0.6

# ------------------------------------------------------------------ nœuds
NODE_BASE = {
    'capitale': dict(livres=5, vivres=1.8, recrues=2.2, industrie=3, fer=0.2, bois=0.3, milice=600, vision=26),
    'ville': dict(livres=1.9, vivres=1.3, recrues=1.1, industrie=1.1, fer=0.1, bois=0.25, milice=220, vision=20),
    'village': dict(livres=0.6, vivres=1.5, recrues=0.6, industrie=0.15, fer=0, bois=0.3, milice=130, vision=15),
    'fort': dict(livres=0.3, vivres=0.4, recrues=0.4, industrie=0.1, fer=0, bois=0.15, milice=220, vision=22),
}
SPEC = {
    'vin': dict(livres=1.2, label='Vignoble'),
    'port': dict(livres=2.0, label='Port'),
    'fer': dict(fer=1.6, label='Forges / mines'),
    'bois': dict(bois=1.6, label='Forêt exploitée'),
    'ble': dict(vivres=1.2, label='Blé'),
    'sel': dict(livres=1.2, label='Salines'),
    'tabac': dict(livres=0.9, label='Tabac & prunes'),
}
# Spécialités phares des villes principales (voir places.CITY_SPECIALTIES) : production par jour,
# et le modificateur (technologies) qui l'augmente.
SPECIALTY = {
    'grand_vin': dict(label='Grand vin', livres=0.85, boost='vin'),
    'vin': dict(label='Vin', livres=0.55, boost='vin'),
    'eau_de_vie': dict(label='Eau-de-vie', livres=0.6, boost='vin'),
    'negoce': dict(label='Négoce', livres=0.85, boost='port'),
    'peche': dict(label='Pêche', livres=0.3, vivres=0.8, boost='port'),
    'sel': dict(label='Sel', livres=0.6),
    'prune': dict(label='Pruneaux', livres=0.5, vivres=0.3, boost='terroir'),
    'terroir': dict(label='Terroir', livres=0.45, vivres=0.3, boost='terroir'),
    'salaisons': dict(label='Salaisons', livres=0.35, vivres=0.4, boost='terroir'),
    'betail': dict(label='Élevage', livres=0.25, vivres=0.6, recrues=0.2, boost='terroir'),
    'ble': dict(label='Grains', livres=0.2, vivres=0.9),
    'resine': dict(label='Résine', livres=0.3, bois=0.6, boost='resine'),
    'textile': dict(label='Manufacture', livres=0.35, industrie=0.5, boost='manuf'),
    'tabac': dict(label='Tabacs', livres=0.55, industrie=0.3, boost='manuf'),
    'forge': dict(label='Forges', fer=0.6, industrie=0.4, boost='manuf'),
}
SPECIALTY_CAPITAL = 2.0   # un chef-lieu produit davantage de sa spécialité
VIN_KINDS = {'grand_vin': 2, 'vin': 1, 'eau_de_vie': 1}   # comptent aux vendanges (nombre de vignobles)

# Fortifications : niveaux 1 à 3 partout, niveau 4 (bastions à la Vauban) dans les chefs-lieux et les places fortes,
# après la technologie « Fortifications à la Vauban ». Chaque niveau s'entretient (livres par jour et par place).
FORT_MAX = 3
# canons du rempart (une batterie par niveau de fortification) : en résolution automatique, ils ne comptent qu'à
# moitié (mal placés contre un assaut en masse, et les murs donnent déjà leur bonus) ; entiers en bataille commandée
FORT_GUNS_AUTO = 0.5
BASTION_LEVEL = 4
BASTION_TYPES = ('capitale', 'fort')
FORT_UPKEEP = [0.0, 0.3, 0.7, 1.2, 2.0]
FORT_NAMES = ['Sans remparts', 'Mur d’enceinte', 'Remparts', 'Remparts bastionnés', 'Bastions à la Vauban']
BUILD = {
    'fort': dict(name='Fortifications', max=BASTION_LEVEL,
                 cost=lambda lvl: dict(livres=120 * (lvl + 1), bois=40 * (lvl + 1), fer=15 * (lvl + 1)) if lvl < 3
                 else dict(livres=650, bois=180, fer=90),
                 days=lambda lvl: 20 + 12 * lvl if lvl < 3 else 70,
                 desc='+1 niveau de fortification : défense accrue, sièges plus longs, mais entretien plus cher'),
    'depot': dict(name='Magasin aux vivres', max=1, cost=lambda lvl: dict(livres=150, bois=60), days=lambda lvl: 12,
                  desc='Entrepôt et charrois : les armées en campagne à moins de 30 km restent ravitaillées, '
                       'en puisant dans vos vivres'),
    'dev': dict(name='Agrandissement', max=3, cost=lambda lvl: dict(livres=100 * (lvl + 1), bois=50 * (lvl + 1), outils=15 * (lvl + 1)),
                days=lambda lvl: 18 + 10 * lvl,
                desc='Nouveaux faubourgs : la ville peut accueillir 10 % d’habitants de plus, qui viennent s’y installer '
                     'peu à peu, et ses ateliers s’étendent : plus de production, de recrues et de milice'),
}

# ------------------------------------------------------------------ technologies
TECHS = [
    # id, branche, nom, description, coût, jours, prérequis, effets
    ('baionnette', 'militaire', 'Fusil et baïonnette à douille', "Inventée à Bayonne : la pique disparaît, chaque fantassin tire et charge. Armement de l'infanterie : fusil à silex (×1,00 au lieu de ×0,85).", 375, 28, [], dict()),
    ('fusil1777', 'militaire', 'Fusil modèle 1777', 'Platine fiable, tir plus nourri (armement ×1,10). Ligne −10 % armes.', 750, 42, ['baionnette'], dict(ligne_armes=-0.10)),
    ('valliere', 'militaire', 'Système Vallière', 'Calibres réglementés de 4 à 24 : artillerie ×0,95 au lieu de ×0,85.', 625, 35, [], dict()),
    ('gribeauval', 'militaire', 'Système Gribeauval', 'Canons standardisés et légers : artillerie ×1,15, plus rapide.', 875, 49, ['valliere'], dict(art_speed=0.25)),
    ('etat_major', 'militaire', "École d'état-major", 'Officiers formés aux cartes et à la logistique : toutes armes +5 %, moral +5.', 1125, 56, ['divisions'], dict(all_power=0.05, morale=5)),
    ('valee', 'militaire', 'Système Valée', 'Affûts à flèche, caissons montés : artillerie ×1,30, +10 % de vitesse.', 1125, 56, ['gribeauval'], dict(art_speed=0.10)),
    ('percussion', 'militaire', 'Fusil à percussion', "L'amorce au fulminate ne craint plus l'humidité : armement ×1,22, la pluie gêne 60 % moins le tir.", 1125, 56, ['fusil1777'], dict(rain=0.60)),
    ('minie', 'militaire', 'Fusil rayé (balle Minié)', 'Le canon rayé porte à 400 mètres : armement ×1,40, tirailleurs +10 % à couvert.', 1375, 63, ['percussion'], dict(legere_cover=0.10)),
    ('lahitte', 'militaire', 'Canons rayés La Hitte', 'Obus oblongs, tir précis à 3 km : artillerie ×1,55.', 1375, 63, ['valee'], dict()),
    ('chassepot', 'militaire', 'Fusil Chassepot', 'Chargement par la culasse, 1 200 mètres : armement ×1,70. On tire couché, cinq coups à la minute.', 1625, 70, ['minie'], dict(ligne_fire=0.10)),
    ('mitrailleuse', 'militaire', 'Mitrailleuse de Reffye', '25 canons tournés à la manivelle : on peut lever des batteries de mitrailleuses, feu roulant à 1 200 mètres, redoutable contre l’infanterie à découvert.', 1250, 56, ['lahitte'], dict()),
    ('service_mil', 'militaire', 'Service militaire obligatoire', 'Loi de 1872 : chaque classe passe sous les drapeaux. Recrues +25 %, recrutement −15 % de livres, moral +5.', 1375, 63, ['levee'], dict(recrues=0.25, recruit_cost=-0.15, morale=5)),
    ('gras', 'militaire', 'Fusil Gras (cartouche métallique)', "La douille de laiton ne s'enraye plus : armement ×1,82.", 1500, 63, ['chassepot'], dict()),
    ('debange', 'militaire', 'Canons de Bange', 'Acier et culasse étanche : artillerie ×1,85, les sièges avancent 25 % plus vite.', 1750, 70, ['lahitte'], dict(siege_speed=0.25)),
    ('lebel', 'militaire', 'Fusil Lebel et poudre sans fumée', "Magasin de huit cartouches, poudre B de Vieille : armement ×2,05, plus de nuage pour trahir le tireur (embuscades +20 %).", 1875, 77, ['gras'], dict(ambush=0.20)),
    ('canon75', 'militaire', 'Canon de 75', 'Frein hydropneumatique, tir rapide : artillerie ×2,30.', 2000, 84, ['debange'], dict()),
    ('hussards', 'militaire', 'Hussards et éclaireurs', 'Cavalerie +15 %, vision +6 km, débusque les embuscades.', 625, 35, [], dict(cav_power=0.15, vision=6, detect=3)),
    ('voltigeurs', 'militaire', 'Tirailleurs et voltigeurs', 'Embuscades +30 %, infanterie légère +20 % à couvert.', 750, 42, ['baionnette'], dict(ambush=0.30, legere_cover=0.20)),
    ('vauban', 'militaire', 'Fortifications à la Vauban', 'Défense des places +15 %, milice +25 %, bastions (fortifications niveau 4) dans le chef-lieu et les places fortes.', 750, 42, [], dict(fort_bonus=0.15, milice=0.25)),
    ('levee', 'militaire', 'Levée en masse', 'Recrutement −25 % de livres, formation −30 %, recrues +20 %.', 1125, 56, ['fusil1777'], dict(recruit_cost=-0.25, train=-0.30, recrues=0.20)),
    ('divisions', 'militaire', 'Système divisionnaire', 'Toutes armes +8 %, moral +10, retraites moins coûteuses.', 1500, 70, ['gribeauval', 'levee'], dict(all_power=0.08, morale=10, retreat=-0.5)),
    ('tir_rang', 'militaire', 'Feu de rang (tir en ligne)', 'Les trois rangs tirent ensemble : infanterie en ligne +12 % en fusillade.', 625, 35, ['baionnette'], dict(ligne_fire=0.12)),
    ('feu_peloton', 'militaire', 'Feu de peloton', 'Feux roulants par pelotons : ligne encore +10 % en fusillade, le carré fusille mieux les escadrons (+30 %).', 875, 49, ['tir_rang'], dict(ligne_fire=0.10, carre_fire=0.30)),
    ('ordre_mixte', 'militaire', 'Ordre mixte (Guibert)', 'Lignes et colonnes combinées : colonne +15 % à la charge, changements de formation deux fois plus rapides.', 750, 42, ['tir_rang'], dict(colonne_charge=0.15, fm_swift=0.5)),
    ('cuirassiers', 'militaire', 'Cuirassiers et carabiniers', 'Cavalerie lourde cuirassée : cavalerie +20 % pendant la charge.', 875, 49, ['hussards'], dict(cav_charge=0.20)),
    ('art_cheval', 'militaire', 'Artillerie à cheval', 'Batteries montées : artillerie +10 %, plus rapide, et efficace jusque dans la charge (+30 %).', 1000, 56, ['gribeauval'], dict(art_power=0.10, art_speed=0.20, art_charge=0.30)),
    ('genie', 'militaire', 'Corps du génie et sapeurs', 'Tranchées et mines : les sièges avancent 40 % plus vite.', 875, 49, ['vauban'], dict(siege_speed=0.40)),
    ('aerostiers', 'militaire', 'Aérostiers (Fleurus)', "Un ballon captif au-dessus de l'état-major : en bataille, tout ennemi à 1 500 mètres du général est vu ; vision +3 km.", 875, 49, ['genie'], dict(balloon=1500, vision=3)),
    ('retranchements', 'militaire', 'Retranchements de campagne', "La pelle avant le fusil : en bataille, l'infanterie arrêtée depuis cinq minutes se retranche et perd 25 % d'hommes de moins sous le feu.", 1250, 56, ['genie'], dict(entrench=0.25)),
    ('dynamite', 'militaire', 'Dynamite (Nobel)', "Les sapeurs font sauter les murs : à l'assaut, une brèche de plus ; les sièges avancent 20 % plus vite.", 1250, 56, ['genie'], dict(breach=1, siege_speed=0.20)),
    ('melinite', 'militaire', 'Obus à la mélinite', "L'obus explosif perce murs et abris : le couvert protège moitié moins des pièces de ce camp.", 1625, 70, ['dynamite', 'debange'], dict(shell=0.5)),
    ('rail_militaire', 'militaire', 'Chemins de fer militaires', "Les régiments voyagent en wagons : les armées prendront le train sur les lignes de leur camp (avec les voies ferrées de la carte).", 1375, 63, ['chemins_fer'], dict(rail_troops=1)),

    ('ponts_chaussees', 'civil', 'Corps des Ponts et Chaussées', 'Routes entretenues : +15 % de vitesse sur route.', 500, 35, [], dict(road_speed=0.15)),
    ('ponts', 'civil', 'Ponts de pierre', 'Plus de bac : les fleuves se franchissent sans délai.', 750, 42, ['ponts_chaussees'], dict(bridges=1)),
    ('prefectures', 'civil', 'Administration préfectorale', 'Livres +10 %, villes conquises pacifiées 2× plus vite.', 625, 42, [], dict(livres=0.10, stab=1.0)),
    ('chappe', 'civil', 'Télégraphe Chappe', 'Vision des villes +10 km, alertes plus tôt.', 875, 49, ['prefectures'], dict(node_vision=10)),
    ('larrey', 'civil', 'Ambulances de Larrey', 'Pertes au combat −15 %, usure −40 %.', 750, 42, [], dict(casualties=-0.15, attrition=-0.40)),
    ('codecivil', 'civil', 'Code civil', 'Livres +10 %, recrues +10 %, prestige diplomatique.', 1250, 62, ['prefectures'], dict(livres=0.10, recrues=0.10, prestige=10)),
    ('diplomates', 'civil', 'Corps diplomatique', 'Accords commerciaux +30 %, propositions mieux reçues.', 625, 35, [], dict(trade=0.30, diplo=15)),
    ('gendarmerie', 'civil', 'Gendarmerie nationale', 'Brigades dans chaque canton : ordre public +8 %, moins de révoltes.', 625, 35, [], dict(order=0.08)),
    ('cadastre', 'civil', 'Cadastre et contribution foncière', 'Impôt juste et bien réparti : livres +6 %, les impôts lourds fâchent 40 % moins.', 750, 42, ['prefectures'], dict(livres=0.06, tax_unrest=-0.40)),
    ('poste', 'civil', 'Poste aux chevaux et relais', 'Relais sur les grandes routes : +8 % sur route, les armées s’épuisent 35 % moins vite hors de chez elles.', 625, 35, ['ponts_chaussees'], dict(road_speed=0.08, supply_drain=-0.35)),
    ('canal', 'civil', 'Balisage de la Garonne et canaux', 'Chenaux balisés, chemins de halage : gabares +25 % plus rapides, ports +10 %.', 875, 49, ['ponts_chaussees'], dict(river_speed=0.25, port=0.10)),
    ('ecoles', 'civil', 'Écoles centrales', 'Savants et ingénieurs formés : toutes les recherches 25 % plus rapides.', 1000, 56, ['codecivil'], dict(research_speed=0.25)),
    ('escompte', 'civil', "Caisse d'escompte", 'Crédit aux négociants : meilleurs prix au marché, commerce +10 %.', 750, 42, ['diplomates'], dict(market=0.08, trade=0.10)),
    ('chemins_fer', 'civil', 'Chemins de fer', 'Bordeaux–La Teste en 1841, puis Paris : on peut construire des voies ferrées sur les tracés historiques (panneau des villes). Chaque ligne ouverte dope l’industrie et le commerce de ses villes, et ravitaille les armées proches de ses gares.', 1500, 70, ['ponts'], dict()),
    ('telegraphe', 'civil', 'Télégraphe électrique', 'Les nouvelles vont à la vitesse de l’éclair : vision des villes +15 km, des armées +4 km.', 1125, 56, ['chappe'], dict(node_vision=15, vision=4)),
    ('ferry', 'civil', 'Écoles de Jules Ferry', 'École gratuite, laïque et obligatoire : recherches +20 %, ordre public +5 %, recrues +5 %.', 1375, 63, ['ecoles'], dict(research_speed=0.20, order=0.05, recrues=0.05)),
    ('hygiene', 'civil', 'Hygiène pastorienne', 'Vaccins, eau saine, asepsie : usure des armées −30 %, pertes −10 %.', 1250, 56, ['larrey'], dict(attrition=-0.30, casualties=-0.10)),
    ('vaccine', 'civil', 'Vaccine (Jenner)', 'La vaccination contre la variole : usure des armées −15 %, les épidémies (choléra, fièvres) tuent moitié moins.', 750, 42, [], dict(attrition=-0.15, epidemics=-0.5)),
    ('caisse_epargne', 'civil', "Caisse d'épargne", "L'épargne des humbles à l'abri : le trésor rapporte 2 % l'an.", 875, 49, ['escompte'], dict(interest=0.02)),
    ('gaz', 'civil', 'Éclairage au gaz', 'Réverbères et ateliers ouverts le soir : ordre public +6 %, les villes produisent 5 % de livres de plus.', 1000, 56, ['vapeur'], dict(order=0.06, city_livres=0.05)),
    ('photographie', 'civil', 'Photographie', "Daguerréotypes et reconnaissances : les armées ennemies repérées montrent l'expérience et l'armement de leurs régiments.", 1000, 56, ['ecoles'], dict(intel=1)),
    ('suffrage', 'civil', 'Suffrage universel', 'Chaque homme vote : la lassitude de la guerre monte 25 % moins vite, ordre public +5 %.', 1125, 56, ['codecivil'], dict(weariness=-0.25, order=0.05)),
    ('mutuelles', 'civil', 'Sociétés de secours mutuels', 'On cotise pour les malades et les veuves : les places mal assimilées se révoltent moitié moins, recrues +5 %.', 1000, 49, ['suffrage'], dict(revolt=-0.5, recrues=0.05)),
    ('croix_rouge', 'civil', 'Croix-Rouge (convention de Genève)', "Les blessés sont soignés des deux côtés : un quart des pertes d'une bataille rejoint ses régiments ; pertes −5 %.", 1250, 56, ['larrey'], dict(wounded=0.25, casualties=-0.05)),
    ('telephone', 'civil', 'Téléphone', "Le fil parle : vision des villes +10 km, les armées ennemies sont annoncées un tour avant d'entrer chez vous.", 1375, 63, ['telegraphe'], dict(node_vision=10, alert=1)),
    ('syndicats', 'civil', 'Syndicats (loi de 1884)', "Les ouvriers s'organisent : industrie +10 %, mais une ville à l'ordre bas peut faire grève (en janvier, ses ateliers presque arrêtés pendant un tour).", 1375, 63, ['mutuelles'], dict(industrie=0.10, strikes=1)),

    ('hauts_fourneaux', 'industriel', 'Hauts fourneaux', 'Production de fer +30 %.', 500, 35, [], dict(fer=0.30)),
    ('manufactures', 'industriel', 'Manufactures royales', 'Capacité industrielle +25 %.', 625, 42, [], dict(industrie=0.25)),
    ('fonderie', 'industriel', 'Fonderie de canons', 'Artillerie −30 % de coût et de délai.', 750, 42, ['hauts_fourneaux'], dict(art_cost=-0.30, art_train=-0.30)),
    ('vapeur', 'industriel', 'Machine à vapeur', 'Capacité industrielle +35 %.', 1250, 62, ['manufactures'], dict(industrie=0.35)),
    ('outillage', 'industriel', 'Outillage standardisé', 'Bonus des outils jusqu’à +45 %, usure −40 %, outils moins chers.', 875, 49, ['manufactures'], dict(tools_max=0.15, tools_wear=-0.40, tools_cost=-0.30)),
    ('armureries', 'industriel', "Armureries d'État", 'Fabrication des armes +40 %.', 875, 49, ['hauts_fourneaux'], dict(armes_eff=0.40)),
    ('poudreries', 'industriel', 'Poudreries nationales', 'Salpêtre raffiné, poudre régulière : infanterie et artillerie +5 %.', 625, 35, [], dict(inf_power=0.05, art_power=0.05)),
    ('coke', 'industriel', 'Forges à l’anglaise (coke)', 'Fonte au coke : fer +25 %, capacité industrielle +10 %.', 1000, 56, ['hauts_fourneaux'], dict(fer=0.25, industrie=0.10)),
    ('pieces', 'industriel', 'Pièces interchangeables (Honoré Blanc)', 'Platines identiques : armes +30 %, la ligne coûte 10 % d’armes en moins.', 1125, 56, ['armureries'], dict(armes_eff=0.30, ligne_armes=-0.10)),
    ('draperies', 'industriel', 'Draperies et manufactures de province', 'Draps, cuirs, tabacs et forges des villes +40 % ; uniformes : moral +5.', 750, 42, ['manufactures'], dict(manuf=0.40, morale=5)),
    ('acier', 'industriel', 'Acier Bessemer et Martin', 'Convertisseurs et fours Martin : fer +30 %, armes +20 %.', 1375, 63, ['coke'], dict(fer=0.30, armes_eff=0.20)),
    ('electricite', 'industriel', 'Électricité', 'Dynamos et moteurs : capacité industrielle +30 %.', 1625, 70, ['vapeur'], dict(industrie=0.30)),
    ('gabares', 'industriel', 'Chantiers de gabares', 'Gabares et couraux plus grands : transport fluvial +15 %, ports +10 %.', 625, 35, [], dict(river_speed=0.15, port=0.10)),
    ('vapeur_fluviale', 'industriel', 'Bateau à vapeur', "Les vapeurs à roues de la Garonne (1818) : on remonte les fleuves aussi vite qu'on les descend, ports +10 %.", 1000, 56, ['vapeur'], dict(upstream=1, port=0.10)),
    ('ciment', 'industriel', 'Ciment (Vicat)', 'Le ciment hydraulique de Louis Vicat : constructions −15 % de coût et de délai.', 875, 49, ['manufactures'], dict(build_cost=-0.15)),
    ('fresnel', 'industriel', 'Phares à lentille de Fresnel', "Cordouan reçoit la lentille d'Augustin Fresnel en 1823 : commerce +10 %, ports +15 %.", 750, 42, ['gabares'], dict(trade=0.10, port=0.15)),

    ('assolement', 'agricole', 'Assolement sans jachère', 'Vivres +20 %.', 375, 28, [], dict(vivres=0.20)),
    ('pomme_de_terre', 'agricole', 'Pomme de terre (Parmentier)', "L'hiver ne vide plus les greniers.", 500, 35, [], dict(winter_food=0.30)),
    ('drainage', 'agricole', 'Drainage des marais', 'Villages en lande/marais +30 %, fièvres −50 %.', 750, 42, ['assolement'], dict(lande_prod=0.30, marsh_attr=-0.50)),
    ('pins', 'agricole', 'Semis de pins (Brémontier)', 'Bois +40 %.', 625, 35, [], dict(bois=0.40)),
    ('haras', 'agricole', 'Haras et élevage', 'Cavalerie −25 % de coût et de délai, vivres +5 %.', 750, 42, ['assolement'], dict(cav_cost=-0.25, cav_train=-0.25, vivres=0.05)),
    ('chais', 'agricole', 'Chais et négoce du vin', 'Revenus du vin +40 %, ports +15 %.', 625, 35, [], dict(vin=0.40, port=0.15)),
    ('engrais', 'agricole', 'Prairies artificielles', 'Vivres +25 %, recrues +10 %.', 1125, 56, ['pomme_de_terre', 'drainage'], dict(vivres=0.25, recrues=0.10)),
    ('mais', 'agricole', 'Maïs de Chalosse et du Béarn', 'Le « blé d’Espagne » : vivres +12 %, hivers moins durs.', 500, 35, [], dict(vivres=0.12, winter_food=0.10)),
    ('foires', 'agricole', 'Foires et marchés agricoles', 'Pruneaux, foie gras, jambons, bœufs : produits du terroir des villes +35 %.', 625, 35, [], dict(terroir=0.35)),
    ('gemmage', 'agricole', 'Gemmage et résiniers', 'Les pins saignés donnent la résine : spécialités résinières +50 %, landes +10 %.', 625, 35, ['pins'], dict(resine=0.50, lande_prod=0.10)),
    ('transhumance', 'agricole', 'Transhumance et estives', 'Troupeaux aux estives : places en montagne et en collines +30 %.', 625, 35, [], dict(mountain_prod=0.30)),
    ('greniers', 'agricole', 'Greniers publics', 'Réserves de la nation : greniers +50 %.', 750, 42, ['assolement'], dict(granary=0.50)),
    ('engrais_chim', 'agricole', 'Engrais chimiques', 'Guano, phosphates, superphosphates : vivres +20 %.', 1250, 56, ['engrais'], dict(vivres=0.20)),
    ('landes1857', 'agricole', 'Assainissement des Landes (loi de 1857)', 'Les communes plantent et drainent la lande : landes et marais +40 %, bois +20 %.', 1125, 56, ['drainage', 'pins'], dict(lande_prod=0.40, bois=0.20)),
    ('greffe', 'agricole', 'Vignes greffées sur plants américains', 'Après le phylloxéra, le vignoble renaît : revenus du vin +30 %.', 1125, 56, ['chais'], dict(vin=0.30)),
    ('conserves', 'agricole', 'Conserves d’Appert', 'Vivres en bocaux : les armées s’épuisent 40 % moins vite loin de chez elles.', 1000, 56, ['pomme_de_terre'], dict(supply_drain=-0.40)),
    ('betterave', 'agricole', 'Sucre de betterave', 'Le sucre ne vient plus des îles : vivres +5 %, le Blocus continental ne coûte plus rien aux ports.', 625, 35, ['assolement'], dict(vivres=0.05, blockade=-1.0)),
    ('dombasle', 'agricole', 'Charrue Dombasle', 'Le soc de fer de Mathieu de Dombasle : vivres +10 %.', 750, 42, ['assolement'], dict(vivres=0.10)),
    ('moissonneuses', 'agricole', 'Moissonneuses et batteuses à vapeur', 'Les machines aux champs : vivres +15 %, recrues +10 % (les bras libérés).', 1250, 56, ['dombasle', 'vapeur'], dict(vivres=0.15, recrues=0.10)),
    ('bouillie', 'agricole', 'Bouillie bordelaise (Millardet)', 'Sulfate de cuivre et chaux, trouvés à Bordeaux : vin +15 %, le phylloxéra et le mildiou frappent moitié moins.', 1125, 56, ['greffe'], dict(vin=0.15, vine_blight=-0.5)),
]
# durée en jours de travail, arrondie au tour (30 jours de travail ; SPEC-TOURS.md, règle B) : 28 à 84 jours → 1 à 3 tours
TECH = {t[0]: dict(id=t[0], branch=t[1], name=t[2], desc=t[3], cost=t[4], days=30 * max(1, int(t[5] / 30 + 0.5)), req=t[6],
                   fx=t[7]) for t in TECHS}
BRANCHES = ['militaire', 'civil', 'industriel', 'agricole']

# marques visibles (SPEC-TECH.md, module visuels) : la technologie du camp qui les fait apparaître ; la bataille et la
# carte lisent cette table au lieu de comparer des années partout
VISUALS = dict(
    sans_fumee=dict(tech='lebel'),      # poudre B : l'artillerie et les mitrailleuses du camp tirent sans fumée
    reffye=dict(tech='mitrailleuse'),
    # la carte selon l'époque (SPEC-SUITE, partie H) : ce que la carte de campagne dessine chez le camp qui les a
    chappe=dict(tech='chappe'),            # tours Chappe aux bras mobiles près des villes
    telegraphe=dict(tech='telegraphe'),    # poteaux et fil le long des routes royales et des voies ferrées
    usines=dict(tech='vapeur'),            # cheminées d'usine qui fument dans les villes
    vapeurs=dict(tech='vapeur_fluviale'),  # vapeurs à roues parmi les gabares
    forges=dict(tech='hauts_fourneaux'),   # lueur rouge des forges
    gaz=dict(tech='gaz'),                  # réverbères des villes
    fresnel=dict(tech='fresnel'),          # faisceau de Cordouan plus long
    pins=dict(tech='pins'),                # les pins gagnent la lande
    landes1857=dict(tech='landes1857'),    # la forêt de pins des Landes
    gemmage=dict(tech='gemmage'),          # pots de résine
    drainage=dict(tech='drainage'),        # les marais rétrécissent
    greffe=dict(tech='greffe'),            # vignes replantées en rangs après le phylloxéra
    mais=dict(tech='mais'),                # maïs en Chalosse et en Béarn
    assolement=dict(tech='assolement'),    # champs plus variés
    moissonneuses=dict(tech='moissonneuses'),
)


# découvertes des IA annoncées au joueur (un bandeau) : ce qui se voit sur la carte ou en bataille
NOTABLE_TECHS = {v['tech'] for v in VISUALS.values()} | {'chemins_fer', 'rail_militaire'}


def marks(techs):
    """Marques visibles d'un camp qui a ces technologies."""
    return [k for k, v in VISUALS.items() if v['tech'] in techs]

# ------------------------------------------------------------------ saisons & météo
SEASONS = ['hiver', 'hiver', 'printemps', 'printemps', 'printemps', 'été', 'été', 'été', 'automne', 'automne', 'automne', 'hiver']
SEASON_LABEL = {'printemps': 'Printemps', 'été': 'Été', 'automne': 'Automne', 'hiver': 'Hiver'}
SEASON_FOOD = {'printemps': 0.9, 'été': 1.25, 'automne': 1.35, 'hiver': 0.45}
SEASON_ROAD = {'printemps': 0.95, 'été': 1.0, 'automne': 0.95, 'hiver': 0.82}
SEASON_OFF = {'printemps': 0.92, 'été': 1.0, 'automne': 0.9, 'hiver': 0.72}

WEATHER = {
    'soleil': dict(label='Ensoleillé', icon='☀️', fire=1.0, move=1.0, food=1.0, vision=1.0),
    'nuages': dict(label='Nuageux', icon='⛅', fire=1.0, move=1.0, food=1.0, vision=1.0),
    'pluie': dict(label='Pluie', icon='🌧️', fire=0.75, move=0.85, food=1.0, vision=0.85),
    'orage': dict(label='Orage', icon='⛈️', fire=0.6, move=0.75, food=0.9, vision=0.7),
    'brouillard': dict(label='Brouillard', icon='🌫️', fire=0.85, move=0.95, food=1.0, vision=0.45),
    'neige': dict(label='Neige', icon='❄️', fire=0.8, move=0.55, food=0.8, vision=0.8),
    'canicule': dict(label='Canicule', icon='🔥', fire=1.0, move=0.85, food=0.8, vision=1.0),
    'tempete': dict(label='Tempête', icon='🌬️', fire=0.7, move=0.8, food=0.95, vision=0.75),
}
WEATHER_W = {
    'printemps': dict(soleil=35, nuages=25, pluie=25, orage=5, brouillard=10),
    'été': dict(soleil=50, nuages=15, pluie=8, orage=12, canicule=15),
    'automne': dict(soleil=25, nuages=25, pluie=30, brouillard=15, tempete=5),
    'hiver': dict(soleil=15, nuages=30, pluie=25, brouillard=15, neige=15),
}
ZONES = {'cote': 'Côte atlantique', 'interieur': 'Intérieur', 'montagne': 'Pyrénées'}

MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

DIFFICULTY = {
    'facile': dict(label='Facile', ai_income=0.8, ai_aggr=0.75),
    'normal': dict(label='Normal', ai_income=1.0, ai_aggr=1.0),
    'difficile': dict(label='Difficile', ai_income=1.25, ai_aggr=1.25),
}
SPEEDS = [0, 0.5, 1.0, 2.0, 4.0, 10.0, 30.0]  # jours de jeu par seconde réelle (×10 et ×30 : années de paix)
FAST_SPEED = 5               # à partir de cette vitesse, guerres, batailles et propositions mettent le jeu en pause

# ------------------------------------------------------------------ grande campagne 1700-1899
CAMPAIGN_END = (1900, 1, 1)
DEPT_DATE = (1790, 3, 4)     # l'Assemblée crée les départements : les provinces deviennent départements
PROVINCES = {
    '33': dict(name='Guyenne', title='Guyenne (Bordelais)'),
    '24': dict(name='Périgord', title='Périgord'),
    '40': dict(name='Landes de Gascogne', title='Landes de Gascogne'),
    '47': dict(name='Agenais', title='Agenais'),
    '64': dict(name='Béarn et Pays basque', title='Béarn, Labourd et Soule'),
}
ERAS = [
    dict(id='louis14', year=1700, name='Le Grand Siècle finissant',
         desc='Louis XIV règne encore. Mousquets à mèche et à silex, derniers piquiers, places de Vauban.'),
    dict(id='lumieres', year=1715, name='Le siècle des Lumières',
         desc='Régence puis Louis XV et Louis XVI. Âge d’or du négoce bordelais, l’intendant Tourny embellit Bordeaux.'),
    dict(id='revolution', year=1789, name='La Révolution',
         desc='États généraux, départements, Garde nationale, levée en masse : la nation en armes.'),
    dict(id='empire', year=1804, name='Le Consulat et l’Empire',
         desc='Napoléon. Guerre d’Espagne : les Pyrénées redeviennent une frontière en armes.'),
    dict(id='restauration', year=1815, name='La Restauration',
         desc='Retour des Bourbons, puis monarchie de Juillet. Premières gabares à vapeur sur la Garonne.'),
    dict(id='second_empire', year=1848, name='La IIe République et le Second Empire',
         desc='Chemins de fer, télégraphe électrique, pins des Landes, Arcachon et Biarritz.'),
    dict(id='troisieme', year=1870, name='La IIIe République',
         desc='Guerre de 1870, armée moderne, phylloxéra dans les vignes.'),
]
SCENARIOS = {
    '1700': dict(date=(1700, 3, 1), title='Aquitaine, 1700', campaign='Grande campagne 1700 – 1899',
                 intro='Louis XIV règne. Cinq provinces du Sud-Ouest se disputent l’Aquitaine : traversez deux siècles, '
                       'de la Guerre de Succession d’Espagne à la IIIe République. Le plus prestigieux en 1900 l’emporte.',
                 techs_before=None),
    '1790': dict(date=(1790, 3, 4), title='Aquitaine, 1790', campaign='Depuis la Révolution',
                 intro='L’Assemblée vient de créer les départements. Choisissez le vôtre, ralliez ses villages, '
                       'puis prenez les chefs-lieux voisins par les armes, le commerce ou la diplomatie.',
                 techs_before=1778),
    '1813': dict(date=(1813, 6, 1), title='Aquitaine, 1813', campaign='La fin de l’Empire',
                 intro='L’Empire vacille, la guerre d’Espagne tourne mal : la frontière des Pyrénées s’embrase.',
                 techs_before=1806),
    '1870': dict(date=(1870, 7, 19), title='Aquitaine, 1870', campaign='La guerre de 1870',
                 intro='La France déclare la guerre à la Prusse. Chemins de fer et fusils Chassepot : '
                       'un autre siècle commence.', techs_before=1866),
}
# traités : un camp dont le chef-lieu tombe signe la paix au lieu de disparaître, sauf s'il est déjà écrasé
TREATY_TRUCE = 60            # trêve imposée par un traité (tours : cinq ans)
TREATY_CRUSHED = 0.25        # absorbé si ce camp ne tient plus que ce quart de ses places de départ (ou 3 places)
WEARY_PER_UNRULY = 0.08     # lassitude mensuelle par place conquise encore mal assimilée
REVIVE_YEARS = 10           # un pays absorbé peut se soulever après dix ans
WAR_PACE = 0.12             # appétit de guerre des IA (1 = celui de l'ancienne partie courte de 1790)
WAR_REST = 3.0              # années de paix avant que cet appétit soit entier
TREATY_CONGRESS = 24         # le congrès impose aussi la paix aux autres ennemis du vaincu (tours : deux ans)
TREATY_AGAIN = 25 * 365      # second traité avec le même vainqueur en moins de 25 ans : absorbé
# attachement régional : une place conquise reste fidèle à sa province d'origine pendant une génération
ASSIM_YEARS = 25
# lassitude de la guerre (0 à 100)
WEARY_PER_WAR = 3.0          # par mois et par guerre
WEARY_PER_LOSS = 1 / 150     # par homme perdu
WEARY_PEACE = 5.0            # baisse mensuelle en paix
STRIKE_STAB = 0.5            # syndicats : sous cet ordre public, une ville fait grève en janvier (un tour sans industrie)

# croissance séculaire de l'économie, par rapport à 1790 : la production d'une place n'en suit que la racine
POP_ERA = [(1700, 0.72), (1790, 1.0), (1850, 1.3), (1900, 1.6)]

# ------------------------------------------------------------------ population sur deux siècles
# Chaque place suit sa propre trajectoire « normale » : un multiplicateur de sa population de 1790
# (places.CITY_POP), interpolé entre des années repères. Chaque repère porte la raison de l'évolution jusqu'au
# repère suivant (affichée dans le panneau de la ville). Les villes s'envolent avec le chemin de fer et l'industrie ;
# les campagnes se remplissent jusque vers 1850 puis se vident (exode rural, émigration basque et béarnaise),
# sauf la lande plantée de pins après la loi de 1857.
POP_WHY = dict(
    paix='la paix et le commerce font grandir la ville',
    guerres='Révolution et guerres freinent la ville',
    ville='routes neuves et chemin de fer animent le marché',
    bourg='petite ville de marché, qui grandit lentement',
    declin='le marché languit, les jeunes partent pour la grande ville',
    iles='le commerce des Îles et du vin enrichit le port',
    revolution='Terreur et guerre sur mer ruinent le négoce',
    blocus='le blocus anglais étouffe le port',
    reprise='le négoce se relève lentement',
    metropole='chemins de fer, usines et faubourgs : tout le Sud-Ouest y afflue',
    prefecture='préfecture, routes neuves puis chemin de fer',
    ateliers='préfecture, puis ateliers du chemin de fer d’Orléans',
    hivernants='les hivernants anglais en font une ville d’hiver',
    port='le port et le chemin de fer d’Espagne',
    bains='les bains de mer attirent baigneurs et villas',
    imperiale='station impériale, puis rendez-vous de l’Europe',
    teste='résiniers et pêcheurs du Bassin',
    arcachon='Arcachon sort des dunes : ville d’hiver et bains de mer',
    ostreicole='huîtres et bains de mer font vivre le Bassin',
    terreneuve='la perte de Terre-Neuve ruine armateurs et pêcheurs',
    thermes='les eaux chaudes et le chemin de fer amènent les curistes',
    gare='carrefour du chemin de fer',
    frontiere='la gare frontière avec l’Espagne',
    forges='les forges et les hauts fourneaux embauchent',
    espadrilles='les fabriques d’espadrilles embauchent',
    banlieue='Bordeaux déborde : maraîchers et ouvriers s’y installent',
    defrichement='défrichements et maïs nourrissent plus de bouches',
    plein='les campagnes n’ont jamais été si peuplées',
    exode='l’exode rural vide les campagnes vers les villes',
    phylloxera='le phylloxéra ruine les vignerons',
    ameriques='on émigre vers les Amériques',
    lande='bergers et échassiers vivent chichement de la lande',
    pins='les pins et la résine font vivre la lande',
    remparts='les remparts ne font plus vivre la place',
)


def _town(e1850, e1900, late='ville'):
    """Ville ordinaire : croissance lente au XVIIIe siècle, pause sous la Révolution, puis le chemin de fer."""
    return [(1700, 0.82, 'paix'), (1790, 1.0, 'guerres'), (1801, 0.97, 'paix'), (1831, 1.07, late),
            (1851, e1850, late), (1900, e1900, late)]


def _rural(peak_year, peak, e1900, late, early='plein'):
    """Campagne : défrichements, apogée vers 1850, puis exode."""
    return [(1700, 0.81, 'defrichement'), (1790, 1.0, early), (peak_year, peak, late), (1900, e1900, late)]


POP_CURVES = dict(
    # Bordeaux : ~45 000 âmes en 1700, ~110 000 en 1790, ~91 000 en 1801, ~130 000 en 1851, ~256 000 en 1901
    bordeaux=[(1700, 0.41, 'iles'), (1750, 0.58, 'iles'), (1790, 1.0, 'revolution'), (1801, 0.83, 'blocus'),
              (1815, 0.84, 'reprise'), (1831, 0.92, 'metropole'), (1851, 1.18, 'metropole'), (1872, 1.76, 'metropole'),
              (1900, 2.3, 'metropole')],
    libourne=[(1700, 0.75, 'paix'), (1790, 1.0, 'guerres'), (1801, 0.95, 'ville'), (1851, 1.65, 'ville'), (1900, 2.3, 'ville')],
    # La Teste porte aussi Arcachon, détachée en 1857 : quelques cabanes de pêcheurs, puis la ville d'hiver des Pereire
    teste=[(1700, 0.85, 'teste'), (1790, 1.0, 'teste'), (1841, 1.25, 'bains'), (1857, 1.6, 'arcachon'),
           (1880, 3.4, 'arcachon'), (1900, 5.0, 'arcachon')],
    bassin=[(1700, 0.85, 'teste'), (1790, 1.0, 'teste'), (1857, 1.2, 'ostreicole'), (1900, 2.0, 'ostreicole')],
    soulac=[(1700, 0.9, 'lande'), (1790, 1.0, 'lande'), (1874, 1.05, 'bains'), (1900, 1.9, 'bains')],
    banlieue=[(1700, 0.8, 'defrichement'), (1790, 1.0, 'plein'), (1831, 1.15, 'banlieue'), (1851, 1.45, 'banlieue'),
              (1900, 3.0, 'banlieue')],
    perigueux=[(1700, 0.85, 'paix'), (1790, 1.0, 'guerres'), (1801, 0.95, 'ateliers'), (1831, 1.43, 'ateliers'),
               (1851, 2.2, 'ateliers'), (1872, 3.6, 'ateliers'), (1900, 5.2, 'ateliers')],
    bergerac=[(1700, 0.85, 'paix'), (1790, 1.0, 'guerres'), (1801, 0.97, 'ville'), (1851, 1.45, 'ville'), (1900, 1.95, 'ville')],
    montdemarsan=[(1700, 0.75, 'paix'), (1790, 1.0, 'prefecture'), (1851, 1.45, 'prefecture'), (1900, 3.0, 'prefecture')],
    dax=[(1700, 0.85, 'paix'), (1790, 1.0, 'guerres'), (1801, 0.97, 'thermes'), (1851, 1.3, 'thermes'), (1900, 2.35, 'thermes')],
    salies=[(1700, 0.9, 'paix'), (1790, 1.0, 'bourg'), (1857, 1.05, 'thermes'), (1900, 1.25, 'thermes')],
    gare=[(1700, 0.85, 'lande'), (1790, 1.0, 'lande'), (1854, 1.2, 'gare'), (1900, 3.0, 'gare')],
    agen=[(1700, 0.8, 'paix'), (1790, 1.0, 'guerres'), (1801, 0.97, 'prefecture'), (1851, 1.4, 'prefecture'),
          (1900, 2.1, 'prefecture')],
    villeneuve=[(1700, 0.82, 'paix'), (1790, 1.0, 'guerres'), (1801, 0.97, 'ville'), (1851, 1.35, 'ville'), (1900, 1.55, 'ville')],
    marmande=[(1700, 0.82, 'paix'), (1790, 1.0, 'guerres'), (1801, 0.97, 'ville'), (1851, 1.35, 'ville'), (1900, 1.6, 'ville')],
    forges=[(1700, 0.8, 'forges'), (1790, 1.0, 'forges'), (1851, 1.3, 'forges'), (1900, 1.6, 'forges')],
    # Pau : ~9 000 en 1790, ~16 000 en 1851, ~34 000 en 1901 (les Anglais y passent l'hiver dès les années 1840)
    pau=[(1700, 0.8, 'paix'), (1790, 1.0, 'guerres'), (1801, 0.95, 'prefecture'), (1836, 1.4, 'hivernants'),
         (1851, 1.8, 'hivernants'), (1872, 2.85, 'hivernants'), (1900, 3.8, 'hivernants')],
    bayonne=[(1700, 0.95, 'paix'), (1790, 1.0, 'guerres'), (1801, 0.97, 'port'), (1851, 1.45, 'port'), (1900, 2.05, 'port')],
    # Biarritz : village de pêcheurs (~2 000 âmes), plage de l'impératrice en 1854, ~12 000 habitants en 1901
    biarritz=[(1700, 0.8, 'terreneuve'), (1790, 1.0, 'bains'), (1854, 1.4, 'imperiale'), (1872, 2.6, 'imperiale'),
              (1900, 6.0, 'imperiale')],
    # Saint-Jean-de-Luz : grand port baleinier vers 1700, ruiné par le traité d'Utrecht et les tempêtes
    stjeandeluz=[(1700, 2.2, 'terreneuve'), (1750, 1.4, 'terreneuve'), (1790, 1.0, 'terreneuve'), (1851, 0.9, 'bains'),
                 (1900, 1.25, 'bains')],
    hendaye=[(1700, 0.9, 'bourg'), (1790, 1.0, 'bourg'), (1864, 1.4, 'frontiere'), (1900, 3.5, 'frontiere')],
    mauleon=[(1700, 0.9, 'bourg'), (1790, 1.0, 'bourg'), (1851, 1.4, 'espadrilles'), (1900, 2.8, 'espadrilles')],
    oloron=[(1700, 0.85, 'paix'), (1790, 1.0, 'guerres'), (1801, 0.97, 'ville'), (1851, 1.3, 'ville'), (1900, 1.4, 'ville')],
    # villes ordinaires, selon le pays (les petites villes du Périgord et de l'Agenais végètent après 1860)
    ville_33=_town(1.2, 1.45), ville_24=_town(1.15, 1.22, 'bourg'), ville_40=_town(1.25, 1.4),
    ville_47=_town(1.15, 1.1, 'declin'), ville_64=_town(1.15, 1.3),
    # campagnes : la Dordogne, l'Agenais et le Béarn se vident après 1850, le vignoble girondin souffre du phylloxéra
    rural_33=_rural(1875, 1.17, 1.05, 'phylloxera'), rural_24=_rural(1851, 1.2, 1.0, 'exode'),
    rural_40=_rural(1857, 1.25, 1.18, 'exode'), rural_47=_rural(1846, 1.12, 0.85, 'exode'),
    rural_64=_rural(1846, 1.18, 0.98, 'ameriques'),
    pins=[(1700, 0.85, 'lande'), (1790, 1.0, 'lande'), (1857, 1.15, 'pins'), (1900, 1.6, 'pins')],
    fort=[(1700, 1.05, 'remparts'), (1790, 1.0, 'remparts'), (1900, 0.92, 'remparts')],
)
# trajectoires particulières (les autres places suivent celle de leur type et de leur pays)
POP_PLACE = {
    'Bordeaux': 'bordeaux', 'Libourne': 'libourne', 'La Teste-de-Buch': 'teste', 'Soulac': 'soulac',
    'Gujan-Mestras': 'bassin', 'Andernos': 'bassin', 'Lanton': 'bassin', 'Lège': 'bassin', 'Biganos': 'bassin',
    'Mérignac': 'banlieue', 'Lormont': 'banlieue', "Villenave-d'Ornon": 'banlieue', 'Ambarès-et-Lagrave': 'banlieue',
    'Blanquefort': 'banlieue', 'Saint-Médard-en-Jalles': 'banlieue', 'Cestas': 'banlieue',
    'Belin': 'pins', 'Captieux': 'pins', 'Mios': 'pins', 'Salles': 'pins', 'Saint-Symphorien': 'pins',
    'Lacanau': 'pins', "Saint-Jean-d'Illac": 'pins', 'Houeillès': 'pins',
    'Périgueux': 'perigueux', 'Bergerac': 'bergerac', 'Mont-de-Marsan': 'montdemarsan', 'Dax': 'dax',
    'Morcenx': 'gare', 'Labouheyre': 'gare', 'Agen': 'agen', 'Villeneuve-sur-Lot': 'villeneuve', 'Marmande': 'marmande',
    'Fumel': 'forges', 'Pau': 'pau', 'Bayonne': 'bayonne', 'Biarritz': 'biarritz', 'Saint-Jean-de-Luz': 'stjeandeluz',
    'Hendaye': 'hendaye', 'Mauléon': 'mauleon', 'Oloron-Sainte-Marie': 'oloron', 'Salies-de-Béarn': 'salies',
}
POP_TREND_K = 0.25       # une place qui grandit plus vite que la moyenne produit un peu plus (racine quatrième)
POP_EXCESS = 0.05        # part de l'excédent qui s'en va chaque mois quand la place est trop pleine
POP_SIEGE = 0.02         # fuite mensuelle sous un siège, aggravée de 1 % par mois de siège (jusqu'à 5 %)
POP_FAMINE = 0.015       # fuite mensuelle quand le grenier est vide
POP_UNREST = 0.35        # sous cet ordre public, des habitants partent vers les places sûres…
POP_UNREST_RATE = 0.006  # … à ce rythme mensuel
POP_SACK = 0.06          # place prise de force : habitants tués ou en fuite…
POP_SACK_FORT = 0.025    # … davantage par niveau de remparts (on pille la ville qui a résisté)
POP_REFUGE = 0.5         # part des fuyards qui gagnent une place sûre de leur camp
POP_FLOOR = 0.5          # la disette et le désordre ne vident pas une place sous la moitié de sa normale…
POP_FLOOR_SIEGE = 0.3    # … un siège ou un sac, pas sous 30 % : il reste toujours des habitants
POP_RETURN = 0.02        # sous ce plancher, hors siège, les familles reviennent peu à peu (part du vide comblée par mois)
POP_SAFE_STAB = 0.6      # ordre public d'une place sûre, qui accueille les réfugiés


def pop_curve(gn):
    """Trajectoire de population d'un lieu (nœud de la carte)."""
    key = POP_PLACE.get(gn['name'])
    if key is None:
        typ, dept = gn['type'], gn['dept']
        if typ == 'fort':
            key = 'fort'
        elif typ == 'village':
            key = 'pins' if dept == '40' and ('bois' in gn['spec'] or 'fer' in gn['spec']) else f'rural_{dept}'
        else:
            key = f'ville_{dept}'
    return POP_CURVES[key]
# années à partir desquelles une technologie est connue (on ne recherche pas la machine à vapeur en 1700)
TECH_YEAR = dict(
    baionnette=1700, vauban=1700, tir_rang=1700, cuirassiers=1700, diplomates=1700, manufactures=1700, gabares=1700,
    mais=1700, foires=1700, transhumance=1700, haras=1700, ponts_chaussees=1716, hussards=1720, feu_peloton=1720,
    armureries=1720, hauts_fourneaux=1720, chais=1720, draperies=1710, gemmage=1740, genie=1748, fonderie=1750,
    gribeauval=1765, assolement=1760, fusil1777=1777, escompte=1776, poudreries=1775, ordre_mixte=1772,
    pomme_de_terre=1785, coke=1785, pins=1787, ponts=1770, gendarmerie=1791, levee=1793, chappe=1794, pieces=1790,
    voltigeurs=1795, ecoles=1795, divisions=1796, art_cheval=1792, larrey=1797, prefectures=1800, drainage=1800,
    greniers=1790, codecivil=1804, cadastre=1807, conserves=1810, vapeur=1820, engrais=1820, outillage=1830,
    canal=1838, poste=1700, valliere=1732, etat_major=1818, valee=1827, percussion=1840, minie=1849, lahitte=1858,
    chassepot=1866, mitrailleuse=1866, service_mil=1872, gras=1874, debange=1877, lebel=1886, canon75=1897,
    chemins_fer=1841, telegraphe=1850, ferry=1881, hygiene=1885, acier=1860, electricite=1882, engrais_chim=1850,
    landes1857=1857, greffe=1880,
    # SPEC-TECH.md : Fleurus 1794 ; tranchées de la guerre de Sécession, 1860 ; Nobel 1867 ; mélinite 1885 ; transport des
    # troupes par le rail (Italie) 1859 ; Jenner 1800 ; caisse d'épargne de Bordeaux 1819 ; gaz à Bordeaux vers 1830 ;
    # Daguerre 1839 ; suffrage 1848 ; décret sur les mutuelles 1852 ; Genève 1864 ; téléphone 1879 ; loi Waldeck-Rousseau
    # 1884 ; premier vapeur de la Garonne 1818 ; Vicat 1817 ; Cordouan 1823 ; Delessert 1812 ; Dombasle 1820 ;
    # moissonneuses en France vers 1855 ; Millardet 1885
    aerostiers=1794, retranchements=1860, dynamite=1867, melinite=1885, rail_militaire=1859, vaccine=1800,
    caisse_epargne=1819, gaz=1830, photographie=1839, suffrage=1848, mutuelles=1852, croix_rouge=1864, telephone=1879,
    syndicats=1884, vapeur_fluviale=1818, ciment=1817, fresnel=1823, betterave=1812, dombasle=1820, moissonneuses=1855,
    bouillie=1885)
# unités apparues en cours de route (la milice bourgeoise et les miquelets existent dès 1700 sous d'autres noms)
UNIT_YEAR = dict()

# ------------------------------------------------------------------ voies ferrées (SPEC-TECH.md, phase 2a)
# Lignes historiques, vérifiées le 19/10/2026 sur les articles « Ligne de… » de Wikipédia : (nom, villes de la carte
# dans l'ordre avec l'année où la ligne les atteint, sorties vers le bord [(ville, vers, direction)]). Chaque tronçon va
# d'une ville à la suivante, par la route la plus courte (game/rails.py) ; l'année ne sert qu'à l'ordre (les IA, le
# panneau) : un camp en avance construit plus tôt.
RAIL_LINES = [
    ('Bordeaux–La Teste', [('Bordeaux', 0), ('La Teste-de-Buch', 1841)], []),
    ('Paris–Bordeaux', [('Bordeaux', 0), ('Libourne', 1852), ('Coutras', 1852)], [('Coutras', 'Angoulême', 'N')]),
    ('Bordeaux–Bayonne', [('Bordeaux', 0), ('Morcenx', 1854), ('Dax', 1854), ('Bayonne', 1855)], []),
    ('Bordeaux–Sète', [('Bordeaux', 0), ('Langon', 1855), ('La Réole', 1855), ('Marmande', 1855), ('Tonneins', 1855),
                       ('Aiguillon', 1856), ('Agen', 1856)], [('Agen', 'Toulouse', 'E')]),
    ('Morcenx–Tarbes', [('Morcenx', 0), ('Mont-de-Marsan', 1857), ("Aire-sur-l'Adour", 1859)], [("Aire-sur-l'Adour", 'Tarbes', 'SE')]),
    ('Coutras–Périgueux', [('Coutras', 0), ('Montpon', 1857), ('Mussidan', 1857), ('Périgueux', 1857)], []),
    ('Périgueux–Brive', [('Périgueux', 0), ('Terrasson', 1860)], [('Terrasson', 'Brive', 'E')]),
    ('Périgueux–Limoges', [('Périgueux', 0), ('Thiviers', 1861)], [('Thiviers', 'Limoges', 'NE')]),
    ('Toulouse–Bayonne', [('Pau', 0), ('Orthez', 1863), ('Peyrehorade', 1864), ('Bayonne', 1864)], [('Pau', 'Tarbes', 'E')]),
    ('Puyoô–Dax', [('Orthez', 0), ('Dax', 1863)], []),
    ('Agen–Périgueux', [('Agen', 0), ('Fumel', 1863), ('Périgueux', 1863)], []),
    ('Bayonne–Irun', [('Bayonne', 0), ('Biarritz', 1864), ('Saint-Jean-de-Luz', 1864), ('Hendaye', 1864)], [('Hendaye', 'Irun', 'S')]),
    ('Langon–Bazas', [('Langon', 0), ('Bazas', 1866)], []),
    ('Penne–Villeneuve–Tonneins', [('Fumel', 0), ('Villeneuve-sur-Lot', 1869), ('Sainte-Livrade', 1894), ('Tonneins', 1894)], []),
    ('Médoc', [('Bordeaux', 0), ('Lesparre-Médoc', 1873)], []),
    ('Libourne–Le Buisson', [('Libourne', 0), ('Bergerac', 1875), ('Lalinde', 1879)], []),
    ('Port-Sainte-Marie–Condom', [('Aiguillon', 0), ('Nérac', 1880)], []),
    ('La Cave–Ribérac', [('Périgueux', 0), ('Ribérac', 1881)], []),
    ('Le Buisson–Sarlat', [('Lalinde', 0), ('Sarlat', 1882)], []),
    ('Pau–Oloron', [('Pau', 0), ('Oloron-Sainte-Marie', 1883)], []),
    ('Puyoô–Mauléon', [('Orthez', 0), ('Salies-de-Béarn', 1884), ('Mauléon', 1887)], []),
    ('Marmande–Angoulême', [('Marmande', 0), ('Miramont', 1886), ('Bergerac', 1886), ('Mussidan', 1888), ('Ribérac', 1890)], []),
    ('Saintes–Bordeaux', [('Bordeaux', 0), ('Saint-André-de-Cubzac', 1886)], [('Saint-André-de-Cubzac', 'Saintes', 'N')]),
    ('Saint-André–Blaye', [('Saint-André-de-Cubzac', 0), ('Blaye', 1889)], [('Blaye', 'Saint-Mariens', 'NE')]),
    ('Labouheyre–Mimizan', [('Morcenx', 0), ('Mimizan', 1889)], []),   # (par Labouheyre, sur Bordeaux–Bayonne : approché)
    ('Marmande–Mont-de-Marsan', [('Marmande', 0), ('Casteljaloux', 1891), ('Mont-de-Marsan', 1893)], []),
    ('Thiviers–Nontron', [('Thiviers', 0), ('Nontron', 1892)], [('Nontron', 'Angoulême', 'N')]),
    ('Nérac–Mont-de-Marsan', [('Nérac', 0), ('Mont-de-Marsan', 1897)], []),
    ('Dax–Mont-de-Marsan', [('Mont-de-Marsan', 0), ('Saint-Sever', 1891), ('Dax', 1899)], []),
]
RAIL_KM_COST = dict(livres=30, fer=8, bois=6)   # prix d'un km de voie
RAIL_KM_DAYS = 4.0          # jours de travail par km, à industrie moyenne (× 0,5 à 2 selon l'industrie du camp)
RAIL_SPEED = 130.0          # km par jour en train (chemins de fer militaires)
RAIL_EMBARK = 1.0           # jours pour embarquer en gare
RAIL_TOWN_BONUS = 0.05      # industrie et commerce d'une ville desservie, par tronçon…
RAIL_TOWN_MAX = 0.15        # … jusqu'à ce plafond
RAIL_STATION_KM = 30.0      # une armée à moins de cette distance d'une gare de son camp s'use moins vite…
RAIL_STATION_DRAIN = -0.30  # … de tant
RAIL_CUT_TOURS = 3          # tours pendant lesquels un tronçon coupé ne sert à personne

# ------------------------------------------------------------------ armement
# Chaque régiment garde les armes reçues à sa levée ; il faut le réarmer pour profiter d'un nouveau fusil.
# (technologie, nom, multiplicateur de puissance)
ARMS = {
    'inf': [(None, 'mousquet et piques', 0.85), ('baionnette', 'fusil à silex', 1.0), ('fusil1777', 'fusil 1777', 1.10),
            ('percussion', 'fusil à percussion', 1.22), ('minie', 'fusil rayé', 1.40), ('chassepot', 'Chassepot', 1.70),
            ('gras', 'fusil Gras', 1.82), ('lebel', 'Lebel', 2.05)],
    'artillerie': [(None, 'canons de bronze', 0.85), ('valliere', 'système Vallière', 0.95), ('gribeauval', 'Gribeauval', 1.15),
                   ('valee', 'système Valée', 1.30), ('lahitte', 'canons rayés', 1.55), ('debange', 'de Bange', 1.85),
                   ('canon75', 'canon de 75', 2.30)],
}
REARM = dict(inf=dict(armes=0.12), artillerie=dict(armes=0.25, fer=0.25))   # par homme du régiment
# noms des troupes selon l'époque : (année de début, technologie requise ou None, nom, nom court)
UNIT_NAMES = {
    'ligne': [(1700, None, 'Mousquetaires et piquiers', 'Piquiers'), (1700, 'baionnette', 'Infanterie de ligne', 'Ligne')],
    'legere': [(1700, None, 'Troupes légères (fusiliers, arquebusiers)', 'Légère'),
               (1700, 'voltigeurs', 'Infanterie légère (voltigeurs)', 'Légère'), (1838, None, 'Chasseurs à pied', 'Chass. à pied')],
    'cavalerie': [(1700, None, 'Cavalerie (dragons, chevau-légers)', 'Cavalerie'), (1700, 'hussards', 'Cavalerie (dragons, hussards)', 'Cavalerie'),
                  (1800, 'cuirassiers', 'Cavalerie (cuirassiers, dragons, hussards)', 'Cavalerie'),
                  (1871, None, 'Cavalerie (dragons, chasseurs à cheval)', 'Cavalerie')],
    'chasseurs': [(1700, None, 'Miquelets (fusiliers de montagne)', 'Miquelets'), (1792, None, 'Chasseurs basques (montagnards)', 'Chasseurs')],
    'garde': [(1700, None, 'Milice bourgeoise', 'Milice b.'), (1789, None, 'Garde nationale', 'Garde nat.'),
              (1872, None, 'Armée territoriale', 'Territoriale')],
}

# ------------------------------------------------------------------ généraux
GENERAL_TRAITS = {
    'audacieux': dict(label='Audacieux', desc='Frappe plus fort en attaque (+12 %), mais s’expose davantage.'),
    'prudent': dict(label='Prudent', desc='Pertes réduites en défense (−12 %), retraites deux fois moins coûteuses.'),
    'cavalier': dict(label='Cavalier', desc='Cavalerie +20 %, l’armée marche 10 % plus vite.'),
    'artilleur': dict(label='Artilleur', desc='Artillerie +25 %, sièges 40 % plus rapides.'),
    'montagnard': dict(label='Montagnard', desc='+15 % au combat et marche facilitée en collines et montagne.'),
    'eclaireur': dict(label='Éclaireur', desc='Embuscades +25 %, voltigeurs +10 %, repère les ennemis cachés de plus loin.'),
    'inspirant': dict(label='Inspirant', desc='Moral de départ +10, pertes de moral −15 %.'),
    'logisticien': dict(label='Logisticien', desc='Ravitaillement deux fois plus durable, usure −40 %.'),
}
GENERAL_RANKS = ['Colonel', 'Général de brigade', 'Général de division']
# trait plus fréquent selon le département
GENERAL_FAVORITE = {'33': 'logisticien', '24': 'artilleur', '40': 'eclaireur', '47': 'prudent', '64': 'montagnard'}
SURNAMES = ['Labat', 'Dufau', 'Lacoste', 'Darricau', 'Etcheverry', 'Bordenave', 'Lafargue', 'Larrieu', 'Castaing', 'Duprat',
            'Garat', 'Lassalle', 'Fourcade', 'Peyrot', 'Ducasse', 'Lamothe', 'Delbos', 'Chastang', 'Vergnaud', 'Darriet',
            'Lagarde', 'Lalanne', 'Bernadet', 'Cazenave', 'Mondiet', 'Puyo', 'Sallenave', 'Hiriart', 'Iribarne', 'Larrouy',
            'Faget', 'Lartigue', 'Daguerre', 'Barrère', 'Courrèges', 'Lacaze', 'Saint-Martin', 'Doumecq', 'Laborde', 'Pédelaborde',
            'Mauriac', 'Lafon', 'Delpech', 'Marty', 'Roumégoux', 'Sudre', 'Bouyssou', 'Vialle', 'Escande', 'Fabre']

# ------------------------------------------------------------------ tactique
FORMATIONS = {
    'ligne': dict(label='Ligne', desc='Infanterie déployée : feu nourri (+20 %), mais vulnérable aux charges de cavalerie.'),
    'colonne': dict(label='Colonne', desc='Colonnes d’attaque : choc à la charge (+25 %), marche plus rapide, cible facile pour les canons.'),
    'carre': dict(label='Carré', desc='Repousse la cavalerie (−65 % de dégâts), mais l’artillerie y fait des ravages ; marche lente. Le former prend un moment : surprise pendant la manœuvre, l’infanterie est très exposée aux cavaliers.'),
    'tirailleurs': dict(label='Tirailleurs', desc='Ordre dispersé : moins exposé aux canons, efficace à couvert, fragile face aux cavaliers.'),
}
PLANS = {
    'frontal': dict(label='Assaut frontal', desc='Engagement classique, toutes armes ensemble.'),
    'artillerie': dict(label='Préparation d’artillerie', desc='Les canons pilonnent d’abord (+40 %) pendant que l’infanterie s’abrite.'),
    'debordement': dict(label='Débordement', desc='La cavalerie tourne l’ennemi (+50 % en terrain ouvert), le centre est plus léger.'),
    'tenir': dict(label='Tenir la position', desc='Défense acharnée : pertes −20 %, moral plus solide, mais moins d’attaque.'),
    'harcelement': dict(label='Harcèlement', desc='Escarmouches : pertes réduites des deux côtés, on décroche au bout d’un jour.'),
}
FORMATION_SPEED = {'ligne': 1.0, 'colonne': 1.1, 'carre': 0.6, 'tirailleurs': 0.95}
PHASES = {'canonnade': 'Canonnade', 'fusillade': 'Fusillade', 'charge': 'Charge'}
# poids de chaque arme selon la phase
PHASE_W = {
    'canonnade': dict(artillerie=1.0, inf=0.35, cavalerie=0.1),
    'fusillade': dict(artillerie=0.8, inf=1.0, cavalerie=0.45),
    'charge': dict(artillerie=0.5, inf=1.0, cavalerie=1.25),
}
OPEN_TERRAIN = ('Plaine', 'Vignoble', 'Lande', 'Collines')
# résolution automatique (engine.update_battles, end_battle), recalée sur les batailles jouées sur le champ de bataille
# (banc apparié : même bataille résolue des deux façons). Comme l'IA des batailles commandées, un camp dominé cède avant
# la déroute. Hors d'une place, passé WD_LOSS de pertes (part de ses hommes) face à un ennemi plus fort (sa puissance
# sous WD_RATIO fois celle de l'ennemi), ou WD_EVEN_LOSS face à un ennemi à peine plus fort, il décroche en bon ordre.
# Le défenseur d'une place ne décroche pas : dominé, passé WD_PLACE_LOSS, il la rend. Dans ce compte, le défenseur tient
# comme s'il était WD_DEF fois plus fort (le défenseur des batailles commandées a l'avantage du terrain).
WD_LOSS, WD_RATIO, WD_EVEN_LOSS, WD_PLACE_LOSS = 0.12, 0.8, 0.19, 0.2
WD_DEF = 1.4
# poursuite d'un vaincu rompu (part de ses hommes rattrapés, selon que le vainqueur a de la cavalerie ou non) : une armée
# presque anéantie, ou celle qui défendait une place prise ; prisonniers : part des pertes au combat du vaincu (à
# l'assaut d'une place, pris ou repoussé : PRISON_ASSAULT) et des rattrapés
PURSUIT_CAV, PURSUIT_FOOT = 0.05, 0.02
PRISON_LOSS, PRISON_ASSAULT, PRISON_CAUGHT = 0.07, 0.2, 0.15
# usure : le vaincu, même en bon ordre, perd cette part de ses hommes en traînards pendant la retraite (désertions)
LOSER_STRAGGLE = 0.05

# ------------------------------------------------------------------ espions, impôts, fleuves
SPY = {
    'espionner': dict(label='Espionner', cost=60, chance=0.8,
                      desc='Révèle la garnison et les environs (14 km) pendant deux tours.'),
    'saboter': dict(label='Saboter les remparts', cost=150, chance=0.5,
                    desc='En guerre seulement : fait perdre un niveau de fortification à la place.'),
}
SPY_INTEL_TOURS = 2   # un rapport d'espion vaut pour deux tours
WATER_SPEED = 30  # km par jour en gabare (avant courant et météo)
SEA_SPEED = 55  # cabotage le long de la côte (les tempêtes immobilisent les navires)
EMBARK_DAYS = 0.35  # chargement des gabares (hommes, chevaux, canons)
DISEMBARK_DAYS = 0.15
RIVER_FIRE_KM = 3.0  # portée des canons sur les berges
QUAI_LIVRES = 0.5  # commerce fluvial d'un quai (par jour)
BLOCKADE_K = 0.35  # revenus portuaires et fluviaux sous blocus
TAX_LABELS = [(0.15, 'Très légers'), (0.4, 'Légers'), (0.6, 'Normaux'), (0.85, 'Lourds'), (1.01, 'Écrasants')]


def tax_label(v):
    for lim, lab in TAX_LABELS:
        if v < lim:
            return lab
    return TAX_LABELS[-1][1]
