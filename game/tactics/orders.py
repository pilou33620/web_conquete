"""« Donner mes ordres » : la bataille du joueur jouée par ses officiers selon ses ordres, puis montrée vue de dessus.

Le joueur ne commande pas régiment par régiment : il choisit, avant la bataille, un objectif, une manœuvre, une aile,
un ordre pour chaque arme, la taille, la place et l'emploi de sa réserve, la conduite à tenir devant les imprévus, une
ruse, l'heure de l'attaque et une attitude. L'IA de combat (ai.py) mène alors son camp en suivant ces ordres
(spec['orders'][camp], lus par of()), et la bataille défile en accéléré sous ses yeux (bridge, mode « ordres »).

- groups(b, side) : les choix proposés pour cette bataille (rase campagne ou place, attaque ou défense), chacun avec
  la raison qui le verrouille ('' s'il est permis : époque, général, terrain, cavalerie, livres) ;
- clean(b, side, raw) : des ordres valides (valeurs connues et permises, sinon celles par défaut) ;
- advise(b, side, o) : l'avis du général (points forts, risques, estimation) d'après ce qu'on sait de l'ennemi ;
- report(b, side) : ce que les éclaireurs disent de l'ennemi (général, plan probable, composition) ;
- tweak(b, side, L) : les réglages de l'IA (ai.LEVELS) que changent les ordres ; plan(b, side) : le plan de l'IA ;
- ask(b, side, key, text) : le moment décisif (« Me demander ») : la bataille s'arrête et attend la réponse.

Effets de chaque ordre dans l'IA (ai.py, repérés par « ordres : ») :
- manœuvre : frontal, oblique (une aile forte, l'autre refusée 160 m en arrière ; avant 1789), percée au centre
  (préparation, point de rupture au centre, deux masses ; après 1789), enveloppement d'une aile (débordement par
  l'aile choisie), double enveloppement (débordement par l'aile choisie, la masse enveloppe l'autre), fixer et
  déborder (toute la cavalerie tourne l'ennemi, la ligne le fixe de loin), usure (escarmouche) ; en défense : tenir,
  tenir puis contre-attaquer, contre-pente (1789-1849), défense avancée, contre-offensive, usure ; devant une place :
  assaut à la brèche, pilonner d'abord, escalade sans attendre ; défendre la place, sorties, tenir les murs ;
- objectif : battre l'armée, la position clé (le point de rupture sur la hauteur ; en défense, on s'y accroche),
  couper la retraite (poursuite plus longue ; en défense : sauver l'armée, on décroche plus tôt), user ;
- armes : la marche de l'infanterie (ligne, colonne, ordre mixte, ordre dispersé), les légers (écran, bois, avec les
  colonnes), la cavalerie (aile, réserve, écran, raid sur les arrières), l'artillerie (contre-batterie, préparation,
  grande batterie, appui jusqu'au bout) ;
- réserve : aucune, un quart, un tiers ; derrière le centre ou l'aile ; engagée quand l'ennemi plie, gardée pour les
  trous, ou sur l'ordre du joueur (le moment décisif) ;
- imprévus : face aux cavaliers (carré, contre-charge, feu à bout portant), face à la réserve ennemie (la nôtre, les
  canons, presser l'assaut) ;
- ruse : feinte (une brigade attaque l'autre aile ; un général qui y croit y envoie sa réserve), marche par le bois
  (la colonne tournante passe sous les arbres), feux de camp (l'ennemi nous croit 50 % plus nombreux), faux
  déserteurs (60 livres : sa réserve et sa cavalerie se placent du mauvais côté), fausse retraite (les légers
  reculent, l'ennemi se découvre en contre-attaquant) ;
- heure : à l'aube (5 h 30 : l'ennemi surpris, moral −10 ; nos hommes fatigués +15), le matin, l'après-midi (12 h 30 :
  reposés −15, moins de jour) ; attitude : prudent (décroche 6 % plus tôt), équilibré, audacieux (6 % plus tard).
"""
import math

from .terrain import CELL, COLS, W, H, T_BOIS, T_FORET_T

WOODS = (T_BOIS, T_FORET_T)
FEINT_COST = 60              # faux déserteurs : l'agent et ses complices (livres)
DAWN_OFF, NOON_OFF = -2.5 * 3600, 4.5 * 3600   # l'heure de départ (5 h 30, 12 h 30), au lieu de 8 h
WAIT_ASK = 900.0             # « Attendre » au moment décisif : la réserve part un quart d'heure plus tard
MOOD_WD = dict(prudent=-0.06, equilibre=0.0, audacieux=0.06)

# ------------------------------------------------------------------ les choix
OBJ = {
    0: [('armee', 'Battre son armée', 'Tout pour la victoire : la poursuite décide de son ampleur.'),
        ('cle', 'Prendre la position clé', 'Le point de rupture sur la hauteur ou le village : un but plus sûr, '
                                          'une armée ennemie moins entamée.'),
        ('retraite', 'Couper sa retraite', 'La cavalerie poursuit plus loin et plus longtemps : une victoire peut '
                                           'devenir un désastre pour lui.'),
        ('user', 'L’user et se retirer', 'Lui coûter des hommes sans risquer l’armée : on décroche plus tôt, '
                                          'jamais d’assaut général.')],
    1: [('armee', 'Battre son armée', 'Le repousser, puis le chasser du champ de bataille.'),
        ('cle', 'Tenir coûte que coûte', 'On s’accroche à la position bien après les pertes ordinaires.'),
        ('retraite', 'Sauver l’armée', 'Décrocher tôt et en ordre, couvert par une arrière-garde.'),
        ('user', 'Lui faire payer cher', 'Salves à bonne portée, écran de tirailleurs, pas de retour offensif '
                                         'hasardeux.')],
}
MAN = {
    0: [('frontal', 'Assaut frontal', 'Toute la ligne avance ensemble. Simple, coûteux contre un ennemi à couvert.'),
        ('oblique', 'Ordre oblique', 'Une aile forte attaque, l’autre est « refusée » et reste en arrière.'),
        ('percee', 'Percée au centre', 'Longue préparation, grande batterie et colonnes sur un point du centre.'),
        ('enveloppement', 'Enveloppement d’une aile', 'Le centre fixe l’ennemi, une aile le tourne et le prend '
                                                     'de flanc.'),
        ('double', 'Double enveloppement', 'Une aile tourne l’ennemi, la réserve enveloppe l’autre. Risqué.'),
        ('fixer', 'Fixer et déborder', 'La ligne le fixe de loin par son feu, toute la cavalerie file sur '
                                       'ses arrières.'),
        ('usure', 'Usure', 'Canons et tirailleurs à longue portée, sans assaut. On décroche le soir.')],
    1: [('tenir', 'Tenir la position', 'Défense ferme : on use l’assaillant, peu de contre-attaques.'),
        ('elastique', 'Tenir puis contre-attaquer', 'On encaisse, puis on contre-attaque dès qu’il s’essouffle.'),
        ('contrepente', 'Contre-pente', 'La ligne attend à l’abri derrière la crête, et monte sur la crête '
                                        'pour le recevoir.'),
        ('avant', 'Défense avancée', 'La ligne se poste en avant de la position : on gagne du temps et du '
                                     'terrain, à découvert.'),
        ('contre', 'Contre-offensive', 'On marche à l’ennemi au lieu de l’attendre.'),
        ('usure', 'Usure', 'Escarmouche à longue portée, puis retraite.')],
}
MAN_PLACE = {
    0: [('breche', 'Assaut à la brèche', 'Canonnade sur le rempart, puis les colonnes à la brèche.'),
        ('pilonner', 'Pilonner d’abord', 'Une préparation moitié plus longue : la brèche plus large, l’ennemi usé.'),
        ('escalade', 'Escalade sans attendre', 'L’assaut part tôt, brèche ou non : vite fait, mais coûteux.')],
    1: [('place', 'Défendre la place', 'Brèches flanquées et retranchées, contre-attaques dans la brèche.'),
        ('sorties', 'Sorties contre les batteries', 'Des sorties répétées contre les canons qui battent le mur.'),
        ('murs', 'Tenir les murs', 'Pas de sortie : tout le monde aux remparts et dans les rues.')],
}
WING = [('gauche', 'Aile gauche', 'L’effort sur votre gauche (face à l’ennemi).'),
        ('droite', 'Aile droite', 'L’effort sur votre droite (face à l’ennemi).')]
INF = {
    0: [('colonne', 'Colonnes', 'Marchent vite en colonne, se déploient en ligne à portée. Le canon y fait des trous.'),
        ('ligne', 'Ligne', 'Se déploie en ligne loin de l’ennemi : moins de pertes au canon, marche plus lente.'),
        ('mixte', 'Ordre mixte', 'Un bataillon en ligne, l’autre en colonne : le feu et le choc.'),
        ('dispersé', 'Ordre dispersé', 'Les bataillons avancent en tirailleurs : peu de pertes au feu, fragiles '
                                       'devant les cavaliers.')],
    1: [('ligne', 'Ligne', 'Feu de salve en ligne, de quoi recevoir une charge.'),
        ('dispersé', 'Ordre dispersé', 'En tirailleurs derrière les couverts : peu de pertes, fragiles devant '
                                       'les cavaliers.'),
        ('colonne', 'Colonnes de réserve', 'Des colonnes derrière la ligne : prêtes à contre-attaquer.')],
}
LEG = [('avant', 'En écran devant', 'Tirailleurs devant la ligne : ils usent l’ennemi et cachent vos mouvements.'),
       ('bois', 'Dans les couverts', 'Postés dans les bois, les vignes ou les maisons de l’aile choisie.'),
       ('colonnes', 'Avec la ligne', 'Restent tout près de la ligne et visent les officiers.')]
CAV = [('ailes', 'Sur les deux ailes', 'Les escadrons aux deux ailes (davantage sur l’aile d’un débordement).'),
       ('aile', 'Sur l’aile choisie', 'Toute la cavalerie sur l’aile d’effort.'),
       ('reserve', 'En réserve', 'Derrière le centre, prête à exploiter la percée et à poursuivre.'),
       ('ecran', 'En écran', 'Couvre canons et infanterie contre les charges ; ne s’aventure pas.'),
       ('raid', 'Raid sur les arrières', 'Tourne l’ennemi et vise ses chariots et ses canons.')]
ART = [('libre', 'Au choix des artilleurs', 'Les canons tirent sur ce qui menace le plus, au point d’attaque d’abord.'),
       ('contre', 'Contre-batterie', 'Fait d’abord taire les canons ennemis, puis tire sur l’infanterie.'),
       ('prepa', 'Préparation', 'Une préparation moitié plus longue, sur le point d’attaque.'),
       ('grande', 'Grande batterie', 'Toutes les pièces serrées sur un point : la brèche, mais un seul point.'),
       ('appui', 'Appui jusqu’au bout', 'Les pièces suivent l’infanterie et tirent pendant l’assaut ; exposées.')]
RES = [('aucune', 'Aucune', 'Tout le monde en ligne dès le matin.'),
       ('quart', 'Un quart', 'Une brigade solide en arrière.'),
       ('tiers', 'Un tiers', 'Une vraie masse de manœuvre, mais une ligne plus mince.')]
RES_POS = [('centre', 'Derrière le centre', 'Peut aller partout, arrive partout un peu tard.'),
           ('aile', 'Derrière l’aile choisie', 'Nourrit l’effort principal ; l’autre aile est seule.')]
RES_WHEN = [('plie', 'Quand l’ennemi plie', 'Le général la lance dès que l’ennemi est ébranlé.'),
            ('cede', 'Pour boucher les trous', 'Elle ne sert qu’à relever, combler et couvrir.'),
            ('demande', 'Me demander', 'La bataille s’arrête au moment décisif : à vous de dire « maintenant ».')]
VS_CAV = [('carre', 'Former le carré', 'Sûr contre les cavaliers ; l’infanterie s’arrête, et le canon la vise.'),
          ('contre', 'Contre-charger', 'Notre cavalerie tombe sur la leur ; il faut qu’elle soit à portée.'),
          ('feu', 'Feu à bout portant', 'La ligne tient et tire de près : le carré seulement au dernier moment.')]
VS_RES = [('reserve', 'Lui opposer la mienne', 'Notre réserve va à sa rencontre.'),
          ('canons', 'Tourner les canons sur elle', 'Ses colonnes hachées en approchant ; les canons lâchent leur '
                                                     'cible.'),
          ('presser', 'Presser l’attaque', 'Finir avant qu’elle arrive : assaut général dès qu’elle se montre.')]
RUSE = [('aucune', 'Aucune', 'Le plan seul.'),
        ('feinte', 'Feinte', 'Un bataillon attaque l’autre aile pour y attirer la réserve ennemie.'),
        ('bois', 'Marche par le bois', 'La colonne tournante passe sous les arbres, cachée à la vue.'),
        ('feux', 'Feux de camp', 'Mille feux la veille : l’ennemi vous croit bien plus nombreux et n’ose pas '
                                 'contre-attaquer.'),
        ('deserteurs', 'Faux déserteurs', f'Ils annoncent l’attaque sur l’autre aile ({FEINT_COST} livres).'),
        ('retraite', 'Fausse retraite', 'Les tirailleurs reculent ; l’ennemi qui les suit se découvre.')]
HOUR = [('aube', 'À l’aube', 'Surprise : ses avant-postes dorment ; vos hommes ont marché de nuit.'),
        ('matin', 'Le matin', 'Une longue journée : le temps d’une poursuite.'),
        ('midi', 'L’après-midi', 'Vos hommes sont reposés ; la nuit arrêtera la poursuite.')]
MOOD = [('prudent', 'Prudent', 'Décroche tôt si ça tourne mal : on sauve l’armée.'),
        ('equilibre', 'Équilibré', 'Insiste tant que le moral tient.'),
        ('audacieux', 'Audacieux', 'Pousse jusqu’au bout : grandes victoires ou lourdes défaites.')]

# (par défaut, ce que ferait l'IA d'elle-même : un joueur qui ne touche à rien n'y gagne ni n'y perd)
DEFAULTS = dict(obj='armee', wing='droite', inf='colonne', leg='avant', cav='ailes', art='libre', res='quart',
                resPos='centre', resWhen='plie', vsCav='carre', vsRes='reserve', ruse='aucune', hour='matin',
                mood='equilibre')
TABS = [('man', 'Manœuvre'), ('armes', 'Les armes'), ('res', 'Réserve et imprévus'), ('ruse', 'Ruse et heure')]


# ------------------------------------------------------------------ lecture
def of(b, side):
    """Les ordres du joueur pour ce camp (None : bataille commandée ou jouée par l'IA seule)."""
    sp = getattr(b, 'spec', None)
    o = sp.get('orders') if isinstance(sp, dict) else None
    if isinstance(o, (list, tuple)) and len(o) == 2 and isinstance(o[side], dict):
        return o[side]
    return None


def foe_orders(b, side):
    """Les ordres du camp d'en face (ses ruses touchent notre IA)."""
    return of(b, 1 - side)


def wing_sign(o):
    return -1 if o.get('wing') == 'gauche' else 1


# ------------------------------------------------------------------ ce qu'on sait de la bataille
def _units(b, side):
    return [u for u in b.units if u.side == side and u.cls in ('inf', 'cavalerie', 'artillerie') and u.alive]


def _men(us, cls=None):
    return sum(u.men for u in us if cls is None or u.cls == cls)


def era(b):
    y = b.spec.get('year') or 1790
    return 2 if y >= 1850 else (0 if y < 1789 else 1)


def general(b, side):
    g = next((u for u in b.units if u.side == side and u.cls == 'general' and u.gen), None)
    return g.gen if g else None


def wood_on_wing(b, side, w):
    """Des bois sur cette aile, entre les deux armées (part des cases boisées d'une bande de 300 à 900 m sur l'aile)."""
    z = b.ai_zone(side)
    fd = b.front_dir(side)
    c, s = math.cos(fd), math.sin(fd)
    cx, cy = (z[0] + z[2]) / 2, (z[1] + z[3]) / 2
    n = k = 0
    for dep in range(200, 1300, 100):
        for lat in range(300, 950, 100):
            x, y = cx + c * dep - s * lat * w, cy + s * dep + c * lat * w
            if 0 <= x < W and 0 <= y < H:
                n += 1
                k += b.t[int(y // CELL) * COLS + int(x // CELL)] in WOODS
    return n > 0 and k / n >= 0.08


def _fat(b, side):
    us = _units(b, side)
    m = _men(us) or 1.0
    return sum(u.fat * u.men for u in us) / m


def groups(b, side, livres=None):
    """Les choix de cette bataille, par onglet : [{key, tab, title, opts: [{v, label, desc, why}]}]."""
    pl = b.place_info()
    us = _units(b, side)
    men = _men(us) or 1.0
    ncav = _men(us, 'cavalerie') / men
    nart = sum(1 for u in us if u.cls == 'artillerie')
    nline = sum(1 for u in us if u.cls == 'inf' and not u.light)
    nlight = sum(1 for u in us if u.cls == 'inf' and u.light)
    ep = era(b)
    gen = general(b, side) or {}
    foe = _men(_units(b, 1 - side)) or 1.0
    tech = (b.spec.get('tech') or [{}, {}])[side] or {}
    why = {}

    def lock(key, v, reason):
        if reason:
            why[(key, v)] = reason

    if pl:
        man = MAN_PLACE[side]
    else:
        man = MAN[side]
        if side == 0:
            lock('man', 'oblique', 'Manœuvre de la guerre en dentelles (avant 1789)' if ep else '')
            lock('man', 'percee', '' if ep and nart else 'Il faut des canons' if ep else
                 'Il faut l’artillerie de Gribeauval et les colonnes (après 1789)')
            lock('man', 'double', '' if gen.get('lvl', 1) >= 3 or men >= 1.4 * foe else
                 'Il faut un général de division, ou 1,4 fois plus d’hommes que l’ennemi')
            lock('man', 'fixer', '' if ncav >= 0.12 else 'Il faut plus de cavalerie (12 % de l’armée)')
            lock('man', 'enveloppement', '' if ncav > 0 or nlight else 'Ni cavaliers ni légers pour tourner l’ennemi')
        else:
            lock('man', 'contrepente', '' if ep == 1 else 'La contre-pente est l’affaire des années 1789-1849')
    lock('inf', 'mixte', '' if tech.get('colonne_charge') else 'Il faut la technologie « Ordre mixte »')
    lock('inf', 'dispersé', '' if ep else 'L’ordre dispersé de la ligne attend la Révolution')
    lock('art', 'grande', '' if ep else 'La grande batterie attend l’artillerie de Gribeauval (après 1789)')
    att = 'Une ruse de l’attaque' if side or pl else ''
    lock('ruse', 'bois', att or ('' if any(wood_on_wing(b, side, w) for w in (-1, 1)) else
                                 'Pas de bois entre les deux armées'))
    lock('ruse', 'feinte', att or ('' if nline >= 3 else 'Il faut au moins trois bataillons de ligne'))
    lock('ruse', 'deserteurs', '' if livres is None or livres >= FEINT_COST else f'Il faut {FEINT_COST} livres')
    lock('ruse', 'retraite', '' if nlight or ncav >= 0.25 or gen.get('trait') in ('eclaireur', 'cavalier') else
         'Il faut des légers, beaucoup de cavalerie, ou un général cavalier ou éclaireur')
    lock('hour', 'aube', 'Vos hommes sont trop las pour marcher de nuit' if _fat(b, side) > 50 else '')
    if not ncav:
        for v, _l, _d in CAV:
            lock('cav', v, 'Pas de cavalerie')
    if not nart:
        for v, _l, _d in ART:
            lock('art', v, 'Pas de canons')
    if not nlight:
        for v, _l, _d in LEG:
            lock('leg', v, 'Pas d’infanterie légère')
    out = []

    def add(key, tab, title, opts):
        out.append(dict(key=key, tab=tab, title=title, cards=key == 'man',
                        opts=[dict(v=v, label=l, desc=d, why=why.get((key, v), '')) for v, l, d in opts]))

    if not pl:
        add('obj', 'man', 'Objectif de la journée', OBJ[side])
    add('man', 'man', 'La manœuvre' if not pl else ('L’assaut' if side == 0 else 'La défense'), man)
    if not pl:
        add('wing', 'man', 'Aile d’effort' if side == 0 else 'Aile à renforcer', WING)
    add('inf', 'armes', f'Infanterie ({int(_men(us, "inf") - sum(u.men for u in us if u.light))} h.)', INF[side])
    add('leg', 'armes', f'Infanterie légère ({nlight} bataillon{"s" if nlight > 1 else ""})', LEG)
    add('cav', 'armes', f'Cavalerie ({int(_men(us, "cavalerie"))} h.)', CAV)
    add('art', 'armes', f'Artillerie ({nart} batterie{"s" if nart > 1 else ""})', ART)
    add('res', 'res', 'Taille de la réserve', RES)
    if not pl:
        add('resPos', 'res', 'Où la placer', RES_POS)
    add('resWhen', 'res', 'Quand l’engager', RES_WHEN)
    add('vsCav', 'res', 'Si sa cavalerie charge', VS_CAV)
    add('vsRes', 'res', 'Si sa réserve se montre', VS_RES)
    add('ruse', 'ruse', 'Une ruse', RUSE)
    add('hour', 'ruse', 'Heure de l’attaque' if side == 0 else 'Heure de la bataille', HOUR)
    add('mood', 'ruse', 'Attitude', MOOD)
    return out


def defaults(b, side, gs=None):
    gs = gs or groups(b, side)
    o = {}
    for g in gs:
        opts = [x['v'] for x in g['opts'] if not x['why']] or [g['opts'][0]['v']]
        want = DEFAULTS.get(g['key'])   # (la manœuvre : la première permise, l'assaut frontal ou tenir)
        o[g['key']] = want if want in opts else opts[0]
    return o


def clean(b, side, raw, livres=None):
    """Des ordres valides : chaque clé connue, chaque valeur proposée et permise, sinon celle par défaut."""
    gs = groups(b, side, livres)
    d = defaults(b, side, gs)
    raw = raw if isinstance(raw, dict) else {}
    o = {}
    for g in gs:
        v = raw.get(g['key'])
        ok = {x['v'] for x in g['opts'] if not x['why']}
        o[g['key']] = v if isinstance(v, str) and v in ok else d[g['key']]
    return o


# ------------------------------------------------------------------ ce que disent les éclaireurs, l'avis du général
PLAN_TXT = dict(frontal='attaquer de front', artillerie='préparer son attaque au canon',
                debordement='nous déborder par une aile', tenir='tenir sa position', harcelement='escarmoucher, puis '
                'se retirer', assaut='donner l’assaut à la place', place='défendre la place')


def scouting(b, side):
    """Qualité du renseignement : légers et cavaliers, général éclaireur."""
    us = _units(b, side)
    n = len(us) or 1
    k = sum(1 for u in us if u.cls == 'cavalerie' or u.light) / n
    if b.trait(side) == 'eclaireur':
        k += 0.15
    return k


def report(b, side):
    """Ce que les éclaireurs disent de l'ennemi (pour la fenêtre des ordres)."""
    foe = _units(b, 1 - side)
    g = general(b, 1 - side)
    mem = (getattr(b, 'ai_mem', None) or {}).get(f's{1 - side}') or {}
    k = scouting(b, side)
    plan = mem.get('plan')
    sure = 'sûr' if k >= 0.3 else 'assez sûr' if k >= 0.15 else None
    mix = dict(inf=int(_men(foe, 'inf')), cav=int(_men(foe, 'cavalerie')),
               art=sum(1 for u in foe if u.cls == 'artillerie'))
    return dict(gen=dict(name=g.get('name'), trait=g.get('trait'), rank=g.get('rank')) if g else None,
                plan=PLAN_TXT.get(plan) if sure and plan else None, sure=sure, mix=mix,
                men=int(_men(foe)))


def advise(b, side, o):
    """L'avis du général : points forts, risques, estimation (favorable, incertaine, risquée)."""
    P, C = [], []
    pl = b.place_info()
    us, foe = _units(b, side), _units(b, 1 - side)
    men, fmen = _men(us) or 1.0, _men(foe) or 1.0
    ratio = men / fmen
    e_cav = _men(foe, 'cavalerie') / fmen
    my_cav = _men(us, 'cavalerie')
    e_art = sum(1 for u in foe if u.cls == 'artillerie')
    my_art = sum(1 for u in us if u.cls == 'artillerie')
    trait = b.trait(1 - side)
    mem = (getattr(b, 'ai_mem', None) or {}).get(f's{1 - side}') or {}
    e_plan = mem.get('plan')
    cover = sum(b.cover_at(u.x, u.y) * u.men for u in foe) / fmen
    m = o.get('man')
    att = side == 0
    if ratio >= 1.4:
        P.append('Vous êtes nettement plus nombreux.')
    elif ratio < 0.8 and att and m != 'usure':
        C.append('Vous êtes moins nombreux que lui : l’attaque est risquée.')
    if not pl and att:
        if m == 'frontal' and cover > 0.15:
            C.append('Il est à couvert : un assaut de front coûtera cher.')
        if m in ('enveloppement', 'double', 'fixer'):
            if e_cav >= 0.18 and e_cav * fmen > my_cav * 0.8:
                C.append('Sa cavalerie peut arrêter votre mouvement tournant.')
            else:
                P.append('Sa cavalerie est trop faible pour arrêter votre mouvement tournant.')
        if m == 'double' and ratio < 1.4:
            C.append('Le double enveloppement amincit votre centre : il faudrait bien plus d’hommes.')
        if m == 'percee':
            (P if my_art >= 1.3 * max(1, e_art) else C).append(
                'Vos canons dominent les siens : la ligne s’ouvrira.' if my_art >= 1.3 * max(1, e_art) else
                'Vos canons ne dominent pas les siens : la percée sera chère.')
        if m == 'oblique':
            P.append('Votre aile forte n’affronte qu’une partie de sa ligne.')
        if m == 'usure' and e_plan == 'tenir':
            C.append('Il compte tenir : l’usure risque de finir sans vainqueur.')
        if e_plan == 'tenir' and m in ('enveloppement', 'fixer', 'double'):
            P.append('Il attend sur place : il ne verra venir le mouvement tournant qu’au dernier moment.')
    if not pl and not att:
        if m == 'avant' and e_art > my_art:
            C.append('En avant de la position, vos lignes s’offrent à ses canons, plus nombreux.')
        if m == 'contrepente':
            P.append('Derrière la crête, ses boulets passent au-dessus de vos lignes.')
        if m == 'contre' and ratio < 1.2:
            C.append('Une contre-offensive sans supériorité vous fait perdre l’avantage du terrain.')
        if m == 'elastique':
            P.append('Il s’usera contre votre ligne avant votre contre-attaque.')
        if e_plan == 'debordement' and o.get('cav') in ('aile', 'ecran'):
            P.append('Vos cavaliers sur l’aile attendront son mouvement tournant.')
    if o.get('art') == 'contre':
        if e_art >= 2:
            P.append('Faire taire ses canons d’abord protégera votre infanterie.')
        elif e_art == 0:
            C.append('Il n’a pas de canons : la contre-batterie ne sert à rien.')
    if o.get('inf') == 'colonne' and att and e_art > my_art and o.get('art') != 'contre':
        C.append('Ses canons, plus nombreux, feront des trous dans vos colonnes.')
    if o.get('inf') == 'dispersé' and e_cav >= 0.15:
        C.append('L’ordre dispersé ne tient pas une charge : il a de la cavalerie.')
    if o.get('vsCav') == 'feu' and e_cav >= 0.2:
        C.append('Contre tant de cavaliers, le feu à bout portant demande de vieux soldats.')
    if o.get('vsCav') == 'contre' and o.get('cav') == 'raid':
        C.append('Votre cavalerie est partie en raid : personne pour contre-charger.')
    if o.get('vsCav') == 'carre' and e_cav < 0.05:
        P.append('Il n’a presque pas de cavaliers : le carré ne vous retardera guère.')
    if o.get('cav') == 'raid' and my_cav:
        if e_cav * fmen > my_cav:
            C.append('Ses cavaliers sont plus nombreux : le raid risque d’être coupé.')
        else:
            P.append('Ses chariots de munitions menacés : sa ligne tirera moins l’après-midi.')
    if o.get('res') == 'aucune':
        C.append('Aucune réserve : rien pour exploiter une percée ni parer une surprise.')
    if o.get('res') == 'tiers' and m == 'frontal':
        C.append('Avec un tiers en réserve, votre ligne est mince pour un assaut de front.')
    if o.get('resWhen') == 'demande':
        P.append('Vous choisirez vous-même le moment décisif.')
    if o.get('vsRes') == 'reserve' and o.get('res') == 'aucune':
        C.append('Pas de réserve à opposer à la sienne.')
    r = o.get('ruse')
    if r == 'feinte':
        if trait == 'eclaireur':
            C.append('Son général est un éclaireur : il risque de flairer la feinte.')
        else:
            P.append('Son général mordra probablement à la feinte.' if trait != 'prudent' else
                     'Un général prudent mordra à la feinte.')
    elif r == 'feux':
        P.append('Il vous croira bien plus nombreux : il n’osera guère contre-attaquer.')
    elif r == 'bois':
        P.append('Le bois cachera la marche de votre colonne.')
    elif r == 'deserteurs':
        P.append('Sa réserve et ses cavaliers attendront l’attaque du mauvais côté.')
    elif r == 'retraite':
        P.append('Ses bataillons qui poursuivront vos tirailleurs se découvriront.')
    if o.get('hour') == 'aube':
        P.append('Surprise : ses avant-postes dorment encore.')
        C.append('Vos hommes ont marché de nuit : fatigués dès midi.')
    elif o.get('hour') == 'midi':
        C.append('La nuit tombera tôt : pas de longue poursuite.')
    if o.get('mood') == 'audacieux' and ratio < 1.0:
        C.append('Audace en infériorité : une défaite peut tourner au désastre.')
    if o.get('mood') == 'prudent' and o.get('obj') == 'cle':
        C.append('Prudence et position à tenir coûte que coûte se contredisent.')
    if o.get('obj') == 'retraite' and att and o.get('cav') not in ('raid', 'reserve') and m not in ('fixer',):
        C.append('Pour couper sa retraite, gardez la cavalerie en réserve ou lancez-la sur ses arrières.')
    if o.get('obj') == 'user' and att and m not in ('usure', 'fixer'):
        C.append('Pour l’user sans risque, une manœuvre d’usure convient mieux.')
    score = len(P) - len(C)
    verdict = 'favorable' if score >= 2 else 'risquée' if score <= -2 else 'incertaine'
    return dict(pros=P[:5], cons=C[:5], verdict=verdict)


# ------------------------------------------------------------------ les flèches de la manœuvre, au sol
def arrows(b, side, o):
    """Les flèches de la manœuvre sur la carte de bataille (fenêtre des ordres), tirées du déploiement de l'IA du joueur
    (ai_mem : l'ancre de sa ligne, son front, sa largeur) et du centre de la zone ennemie (connue du joueur) :
    [{pts: [[x, y], …], k}], k : 'main' (l'effort), 'fix' (fixer, user), 'feint', 'raid' (la cavalerie), 'hidden'
    (sous les bois), 'counter' (contre-attaque), 'fire' (le tir des canons). Le client lisse les tracés."""
    mem = (getattr(b, 'ai_mem', None) or {}).get(f's{side}') or {}
    if 'ax' not in mem or not o:
        return []
    ax, ay, fd, w2 = mem['ax'], mem['ay'], mem['fd'], mem.get('width', 600) / 2
    c, s = math.cos(fd), math.sin(fd)

    def at(dep, lat):
        return [round(min(W - 20, max(20, ax + c * dep - s * lat))), round(min(H - 20, max(20, ay + s * dep + c * lat)))]

    ez = b.ai_zone(1 - side)
    D = max(300.0, min(1600.0, ((ez[0] + ez[2]) / 2 - ax) * c + ((ez[1] + ez[3]) / 2 - ay) * s - 150))
    w, m = wing_sign(o), o.get('man')
    out = []

    def add(k, *pts):
        out.append(dict(k=k, pts=[list(p) for p in pts]))

    pl = b.place_info()
    if pl:
        hx, hy = b.objective() or (pl['x'], pl['y'])
        if side == 0:
            add('main', at(0, 0), [round(hx), round(hy)])
        elif m == 'sorties':
            add('counter', [round(hx), round(hy)], at(-400, 0))
        return out
    wide = (-0.6 * w2, 0.0, 0.6 * w2)
    if side == 0:
        if m == 'frontal':
            for lat in wide:
                add('main', at(0, lat), at(D, lat))
        elif m == 'oblique':
            add('main', at(0, w * 0.6 * w2), at(D, w * 0.8 * w2))
            add('fix', at(0, 0), at(0.6 * D, 0))
            add('fix', at(-160, -w * 0.6 * w2), at(-40, -w * 0.6 * w2))
        elif m == 'percee':
            add('main', at(0, 0), at(D, 0))
            for lat in (-0.7 * w2, 0.7 * w2):
                add('fix', at(0, lat), at(0.55 * D, lat))
        elif m in ('enveloppement', 'double'):
            for ww in ((w, -w) if m == 'double' else (w,)):
                wood = mem.get('ord', {}).get('wood') if ww == w else None
                mid = wood or at(0.45 * D, ww * (w2 + 450))
                add('hidden' if wood else 'main', at(0, ww * w2), mid, at(0.9 * D, ww * (w2 + 380)), at(D, ww * (w2 + 80)))
            add('fix', at(0, 0), at(0.55 * D, 0))
        elif m == 'fixer':
            for lat in wide:
                add('fix', at(0, lat), at(0.55 * D, lat))
            add('raid', at(-50, w * (w2 + 150)), at(0.5 * D, w * (w2 + 650)), at(D + 300, w * (w2 + 420)), at(D + 450, 0))
        elif m == 'usure':
            for lat in wide:
                add('fix', at(0, lat), at(0.5 * D, lat))
        if o.get('ruse') == 'feinte':
            add('feint', at(0, -w * 0.75 * w2), at(0.85 * D, -w * 0.85 * w2))
    else:
        if m == 'contre':
            for lat in wide:
                add('main', at(0, lat), at(D, lat))
        elif m == 'elastique':
            add('counter', at(-200, w * 0.3 * w2), at(250, w * 0.3 * w2))
        elif m == 'usure':
            add('fix', at(0, 0), at(-500, 0))
    if o.get('cav') == 'raid' and m != 'fixer':
        add('raid', at(-70, w * (w2 + 110)), at(0.5 * D, w * (w2 + 600)), at(D + 350, w * (w2 + 300)))
    if o.get('art') in ('grande', 'prepa') or m == 'percee':
        lat = w * 0.7 * w2 if m == 'oblique' else 0.0
        for u in b.units:
            if u.side == side and u.cls == 'artillerie' and u.alive:
                add('fire', [round(u.x), round(u.y)], at(D, lat))
    return out


# ------------------------------------------------------------------ ce que font les ordres dans l'IA
def plan(b, side, pl):
    """Le plan de l'IA dicté par la manœuvre (None : l'IA choisit)."""
    o = of(b, side)
    if not o:
        return None
    if pl:
        return 'assaut' if side == 0 else 'place'
    m = o.get('man')
    if side == 0:
        return dict(frontal='frontal', oblique='frontal', percee='artillerie', enveloppement='debordement',
                    double='debordement', fixer='debordement', usure='harcelement').get(m)
    return dict(tenir='tenir', elastique='tenir', contrepente='tenir', avant='tenir', contre='frontal',
                usure='harcelement').get(m)


def tweak(b, side, L):
    """Les réglages de l'IA (ai.LEVELS) que changent les ordres de ce camp, et les ruses du camp d'en face."""
    o = of(b, side)
    f = foe_orders(b, side)
    if not o and not f:
        return L
    L = dict(L)
    if o:
        m = o.get('man')
        L['wd_loss'] = L['wd_loss'] + MOOD_WD.get(o.get('mood'), 0.0)
        if o.get('mood') == 'audacieux':
            L['ten_k'] = L.get('ten_k', 1.0) * 1.3
        obj = o.get('obj')
        if obj == 'cle' and side == 1:
            L['wd_loss'] += 0.06
        elif obj == 'retraite':
            if side == 0:
                L['pursue_r'] = max(L['pursue_r'], 600.0) * 1.8
                L['exploit_k'] = L['exploit_k'] * 1.4
            else:
                L['wd_loss'] -= 0.06
                L['rg'] = True
        elif obj == 'user':
            if side == 0:
                L['wd_loss'] -= 0.04
            else:
                L['volley_def'] = True
                L['screen'] = 1
                L['ro_k'] = 99.0
        if m == 'percee':
            L['masse_n'] = max(2, L['masse_n'])
            L['rupture'] = True
            L['prep'] = L['prep'] * 1.3
        elif m == 'frontal':
            L['prep'] = L['prep'] * 0.7
        elif m == 'tenir':
            L['ro_k'] = 99.0
        elif m == 'elastique':
            L['ro_k'] = 0.6
            L['ro_ebb'] = L['ro_ebb'] * 0.6
            L['counter_k'] = L['counter_k'] * 0.75
        elif m == 'contrepente':
            L['cp'] = 1
        elif m == 'sorties':
            L['sortie'] = max(2, L['sortie'] + 1)
        elif m == 'murs':
            L['sortie'] = 0
            L['coupure'] = 1
        elif m == 'pilonner':
            L['assault_prep'] = L['assault_prep'] * 1.5
        elif m == 'escalade':
            L['assault_prep'] = L['assault_prep'] * 0.5
        if o.get('art') == 'grande':
            L['pt_k'] = max(L['pt_k'], 1.6) * 1.5
        elif o.get('art') == 'prepa':
            L['prep'] = L['prep'] * 1.5
            L['prep_max'] = L['prep_max'] * 1.4
            L['pt_k'] = max(L['pt_k'], 1.6) * 1.2
        rw = o.get('resWhen')
        if rw == 'cede':
            L['masse_n'] = 0
            L['res_ca'] = True
        vc = o.get('vsCav')
        if vc == 'feu':
            L['sq_r'] = 120.0
        elif vc == 'contre':
            L['counter'] = True
            L['cav_opp'] = True
        if o.get('cav') == 'ecran':
            L['cav_r'] = L['cav_r'] * 0.7
        elif o.get('cav') == 'raid':
            L['cav_r'] = L['cav_r'] * 1.4
        if o.get('leg') == 'avant' and side == 1:
            L['screen'] = 1
        elif o.get('leg') == 'colonnes':
            L['screen'] = 0
    if f:
        if f.get('ruse') == 'retraite':
            L['ca_thr'] = L['ca_thr'] * 0.7   # (ses tirailleurs reculent : nos bataillons les suivent trop volontiers)
            L['ca_reach'] = L['ca_reach'] * 1.3
        if f.get('ruse') == 'feux':
            L['counter_k'] = L['counter_k'] * 1.5
            L['ro_k'] = L['ro_k'] * 1.5
    return L


def announced_k(b, side):
    """Feux de camp : l'ennemi croit le camp d'en face 50 % plus nombreux."""
    f = foe_orders(b, side)
    return 1.5 if f and f.get('ruse') == 'feux' else 1.0


def res_count(o, n, default):
    """Bataillons de réserve d'infanterie selon les ordres (n : bataillons de ligne)."""
    r = (o or {}).get('res')
    if r == 'aucune':
        return 0
    if r == 'tiers':
        return max(1, round(n / 3)) if n >= 3 else default
    if r == 'quart':
        return max(1, round(n / 4)) if n >= 3 else default
    return default


def ask(b, side, key, text):
    """Le moment décisif, si le joueur a demandé qu'on l'appelle : 'go' (on y va), 'wait' (pas encore) ou None (la
    question est posée : la bataille attend sa réponse)."""
    o = of(b, side)
    if not o or o.get('resWhen') != 'demande' or getattr(b, 'replay', None) is None:
        return 'go'
    mem = b.ai_mem.setdefault(f's{side}', {})
    asked = mem.setdefault('asked', {})
    a = asked.get(key)
    if a:
        if a[0] == 'go' or b.clock - a[1] >= WAIT_ASK:
            return 'go'
        return 'wait'
    if b.replay.get('skip'):
        asked[key] = ['go', round(b.clock)]
        return 'go'
    if not b.ask:
        b.ask = dict(side=side, key=key, text=text, t=round(b.clock))
    return None


def answer(b, choice):
    """La réponse du joueur au moment décisif ('go' ou 'wait')."""
    q = getattr(b, 'ask', None)
    if not q:
        return False
    mem = b.ai_mem.setdefault(f's{q["side"]}', {})
    mem.setdefault('asked', {})[q['key']] = ['go' if choice == 'go' else 'wait', round(b.clock)]
    b.ask = None
    return True


def setup(b, side, o):
    """Au départ de la bataille : l'heure (et ce qu'elle fait aux hommes : spec['h_off'], le crépuscule)."""
    h = o.get('hour')
    off = DAWN_OFF if h == 'aube' else NOON_OFF if h == 'midi' else 0.0
    b.dusk += b.spec.get('h_off', 0.0) - off
    b.spec['h_off'] = off
    if h == 'aube':
        for u in b.units:
            if u.side == 1 - side and u.cls in ('inf', 'cavalerie', 'artillerie'):
                u.morale = max(20.0, u.morale - 10)   # (surpris au réveil)
            elif u.side == side and u.cls in ('inf', 'cavalerie', 'artillerie'):
                u.fat = min(100.0, u.fat + 15)
    elif h == 'midi':
        for u in b.units:
            if u.side == side and u.cls in ('inf', 'cavalerie', 'artillerie'):
                u.fat = max(0.0, u.fat - 15)
    left = b.dusk - b.clock
    b.light = 1.0 if left > 3600 else max(0.15, 0.15 + 0.85 * left / 3600)
