"""Événements historiques datés (1701-1898) et événements aléatoires, avec leurs choix.

Chaque événement touche un ou plusieurs camps. Le joueur choisit dans une fenêtre (le jeu se met en pause) ;
sans réponse au bout de 30 jours, la dernière option, la plus prudente, s'applique. L'IA choisit aussitôt.

Effets (dictionnaire fx) :
  res       {ressource: quantité}            ajout (ou retrait) immédiat
  res_pct   {ressource: fraction}            −0,35 = un tiers des réserves perdu
  stab      fraction                         ordre public de toutes vos places
  weary     points                           lassitude de la guerre
  glory     points                           « Histoire » dans le prestige
  pop       fraction                         population de toutes vos places
  town_pop / town_stab                       la ville touchée seulement (événements aléatoires)
  ville     {nid, pop, stab, tm, add…}       événement local d'une place (voir cities.py)
  tmod      {modificateur: valeur}, days     effet temporaire (en jours)
  pmod      {modificateur: valeur}           effet durable
  rel       points                           ce que les autres camps pensent de vous
  regs      [[type, nombre]]                 régiments offerts, en garnison au chef-lieu
  research  1                                recherches en cours avancées de moitié
"""
import datetime

from . import rules as R

ALL = None
ANSWER_DAYS = 30
RANDOM_GAP = (240, 540)   # jours entre deux événements aléatoires pour un même camp

# (clé, nom) des modificateurs qui peuvent apparaître dans un effet
MOD_LABEL = dict(livres='revenus en livres', vivres='vivres', fer='fer', bois='bois', recrues='recrues', port='ports',
                 trade='commerce', vin='revenus du vin', lande_prod='landes et marais', road_speed='vitesse sur route',
                 morale='moral', research_speed='recherche', order='ordre public', industrie='industrie',
                 terroir='produits du terroir', market='prix au marché')
ABS_MODS = {'morale'}

# ------------------------------------------------------------------ événements datés
HIST = [
    dict(id='succession', date=(1701, 4, 1), who=ALL, title="La guerre de Succession d'Espagne",
         text="Louis XIV soutient son petit-fils Philippe V sur le trône d'Espagne ; l'Europe se ligue contre lui. "
              "L'intendant réclame des hommes et de l'argent à {chef}.",
         choices=[dict(label='Lever des régiments pour le roi', fx=dict(res=dict(recrues=-300, livres=-150), glory=8), ai=1),
                  dict(label='Payer le « don gratuit »', fx=dict(res=dict(livres=-350), glory=4), ai=2),
                  dict(label='Faire traîner les choses', fx=dict(stab=-0.06, glory=-2), ai=1)]),
    dict(id='grand_hiver', date=(1709, 1, 6), who=ALL, title='Le Grand Hiver',
         text="Le froid fend les arbres, gèle la Garonne et tue les semences. La famine menace autour {de_chef}.",
         base=dict(res_pct=dict(vivres=-0.35)),
         choices=[dict(label='Ouvrir les greniers aux pauvres', fx=dict(res_pct=dict(vivres=-0.2), stab=0.08, glory=4), ai=2),
                  dict(label="Acheter du blé à prix d'or", fx=dict(res=dict(livres=-400, vivres=350)), ai=2),
                  dict(label='Laisser faire le marché', fx=dict(stab=-0.12, pop=-0.05), ai=1)]),
    dict(id='regence', date=(1715, 9, 2), who=ALL, title='La mort du Roi-Soleil',
         text="Louis XIV s'éteint après soixante-douze ans de règne. Sous la Régence, l'étau se desserre.",
         choices=[dict(label='Fêter le nouveau règne', fx=dict(res=dict(livres=-200), stab=0.06), ai=1),
                  dict(label='Profiter du relâchement pour réduire les dépenses', fx=dict(res=dict(livres=250), stab=-0.03), ai=1)]),
    dict(id='law', date=(1720, 7, 17), who=ALL, title='La banqueroute de Law',
         text="Le Système de Law s'effondre : les billets de la Banque royale ne valent plus rien, "
              "et les négociants {de_chef} crient à la ruine.",
         base=dict(res_pct=dict(livres=-0.15)),
         choices=[dict(label='Rembourser les porteurs de billets', fx=dict(res=dict(livres=-300), stab=0.08, glory=3), ai=1),
                  dict(label='Laisser les spéculateurs à leur ruine', fx=dict(stab=-0.08, tmod=dict(trade=-0.1), days=3 * 365), ai=1)]),
    dict(id='tourny', date=(1743, 8, 1), who=('33',), title="L'intendant Tourny",
         text="Aubert de Tourny veut abattre les vieux remparts de Bordeaux et tracer des allées, des places et des façades "
              "dignes d'une capitale.",
         choices=[dict(label='Lancer les grands travaux', fx=dict(res=dict(livres=-700), glory=10, pmod=dict(livres=0.05), stab=0.03), ai=2),
                  dict(label="Garder l'argent pour les régiments", fx=dict(), ai=1)]),
    dict(id='fors', date=(1748, 5, 1), who=('64',), title='Les fors du Béarn',
         text="Les États de Béarn défendent leurs fors et leurs libertés contre les intendants de Versailles.",
         choices=[dict(label='Défendre les fors', fx=dict(res=dict(livres=-150), stab=0.08, glory=3), ai=2),
                  dict(label="S'aligner sur Versailles", fx=dict(res=dict(livres=300), stab=-0.08), ai=1)]),
    dict(id='sept_ans', date=(1756, 6, 1), who=ALL, title='La guerre de Sept Ans',
         text="La guerre reprend contre l'Angleterre. La Royal Navy bloque les côtes ; à Bayonne et à Bordeaux, "
              "on arme des corsaires.",
         choices=[dict(label='Armer des corsaires', fx=dict(res=dict(livres=400), weary=5, glory=3, tmod=dict(port=-0.2), days=7 * 365), ai=2),
                  dict(label='Commercer prudemment', fx=dict(tmod=dict(port=-0.3), days=7 * 365), ai=1)]),
    dict(id='maupeou', date=(1771, 2, 1), who=('33', '24', '47'), title='La réforme Maupeou',
         text="Le chancelier Maupeou brise les parlements : celui de Bordeaux est exilé, remplacé par un Conseil supérieur.",
         choices=[dict(label='Soutenir les parlementaires', fx=dict(res=dict(livres=-200), stab=0.05, glory=2), ai=1),
                  dict(label='Accueillir le Conseil supérieur', fx=dict(res=dict(livres=200), stab=-0.06), ai=1)]),
    dict(id='farines', date=(1775, 5, 1), who=ALL, title='La guerre des farines',
         text="Turgot libère le commerce des grains : le pain renchérit et des émeutes éclatent sur les marchés.",
         choices=[dict(label='Taxer le prix du pain', fx=dict(res=dict(livres=-250), stab=0.06), ai=2),
                  dict(label='Laisser le commerce libre', fx=dict(stab=-0.08, tmod=dict(trade=0.1), days=5 * 365), ai=1)]),
    dict(id='amerique', date=(1778, 3, 1), who=ALL, title="L'indépendance américaine",
         text="La France s'allie aux Insurgents. La Fayette a appareillé du port de Pasajes ; les armateurs "
              "arment pour les Antilles et l'Amérique.",
         choices=[dict(label="Armer des navires pour l'Amérique", fx=dict(res=dict(livres=-300), glory=6, tmod=dict(port=0.15), days=5 * 365), ai=1),
                  dict(label="S'en tenir à ses affaires", fx=dict(), ai=1)]),
    dict(id='doleances', date=(1789, 3, 1), who=ALL, title='Les cahiers de doléances',
         text="Le roi convoque les États généraux. Dans chaque paroisse, on rédige les doléances du peuple.",
         choices=[dict(label='Écouter le tiers état', fx=dict(res=dict(livres=-200), stab=0.08, glory=5), ai=2),
                  dict(label='Défendre les privilèges', fx=dict(res=dict(livres=250), stab=-0.12), ai=1)]),
    dict(id='grande_peur', date=(1789, 7, 25), who=ALL, title='La Grande Peur',
         text="Des rumeurs de brigands affolent les campagnes ; on brûle les terriers et l'on assiège les châteaux.",
         base=dict(stab=-0.08),
         choices=[dict(label='Armer une milice citoyenne', fx=dict(res=dict(livres=-100), regs=[['garde', 2]]), ai=2),
                  dict(label="Laisser passer l'orage", fx=dict(stab=-0.05), ai=1)]),
    dict(id='girondins', date=(1793, 6, 2), who=('33',), title='La chute des Girondins',
         text="Vergniaud, Guadet, Gensonné… les députés de la Gironde sont arrêtés à Paris. Bordeaux s'insurge "
              "contre la Montagne.",
         choices=[dict(label='Lever une armée fédéraliste', fx=dict(regs=[['ligne', 1]], glory=6, stab=0.05, rel=-10), ai=1),
                  dict(label='Se soumettre à la Montagne', fx=dict(stab=-0.1), ai=1)]),
    dict(id='levee_masse', date=(1793, 8, 23), who=ALL, title='La levée en masse',
         text="La Convention réquisitionne tous les Français de 18 à 25 ans : « Les jeunes gens iront au combat. »",
         choices=[dict(label='Appliquer le décret', fx=dict(res=dict(recrues=1500), weary=8, stab=-0.05), ai=2),
                  dict(label='Accorder des exemptions', fx=dict(res=dict(recrues=500), stab=0.03), ai=1)]),
    dict(id='sacre', date=(1804, 12, 2), who=ALL, title='Le sacre de Napoléon',
         text="À Notre-Dame, Napoléon pose lui-même la couronne sur sa tête. Les notables {de_chef} sont invités.",
         choices=[dict(label='Envoyer une délégation au sacre', fx=dict(res=dict(livres=-300), glory=5, stab=0.04), ai=2),
                  dict(label='Rester réservé', fx=dict(stab=-0.02), ai=1)]),
    dict(id='blocus', date=(1806, 11, 21), who=ALL, title='Le Blocus continental',
         text="Napoléon ferme les ports de l'Europe à l'Angleterre. Le négoce maritime s'effondre, les navires pourrissent "
              "à quai.", base=dict(tmod=dict(port=-0.4), days=7 * 365),
         choices=[dict(label='Fermer les yeux sur la contrebande', fx=dict(res=dict(livres=300), stab=-0.05), ai=2),
                  dict(label='Faire respecter le blocus', fx=dict(glory=3), ai=1)]),
    dict(id='espagne', date=(1808, 5, 2), who=('64', '40'), title="La guerre d'Espagne",
         text="Les armées impériales passent par Bayonne pour gagner Madrid ; l'Espagne se soulève contre l'occupant.",
         choices=[dict(label='Fournir convois et étapes', fx=dict(res=dict(vivres=-300, livres=250)), ai=2),
                  dict(label='Garder les vivres pour soi', fx=dict(stab=0.03, rel=-5), ai=1)]),
    dict(id='douze_mars', date=(1814, 3, 12), who=('33',), title='Le 12 mars 1814',
         text="Le maire Lynch ouvre Bordeaux aux Anglais de Beresford et arbore la cocarde blanche : la première ville "
              "de France à rappeler les Bourbons.",
         choices=[dict(label='Se rallier aux Bourbons', fx=dict(glory=5, stab=0.05), ai=2),
                  dict(label="Rester fidèle à l'Empereur", fx=dict(stab=-0.05, tmod=dict(morale=5), days=365), ai=1)]),
    dict(id='cent_jours', date=(1815, 3, 20), who=ALL, title='Les Cent-Jours',
         text="Napoléon revient de l'île d'Elbe et marche sur Paris. La duchesse d'Angoulême tente de tenir Bordeaux "
              "pour le roi.",
         choices=[dict(label="Suivre l'Empereur", fx=dict(res=dict(recrues=400), weary=5), ai=1),
                  dict(label='Rester fidèle au roi', fx=dict(stab=0.04), ai=1)]),
    dict(id='glorieuses', date=(1830, 7, 29), who=ALL, title='Les Trois Glorieuses',
         text="Paris se couvre de barricades ; Charles X abdique et Louis-Philippe devient roi des Français.",
         choices=[dict(label='Arborer le drapeau tricolore', fx=dict(stab=0.03, glory=2), ai=2),
                  dict(label='Soutenir Charles X', fx=dict(stab=-0.06), ai=1)]),
    dict(id='cholera', date=(1832, 4, 1), who=ALL, title='Le choléra',
         text="Le choléra venu d'Asie frappe la France. Les quartiers pauvres {de_chef} se vident.",
         base=dict(pop=-0.03),
         choices=[dict(label='Lazarets et quarantaines', fx=dict(res=dict(livres=-300), stab=0.04), ai=2),
                  dict(label='Ne rien faire', fx=dict(pop=-0.04, stab=-0.05), ai=1)]),
    dict(id='la_teste', date=(1841, 7, 6), who=('33',), title='Le chemin de fer de La Teste',
         text="Le premier train relie Bordeaux à La Teste. Les frères Pereire cherchent des actionnaires.",
         choices=[dict(label='Investir dans la compagnie', fx=dict(res=dict(livres=-500), glory=3, pmod=dict(road_speed=0.08)), ai=2),
                  dict(label='Laisser faire les banquiers', fx=dict(), ai=1)]),
    dict(id='rev1848', date=(1848, 2, 24), who=ALL, title='La révolution de 1848',
         text="Louis-Philippe abdique. La IIe République proclame le suffrage universel et l'abolition de l'esclavage.",
         choices=[dict(label='Ouvrir des ateliers nationaux', fx=dict(res=dict(livres=-400), stab=0.08, glory=2), ai=1),
                  dict(label="Rétablir l'ordre", fx=dict(stab=-0.05), ai=1)]),
    dict(id='biarritz', date=(1854, 7, 1), who=('64',), title='Biarritz impériale',
         text="L'impératrice Eugénie fait de Biarritz la plage à la mode ; la villa Eugénie sort des dunes.",
         choices=[dict(label='Accueillir la cour', fx=dict(res=dict(livres=-300), glory=4, pmod=dict(livres=0.06)), ai=2),
                  dict(label='Laisser les baigneurs à leurs vagues', fx=dict(), ai=1)]),
    dict(id='classement', date=(1855, 4, 18), who=('33',), title='Le classement de 1855',
         text="Pour l'Exposition universelle, les courtiers classent les grands crus du Médoc et de Sauternes.",
         base=dict(pmod=dict(vin=0.2)),
         choices=[dict(label='Donner une grande fête', fx=dict(res=dict(livres=-200), glory=5), ai=1),
                  dict(label='Placer les profits', fx=dict(res=dict(livres=300)), ai=1)]),
    dict(id='landes1857', date=(1857, 6, 19), who=('40',), title="La loi d'assainissement des Landes",
         text="Napoléon III ordonne aux communes de drainer la lande et d'y semer des pins.",
         choices=[dict(label='Planter des pins partout', fx=dict(res=dict(livres=-400), glory=4, pmod=dict(lande_prod=0.25, bois=0.15)), ai=2),
                  dict(label='Garder les parcours des bergers', fx=dict(stab=0.05), ai=1)]),
    dict(id='guerre1870', date=(1870, 7, 19), who=ALL, title='La guerre franco-prussienne',
         text="La France déclare la guerre à la Prusse. On lève les gardes mobiles pour l'armée de la Loire.",
         choices=[dict(label='Lever les gardes mobiles', fx=dict(res=dict(recrues=1000), weary=10, glory=4), ai=2),
                  dict(label='Garder ses hommes', fx=dict(stab=-0.05), ai=1)]),
    dict(id='delegation', date=(1870, 12, 10), who=('33',), title='Le gouvernement à Bordeaux',
         text="La Délégation quitte Tours : Gambetta gouverne la France depuis Bordeaux, puis l'Assemblée y siège "
              "au Grand-Théâtre.", base=dict(glory=6),
         choices=[dict(label="Accueillir l'Assemblée", fx=dict(res=dict(livres=-200), stab=0.05), ai=2),
                  dict(label="Laisser l'État payer", fx=dict(), ai=1)]),
    dict(id='commune', date=(1871, 3, 18), who=ALL, title='La Commune',
         text="Paris se soulève contre l'Assemblée réfugiée à Versailles.",
         choices=[dict(label='Envoyer des troupes à Versailles', fx=dict(weary=5, stab=0.03), ai=1),
                  dict(label='Prêcher la conciliation', fx=dict(stab=-0.03, glory=2), ai=1)]),
    dict(id='phylloxera', date=(1875, 6, 1), who=ALL, title='Le phylloxéra',
         text="Un puceron venu d'Amérique dévore les racines des vignes. Les vignobles meurent les uns après les autres.",
         base=dict(tmod=dict(vin=-0.5), days=12 * 365),
         choices=[dict(label='Arracher et replanter en plants américains', fx=dict(res=dict(livres=-500), tmod=dict(vin=0.3), days=12 * 365), ai=2),
                  dict(label='Sulfure de carbone et prières', fx=dict(stab=-0.05), ai=1)]),
    dict(id='expo1889', date=(1889, 5, 6), who=ALL, title="L'Exposition universelle de 1889",
         text="La tour de M. Eiffel domine le Champ-de-Mars. Chaque région y montre ce qu'elle a de meilleur.",
         choices=[dict(label='Exposer vos produits à Paris', fx=dict(res=dict(livres=-300), glory=4, tmod=dict(trade=0.15), days=5 * 365), ai=2),
                  dict(label='Rester chez soi', fx=dict(), ai=1)]),
    dict(id='dreyfus', date=(1898, 1, 13), who=ALL, title='« J’accuse… ! »',
         text="Zola accuse l'état-major d'avoir condamné un innocent. L'affaire Dreyfus déchire la France.",
         choices=[dict(label='Soutenir la révision du procès', fx=dict(stab=-0.05, glory=4), ai=1),
                  dict(label="Défendre l'honneur de l'armée", fx=dict(stab=0.03, tmod=dict(morale=5), days=2 * 365), ai=1)]),
]
HIST_BY_ID = {e['id']: e for e in HIST}


# ------------------------------------------------------------------ événements aléatoires
def _has_port(g, code):
    return any('port' in g.geo.nodes[n['id']]['spec'] for n in g.owned_nodes(code))


RANDOM = [
    dict(id='recolte', w=3, season=('été', 'automne'), title='Une récolte magnifique',
         text="Les greniers débordent : jamais on n'avait vu pareille moisson.", base=dict(res_pct=dict(vivres=0.25))),
    dict(id='epizootie', w=2, title='Une épizootie',
         text="Une maladie décime les bœufs et les moutons dans les campagnes.", base=dict(res_pct=dict(vivres=-0.15))),
    dict(id='legs', w=2, title="Le legs d'un négociant",
         text="Un riche négociant {de_ville} lègue sa fortune à la province.", base=dict(res=dict(livres=400))),
    dict(id='filon', w=1, title='Un filon de fer',
         text="Des mineurs découvrent un filon de fer près {de_ville}.", base=dict(pmod=dict(fer=0.08))),
    # incendies, fièvres, brigands et foires touchent désormais une seule ville : voir les événements locaux (cities.py)
    dict(id='savant', w=1, title="Un savant {a_ville}",
         text="Un savant renommé propose de s'installer à {ville} si on le pensionne.",
         choices=[dict(label='Le pensionner', fx=dict(res=dict(livres=-250), research=1), ai=2),
                  dict(label='Le laisser partir', fx=dict(), ai=1)]),
    dict(id='contrebande', w=2, cond=_has_port, title='Des contrebandiers',
         text="Des contrebandiers débarquent du tabac et des toiles anglaises près {de_ville}.",
         choices=[dict(label='Fermer les yeux contre une part', fx=dict(res=dict(livres=250), stab=-0.03), ai=2),
                  dict(label='Saisir la marchandise', fx=dict(res=dict(livres=100), stab=0.02), ai=1)]),
]
RANDOM_BY_ID = {e['id']: e for e in RANDOM}


# ------------------------------------------------------------------ textes
def _fill(g, code, s, town=None):
    cap = g.capital_of(code)
    chef = g.geo.nodes[cap]['name']
    ville = g.geo.nodes[town]['name'] if town is not None else chef
    a_ville = 'au ' + ville[3:] if ville.startswith('Le ') else ('aux ' + ville[4:] if ville.startswith('Les ') else f"à {ville}")
    return s.format(nom=g.fname(code), chef=chef, de_chef=R.de(chef), ville=ville, de_ville=R.de(ville), a_ville=a_ville)


def _pct(v):
    return f"{'+' if v > 0 else '−'}{abs(round(v * 100))} %"


def _years(days):
    y = round(days / 365)
    return f"{y} an{'s' if y > 1 else ''}" if y >= 1 else f"{int(days)} jours"


def describe(g, code, fx, town=None):
    """Les effets en clair, pour la fenêtre de choix et le journal."""
    out = []
    for k, v in (fx.get('res') or {}).items():
        out.append(f"{'+' if v > 0 else '−'}{abs(int(v))} {R.RES_LABEL.get(k, k).lower()}")
    for k, v in (fx.get('res_pct') or {}).items():
        out.append(f"{R.RES_LABEL.get(k, k).lower()} {_pct(v)}")
    if fx.get('stab'):
        out.append(f"ordre public {_pct(fx['stab'])}")
    if fx.get('town_stab') and town is not None:
        out.append(f"ordre public {R.de(g.geo.nodes[town]['name'])} {_pct(fx['town_stab'])}")
    if fx.get('pop'):
        out.append(f"population {_pct(fx['pop'])}")
    if fx.get('town_pop') and town is not None:
        out.append(f"population {R.de(g.geo.nodes[town]['name'])} {_pct(fx['town_pop'])}")
    if fx.get('weary'):
        out.append(f"lassitude {'+' if fx['weary'] > 0 else '−'}{abs(int(fx['weary']))}")
    if fx.get('glory'):
        out.append(f"prestige (histoire) {'+' if fx['glory'] > 0 else '−'}{abs(int(fx['glory']))}")
    for k, v in (fx.get('tmod') or {}).items():
        val = f"{'+' if v > 0 else '−'}{abs(v)}" if k in ABS_MODS else _pct(v)
        out.append(f"{MOD_LABEL.get(k, k)} {val} pendant {_years(fx.get('days', 365))}")
    for k, v in (fx.get('pmod') or {}).items():
        val = f"{'+' if v > 0 else '−'}{abs(v)}" if k in ABS_MODS else _pct(v)
        out.append(f"{MOD_LABEL.get(k, k)} {val} (durable)")
    if fx.get('rel'):
        out.append(f"relations avec les autres camps {'+' if fx['rel'] > 0 else '−'}{abs(int(fx['rel']))}")
    for typ, cnt in fx.get('regs') or []:
        out.append(f"+{cnt} {g.unit_name(code, typ)[1].lower()} au chef-lieu")
    if fx.get('research'):
        out.append("recherches en cours avancées de moitié")
    if fx.get('ville'):
        from . import cities as CT   # événements locaux (game/cities.py)
        out += CT.describe_local(g, fx['ville'])
    return out or ['aucun effet']


def affordable(g, code, fx):
    r = g.factions[code]['res']
    if fx.get('ville'):
        from . import cities as CT
        if not CT.local_ok(g, code, fx['ville']):
            return False
    return all(r.get(k, 0) + v >= 0 for k, v in (fx.get('res') or {}).items())


# ------------------------------------------------------------------ effets
def apply(g, code, fx, town=None):
    f = g.factions[code]
    r = f['res']
    for k, v in (fx.get('res') or {}).items():
        r[k] = max(0.0, r.get(k, 0) + v)
    for k, v in (fx.get('res_pct') or {}).items():
        r[k] = max(0.0, r.get(k, 0) * (1 + v))
    mine = g.owned_nodes(code)
    if fx.get('stab'):
        for n in mine:
            n['stab'] = max(0.0, min(1.0, n['stab'] + fx['stab']))
    if fx.get('pop'):
        for n in mine:
            n['pop'] = n.get('pop', 0) * (1 + fx['pop'])
    if town is not None and g.nodes[town]['owner'] == code:
        n = g.nodes[town]
        if fx.get('town_pop'):
            n['pop'] = n.get('pop', 0) * (1 + fx['town_pop'])
        if fx.get('town_stab'):
            n['stab'] = max(0.0, min(1.0, n['stab'] + fx['town_stab']))
    if fx.get('weary'):
        f['weary'] = max(0.0, min(100.0, f.get('weary', 0) + fx['weary']))
    if fx.get('glory'):
        f['glory'] = f.get('glory', 0.0) + fx['glory']
    if fx.get('tmod'):
        until = g.t + fx.get('days', 365)
        for k, v in fx['tmod'].items():
            f.setdefault('tmods', []).append(dict(k=k, v=v, until=until))
    for k, v in (fx.get('pmod') or {}).items():
        em = f.setdefault('emods', {})
        em[k] = em.get(k, 0) + v
    if fx.get('rel'):
        for o, of in g.factions.items():
            if o != code:
                of['rel'][code] = max(-100, min(100, of['rel'][code] + fx['rel']))
    if fx.get('regs'):
        cap = g.capital_of(code)
        if g.nodes[cap]['owner'] == code:
            for typ, cnt in fx['regs']:
                for _ in range(cnt):
                    g.nodes[cap]['garrison'].append(g.new_reg(typ, code=code))
    if fx.get('research'):
        for cur in f['research'].values():
            if cur:
                cur['left'] *= 0.5
    if fx.get('ville'):
        from . import cities as CT
        CT.apply_local(g, code, fx['ville'])
    g.recompute_mods(code)
    g._dirty_income = True


# ------------------------------------------------------------------ déclenchement
def _ord(date):
    return datetime.date(*date).toordinal()


def tick(g, d):
    """Appelé chaque jour : événements datés du jour, puis événements aléatoires."""
    today = d.toordinal()
    done = g.ev_done
    for ev in HIST:
        if ev['id'] in done:
            continue
        o = _ord(ev['date'])
        if o > today:
            continue
        done.append(ev['id'])
        if o < g.start_ord:
            continue   # avant le début de la partie : c'est de l'histoire ancienne
        for code in (ev['who'] or R.FACTIONS):
            if code in g.factions and g.factions[code]['alive']:
                fire(g, code, ev, 'hist')
    for code, f in g.factions.items():
        if not f['alive']:
            continue
        if 'ev_next' not in f:
            f['ev_next'] = g.t + g.rng.uniform(*RANDOM_GAP)
        if g.t < f['ev_next']:
            continue
        f['ev_next'] = g.t + g.rng.uniform(*RANDOM_GAP)
        season = g.season()
        pool = [e for e in RANDOM if season in e.get('season', (season,)) and (not e.get('cond') or e['cond'](g, code))]
        if pool:
            fire(g, code, g.rng.choices(pool, [e['w'] for e in pool])[0], 'rand')


def fire(g, code, ev, kind):
    town = None
    if kind == 'rand':
        mine = [n['id'] for n in g.owned_nodes(code) if g.geo.nodes[n['id']]['type'] in ('capitale', 'ville')]
        town = g.rng.choice(mine) if mine else None
        if town is None:
            return
    title = _fill(g, code, ev['title'], town)
    text = _fill(g, code, ev['text'], town)
    gn = g.geo.nodes[town if town is not None else g.capital_of(code)]
    if ev.get('base'):
        apply(g, code, ev['base'], town)
    choices = ev.get('choices') or []
    base_txt = ', '.join(describe(g, code, ev['base'], town)) if ev.get('base') else ''
    if not choices:
        if code == g.player:
            g.log('evenement', f"{title} : {text} ({base_txt}).", gn['x'], gn['y'], who=code, important=True)
        return
    if code != g.player:
        ok = [i for i, c in enumerate(choices) if affordable(g, code, c['fx'])] or [len(choices) - 1]
        i = g.rng.choices(ok, [choices[j].get('ai', 1) for j in ok])[0]
        apply(g, code, choices[i]['fx'], town)
        if kind == 'hist' and ev['who'] is not ALL:
            g.log('evenement', f"{title} : {g.fname(code)} choisit « {choices[i]['label'].lower()} ».", gn['x'], gn['y'], who=code)
        return
    g.pending_ev.append(dict(id=g.nid('e'), ev=ev['id'], kind=kind, title=title, text=text, town=town,
                             base=base_txt, until=g.t + ANSWER_DAYS, date=g.date_str(),
                             choices=[dict(label=c['label'], fx=c['fx'], desc=describe(g, code, c['fx'], town))
                                      for c in choices]))
    g.log('evenement', f"{title}. {text}" + (f" ({base_txt})" if base_txt else '') + " Une décision vous attend.",
          gn['x'], gn['y'], who=code, important=True)
    g.alert_pause(big=True)


def resolve(g, pid, choice, auto=False):
    p = next((x for x in g.pending_ev if x['id'] == pid), None)
    if not p:
        return False, "Décision introuvable."
    if not (0 <= choice < len(p['choices'])):
        return False, "Choix inconnu."
    c = p['choices'][choice]
    if not auto and not affordable(g, g.player, c['fx']):
        return False, "Vous n'en avez pas les moyens."
    g.pending_ev.remove(p)
    apply(g, g.player, c['fx'], p['town'])
    g.log('evenement', f"{p['title']} : {'faute de décision, ' if auto else ''}{c['label'].lower()}"
                       f" ({', '.join(c['desc'])}).", important=True)
    return True, f"{p['title']} : {c['label'].lower()}."


def expire(g):
    for p in list(g.pending_ev):
        if g.t >= p['until']:
            last = len(p['choices']) - 1
            ok = [i for i, c in enumerate(p['choices']) if affordable(g, g.player, c['fx'])]
            resolve(g, p['id'], last if last in ok or not ok else ok[-1], auto=True)
