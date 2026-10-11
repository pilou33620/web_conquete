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
UNIT_ORDER = ['ligne', 'legere', 'grenadiers', 'chasseurs', 'cavalerie', 'artillerie', 'sapeurs', 'garde']
UNIT_CLS = {'cavalerie': 'cavalerie', 'artillerie': 'artillerie'}   # tout le reste est de l'infanterie
LIGHT_UNITS = ('legere', 'chasseurs')
READY = {'grenadiers': 'prêts', 'chasseurs': 'prêts', 'sapeurs': 'prêts'}   # les autres noms sont féminins
for _k, _u in UNITS.items():
    _u.setdefault('ready', READY.get(_k, 'prête'))
    _u.setdefault('cls', UNIT_CLS.get(_k, 'inf'))
    _u.setdefault('light', _k in LIGHT_UNITS)
    _u.setdefault('garrison_only', False)
    _u.setdefault('req', None)
    _u.setdefault('desc', '')
UNITS['ligne']['desc'] = 'Le gros de l’armée : feu de ligne, colonne d’assaut ou carré.'
UNITS['legere']['desc'] = 'Voltigeurs : rapides, à l’aise en forêt, en lande et en marais, tendent des embuscades.'
UNITS['cavalerie']['desc'] = 'Dragons et hussards : charge en terrain ouvert, poursuite, éclairage.'
UNITS['artillerie']['desc'] = 'Batterie de 8 pièces : domine la canonnade et ouvre les brèches.'
# Population : chaque agrandissement ouvre de la place (+30 %), que les habitants remplissent mois après mois
# si la ville est sûre, nourrie et pas trop imposée. La production suit la population.
POP_NATURAL = 0.05           # croissance possible sans agrandissement
POP_PER_LEVEL = 0.30         # place gagnée à chaque agrandissement
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
PROPOSAL_DAYS = 40           # durée de validité d'une proposition reçue


def de(nom):
    """« de » élidé devant une voyelle ou un h muet : d'Agen, d'avril, de Bordeaux."""
    return f"d'{nom}" if nom[:1].lower() in 'aeiouyhâàéèêîïôöûü' else f"de {nom}"


def num(x, dec=1):
    """Nombre à la française : virgule décimale, signe moins typographique."""
    s = f"{abs(x):.{dec}f}".replace('.', ',')
    return ('−' if x < 0 else '+') + s


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
                desc='Nouveaux faubourgs : la ville peut accueillir 30 % d’habitants de plus, qui viennent s’y installer '
                     'peu à peu ; plus de monde, c’est plus de production, de recrues et de milice'),
}

# ------------------------------------------------------------------ technologies
TECHS = [
    # id, branche, nom, description, coût, jours, prérequis, effets
    ('baionnette', 'militaire', 'Baïonnette à douille', "Inventée à Bayonne : l'infanterie tient au corps à corps.", 375, 28, [], dict(inf_power=0.10)),
    ('fusil1777', 'militaire', 'Fusil modèle 1777', 'Platine fiable, tir plus nourri. Ligne −10 % armes.', 750, 42, ['baionnette'], dict(inf_power=0.12, ligne_armes=-0.10)),
    ('gribeauval', 'militaire', 'Système Gribeauval', 'Canons standardisés et légers : artillerie +25 %, plus rapide.', 875, 49, [], dict(art_power=0.25, art_speed=0.25)),
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
    ('gabares', 'industriel', 'Chantiers de gabares', 'Gabares et couraux plus grands : transport fluvial +15 %, ports +10 %.', 625, 35, [], dict(river_speed=0.15, port=0.10)),

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
    ('conserves', 'agricole', 'Conserves d’Appert', 'Vivres en bocaux : les armées s’épuisent 40 % moins vite loin de chez elles.', 1000, 56, ['pomme_de_terre'], dict(supply_drain=-0.40)),
]
TECH = {t[0]: dict(id=t[0], branch=t[1], name=t[2], desc=t[3], cost=t[4], days=t[5], req=t[6], fx=t[7]) for t in TECHS}
BRANCHES = ['militaire', 'civil', 'industriel', 'agricole']

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
SPEEDS = [0, 0.5, 1.0, 2.0, 4.0]  # jours de jeu par seconde réelle

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

# ------------------------------------------------------------------ espions, impôts, fleuves
SPY = {
    'espionner': dict(label='Espionner', cost=60, days=2, chance=0.8,
                      desc='Révèle la garnison et les environs (14 km) pendant 45 jours.'),
    'saboter': dict(label='Saboter les remparts', cost=150, days=3, chance=0.5,
                    desc='En guerre seulement : fait perdre un niveau de fortification à la place.'),
}
SPY_INTEL_DAYS = 45
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
