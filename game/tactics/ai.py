"""IA de combat des batailles tactiques.

Deux points d'entrée, appelés par le moteur (battle.py) et le raccord de campagne (bridge.py) :
- deploy(battle, side) : déploiement selon la mission et le terrain, et choix du plan de bataille (sert aussi de
  placement de départ au camp du joueur, au niveau normal) ;
- think(battle, side, dt) : appelée toutes les 2 s de bataille. Réflexes (carré face à une vraie charge, ralliement,
  contre-charge) et réflexion « lourde », plus espacée selon le niveau : situation, plan, phases, ordres de chaque unité,
  donnés seulement quand ils changent quelque chose (les longues marches par étapes : le moteur ne cherche que des
  chemins courts).

Déploiement
- Rase campagne : la ligne d'infanterie au centre ; pour le défenseur, sur la meilleure ligne de sa zone (hauteur,
  haies et murets, champ de tir dégagé devant) ; chaque bataillon cherche sa haie ou sa crête à quelques dizaines de
  mètres, les meilleurs au centre. Canons un peu en arrière, sur une hauteur qui voit loin, de préférence dans les
  vignes ou en lisière (la cavalerie y charge mal ; en difficile, cachés en lisière de bois). Légers en avant, dans les
  bois, les vignes, le bâti. Cavalerie aux ailes (davantage sur l'aile du débordement ; une réserve de cavalerie en
  difficile). Réserve d'infanterie en colonne derrière le centre (grenadiers d'abord ; sapeurs et gardes nationaux y
  restent). État-major derrière le centre, chariot à l'abri derrière.
- Défense d'une place : deux bataillons solides de part et d'autre de chaque brèche, à l'intérieur et à l'abri du mur
  (les canons du dehors ne les voient pas ; les colonnes qui passent sont prises entre deux feux), les autres et les
  légers le long des remparts face à l'assaillant (ils tirent par-dessus le mur), les canons au rempart, la milice dans
  les rues et au cœur de la place, une réserve et la cavalerie au cœur. On ne la quitte pas.
- Assaut d'une place : colonnes d'assaut face à la brèche principale (ou au point le plus proche de l'enceinte), seconde
  vague derrière, diversion face à une autre face, canons en batterie à bonne portée de la brèche, cavalerie en réserve.

Plans (repris de la campagne quand c'est possible : spec['plans'], voir rules.PLANS ; sinon selon le rapport des
forces annoncé, la mission, l'armement et le trait du général : cavalier → débordement, artilleur → artillerie,
prudent → harcèlement plus tôt, audacieux → contre-offensive plus tôt)
- frontal : courte préparation d'artillerie, puis la ligne avance par bonds, s'arrête à portée efficace et fait feu,
  puis charge à la baïonnette ;
- artillerie : la même chose après une longue préparation ;
- debordement : la cavalerie de l'aile et les légers tournent le flanc le plus dégagé et prennent l'ennemi de flanc et
  de dos pendant que le centre le fixe ; ils reviennent sur l'aile si des cavaliers plus nombreux leur barrent la route ;
- tenir : défense de la position et usure de l'assaillant ; contre-attaque générale quand il flanche ;
- harcelement : escarmouche à longue portée (canons, légers), puis retraite (quand on est nettement inférieur) ;
- assaut : assaut d'une place (une heure de canonnade sur la brèche (40 min en facile, 70 en difficile), diversion,
  colonnes quand les défenseurs sont usés, puis le cœur ; nouvelle vague, avec les troupes ralliées, si la première
  est repoussée ou si tout piétine) ;
- place : défense d'une place.

Pendant la bataille
- Ligne : avance par bonds en attendant ses retardataires ; colonne pour marcher loin du feu, ligne sous le feu, ou ordre
  dispersé (nettement moins de pertes au canon, un peu moins au fusil) tant qu'aucun cavalier ennemi ne rôde ;
  arrêt à portée efficace, chaque bataillon réglant sa distance sur l'ennemi d'en face et cherchant un couvert ;
  jamais dans la mitraille meurtrière d'une batterie ennemie connue (60 % de sa portée : au-delà, la gerbe s'ouvre ;
  terrible sous 150 m) ; baïonnette après un quart d'heure de fusillade quand le corps à corps est favorable (et contre
  l'ennemi ébranlé, pris de flanc, ou des canons sans soutien, pas de face s'ils sont en ordre : leur mitraille à bout
  portant coûte très cher) ; une batterie qui interdit l'approche est enlevée à la baïonnette, de flanc de préférence
  (de face : seulement ébranlée, réduite, ou à quatre contre un) ; si plus
  rien ne bouge pendant trois quarts d'heure, ou si la ligne ne tire plus depuis une demi-heure sans que l'ennemi
  perde rien : assaut général (sans plus craindre la mitraille) quand on n'est pas nettement plus faible, renouvelé
  tant qu'on est nettement plus fort ; sinon on décroche.
- Carré seulement face à une vraie charge (cavaliers qui chargent ou arrivent droit sur nous, par un chemin praticable),
  rompu dès que la menace passe (le canon ravage les carrés) ; pas de carré à moins de 200 m de l'infanterie ennemie
  (il y serait fusillé) sauf si les cavaliers chargent cette troupe même, ni quand une ligne ferme voit venir la charge
  de face (son feu de défense la repousse).
- Cavalerie : charges choisies (artillerie sans soutien, fuyards, chariot, état-major, de flanc ou de dos, ennemi
  ébranlé ou en tirailleurs, jamais un carré ni une ligne fraîche de face), sur un chemin libre ; contre-charges avec
  assez d'escadrons, loin de l'infanterie ennemie ; postes d'attente hors de portée des canons ennemis.
- Artillerie : emplacements qui voient l'ennemi connu, à 85 % de la portée efficace pendant la préparation, plus près
  ensuite ; mitraille hors de portée des fusils ennemis quand nul cavalier ne rôde ; batterie aveugle déplacée ; cibles :
  colonnes, carrés, canons qui menacent nos lignes, cavaliers, chariot ; recomplètement au chariot.
- Réserves : combler un trou, relever un bataillon épuisé, ébranlé ou sans cartouches (qui va se recompléter au
  chariot), couvrir un flanc débordé, soutenir une batterie menacée, contre-attaquer une percée, prolonger la ligne
  débordée (difficile) ; ralliés reformés près du général. Général et chariot derrière le secteur qui en a besoin,
  abrités derrière un bataillon quand des cavaliers rôdent.
- Fuyards : le moteur ne les rallie qu'auprès d'un général. Le général (normal, difficile) va au-devant d'eux sur
  leur chemin de fuite, hors de portée de fusil (330 m de l'ennemi repéré), s'il peut y aller sans passer sous le feu
  ni croiser des cavaliers ennemis (jusqu'à 900 m, 1 200 m en difficile) ; les réflexes les rallient dès qu'il est
  auprès d'eux. Facile le laisse à son poste.
- Décrochage en bon ordre quand la bataille est perdue (pertes, rapport de forces vu, moral, nuit), jamais pour le
  défenseur d'une place : passé wd_loss de pertes (les troupes en déroute comptent pour moitié) si l'ennemi est nettement
  plus fort, ou passé wd_loss + 7 % dans un combat égal ; l'assaillant qui mène l'attaque accepte 5 % de plus.
  Obstination selon la situation (_tenacity, TEN_*) : on accepte jusqu'à 18 % de pertes de plus quand on a l'avantage
  (l'ennemi a perdu plus d'hommes que nous, à l'aune de l'échange ordinaire où l'assaillant perd 20 % de plus ; rapport
  de forces vu favorable ; ennemi en déroute ou ébranlé ; réserves fraîches) ou qu'on tient une bonne position en
  défense (crête, haies, murets, bois, bâti) ; sans rien de tout cela, on décroche 3 % plus tôt.

Niveaux (battle.difficulty ; spec['ai_levels'] = [niveau du camp 0, du camp 1] et spec['ai_tweak'] pour les essais).
Ils ne changent que la qualité des décisions, jamais les dégâts :
- facile : prudente et maladroite : réfléchit toutes les 20 à 32 s, réflexes lents (6 s), ne lit pas le terrain, marche
  sans attendre les retardataires et reste en colonne trop longtemps, s'arrête à une mauvaise portée, voit tard les
  cavaliers et oublie parfois le carré, charge sans discernement, ne contre-charge pas, choisit mal les cibles de ses
  canons, engage sa réserve d'emblée, ne surveille pas ses flancs, ne relève personne, décroche tôt ;
- normal : correcte : terrain, cohésion, carrés, charges choisies, contre-charges, mitraille prudente, ordre dispersé,
  réserves pour les trous, les relèves et les flancs, batteries enlevées à la baïonnette ;
- difficile : réfléchit toutes les 6 s ; s'arrête à pleine portée efficace et avance par bonds réguliers ; terrain plus
  fouillé (crêtes, haies, lisières, canons cachés) ; attend que l'artillerie ait ébranlé l'ennemi ; réserves qui
  prolongent une ligne débordée et contre-attaquent les percées ; légers qui prennent l'ennemi de flanc ; cavalerie
  qui ne s'expose pas aux contre-charges ; contre-offensive plus tôt ; le général va chercher ses fuyards plus loin.
  (L'ordre oblique a été retiré, et les essais d'aile refusée, d'attaque concentrée de flanc au bout de l'aile ennemie
  et de contre-batterie d'abord n'ont pas été gardés : sur 96 batailles chacun, ils faisaient perdre l'assaillant plus
  souvent ; voir le rapport de mise au point.)

Vue : l'IA ne lit que les ennemis repérés par son camp (battle.visible_enemies) et sa mémoire de ce qu'elle a vu
(positions, effectifs, état ; batteries et leur portée de mitraille), plus ce que le joueur sait aussi : le terrain
(brèches comprises), les zones de déploiement, l'effectif de départ annoncé par les éclaireurs, et ce que la vue du
client montre des unités repérées (formation, moral, portées). Sa mémoire (battle.ai_mem['s0' | 's1']) ne contient que
des types JSON : elle est enregistrée avec la bataille. Le journal des grands moments (mem['journal']) sert aux
comptes rendus.
"""
import math
import random

from . import battle as BT
from . import units as U
from .terrain import (W, H, T_BOIS, T_FORET_T, T_MARAIS_T, T_VIGNE_T, T_BATI, T_MUR, T_PORTE, T_BRECHE,
                      T_BARRICADE, T_ROCHE)

WOODS = (T_BOIS, T_FORET_T)
ROUGH = (T_BOIS, T_FORET_T, T_MARAIS_T, T_VIGNE_T, T_BATI, T_MUR, T_PORTE, T_BRECHE, T_BARRICADE)
SCREEN = (T_BOIS, T_FORET_T, T_BATI, T_MUR, T_PORTE)
WALLS = (T_MUR, T_PORTE, T_BRECHE, T_BARRICADE)
# vulnérabilité des cibles au boulet et à la mitraille (celle du moteur) : pour choisir les cibles des canons
BALL = BT.VUL_BALL
GRAPE = BT.VUL_GRAPE
PLAN_LABEL = dict(frontal='assaut frontal coordonné', artillerie="préparation d'artillerie, puis assaut",
                  debordement='débordement par un flanc', tenir="tenir la position et user l'adversaire",
                  harcelement='escarmouche, puis retraite', assaut='assaut de la place', place='défense de la place')
WING = {-1: "l'aile gauche", 1: "l'aile droite", 0: 'la réserve'}
LEG = 450.0          # une longue marche se donne par étapes (recherches de chemin courtes)
# hauteurs pour la vue (celles du moteur) : les canons (officiers à cheval) voient par-dessus les haies proches
EYES = BT.HEIGHT
GUN_EYE = EYES['artillerie']
# la mitraille ne fait de vrais ravages qu'à moins de 60 % de sa portée (le moteur l'éparpille au-delà : battle.grape_k),
# et elle est terrible sous 150 m (×1,5 à 100 m, ×2 à 50 m : battle.GRAPE_CLOSE) : c'est cette zone (plus 40 m) que la
# ligne évite ; une batterie en ordre ne s'aborde pas de face (_gun_front), sauf déjà ébranlée ou en nombre
GRAPE_DEADLY = 0.6

# l'assaillant qui mène l'attaque (plans frontal, artillerie, débordement) ne décroche qu'avec ce supplément de pertes :
# il sait qu'on n'emporte pas une position sans le payer (même valeur à tous les niveaux)
ATT_TENACITY = 0.05
# combat égal qui s'éternise : passé wd_loss + WD_EVEN_LOSS de pertes, on cède si le rapport de forces vu est sous
# wd_ratio + WD_EVEN
WD_EVEN_LOSS, WD_EVEN = 0.07, 0.2
FIRE_LONG = 900.0   # durée de fusillade avant la baïonnette à forces égales (s)
# assaut d'une place : vagues de plus après la première, au plus (avec les troupes ralliées depuis, qui ne restent plus
# en réserve : une seule suffit, deux feraient tomber les places bien plus souvent qu'avant)
ASSAULT_WAVES = 1
# obstination selon la situation (_tenacity) : supplément de pertes accepté avant de décrocher quand l'ennemi a perdu
# plus que nous (tués, blessés, prisonniers, à l'aune d'EXCHANGE : TEN_TRIED_K fois l'écart, au plus TEN_TRIED), quand le
# rapport de forces vu est favorable, quand l'ennemi a des troupes en déroute ou est ébranlé, qu'il nous reste des
# réserves fraîches, que la ligne du défenseur tient une bonne position ; au plus TEN_MAX en tout. Rien de tout cela :
# on décroche plus tôt (TEN_NONE)
EXCHANGE = 1.2      # (l'assaillant perd d'ordinaire 20 % de plus que le défenseur à couvert)
TEN_TRIED, TEN_TRIED_K, TEN_RATIO, TEN_ROUT, TEN_RES, TEN_POS, TEN_MAX, TEN_NONE = \
    0.12, 2.0, 0.03, 0.03, 0.03, 0.04, 0.18, -0.03
# le général va chercher ses fuyards jusqu'à FETCH_REACH (m) selon le niveau (facile : il ne bouge pas), sans
# s'approcher à moins de FETCH_SAFE de l'ennemi repéré (hors de portée de fusil)
FETCH_REACH, FETCH_SAFE = (0.0, 900.0, 1200.0), 330.0

LEVELS = {
    'facile': dict(n=0, period=20.0, jitter=12.0, reflex=6.0, sq_r=210.0, sq_miss=0.3, sq_late=True, terrain=0,
                   cohesion=False, bound=600.0, halt=(0.5, 1.45), prep=5 * 60, prep_max=8 * 60, cav_r=330.0,
                   cav_pick=False, counter=False, col_late=True, res_early=True, flank=False, relief=False,
                   art_pick=False, wd_loss=0.18, wd_ratio=0.95, harass=0.8, counter_k=99.0, gen_move=False,
                   grape=0, assault_prep=40 * 60, span=0, r_k=1.0, wood=False, skirm=0, cav_safe=False,
                   storm=False, extend=False, flankfire=False, ten_k=0.0),
    'normal': dict(n=1, period=10.0, jitter=4.0, reflex=2.0, sq_r=330.0, sq_miss=0.0, sq_late=False, terrain=1,
                   cohesion=True, bound=220.0, halt=(0.82, 0.92), prep=12 * 60, prep_max=25 * 60, cav_r=430.0,
                   cav_pick=True, counter=True, col_late=False, res_early=False, flank=True, relief=True,
                   art_pick=True, wd_loss=0.22, wd_ratio=0.8, harass=0.6, counter_k=2.0, gen_move=True,
                   grape=1, assault_prep=60 * 60, span=30, r_k=1.0, wood=False, skirm=2, cav_safe=False,
                   storm=True, extend=False, flankfire=False, ten_k=1.0),
    'difficile': dict(n=2, period=6.0, jitter=0.0, reflex=2.0, sq_r=330.0, sq_miss=0.0, sq_late=False, terrain=2,
                      cohesion=True, bound=220.0, halt=(0.88, 0.98), prep=15 * 60, prep_max=35 * 60, cav_r=430.0,
                      cav_pick=True, counter=True, col_late=False, res_early=False, flank=True, relief=True,
                      art_pick=True, wd_loss=0.25, wd_ratio=0.75, harass=0.6, counter_k=1.5, gen_move=True,
                      grape=1, assault_prep=70 * 60, span=60, r_k=1.8, wood=True, skirm=2, cav_safe=True,
                      storm=True, extend=True, flankfire=True, ten_k=1.0),
}


# ====================================================================== outils
def _lvl(b, side):
    lv = b.spec.get('ai_levels') if isinstance(getattr(b, 'spec', None), dict) else None
    name = lv[side] if isinstance(lv, (list, tuple)) and len(lv) > side and lv[side] in LEVELS else b.difficulty
    if name not in LEVELS:
        name = 'normal'
    tw = b.spec.get('ai_tweak') if isinstance(getattr(b, 'spec', None), dict) else None
    if isinstance(tw, dict) and isinstance(tw.get(name), dict):
        return dict(LEVELS[name], **tw[name]), name   # (réglages d'essai : séries de mise au point)
    return LEVELS[name], name


def _mem(b, side):
    m = getattr(b, 'ai_mem', None)
    if not isinstance(m, dict):
        m = b.ai_mem = {}
    return m.setdefault(f's{side}', {})


def _hour(clock):
    m = int(8 * 60 + clock / 60)
    return f"{m // 60} h {m % 60:02d}"


def _note(b, mem, txt):
    """Journal des grands moments (comptes rendus de bataille)."""
    j = mem.setdefault('journal', [])
    j.append([round(b.clock), f"{_hour(b.clock)} : {txt}"])
    if len(j) > 90:
        del j[:30]


def _at(x, y, a, dep, lat=0.0):
    """Point à dep mètres devant (x, y) selon l'axe a, et lat mètres sur la droite (vers l'ennemi, face à a)."""
    c, s = math.cos(a), math.sin(a)
    return x + c * dep - s * lat, y + s * dep + c * lat


def _rel(x, y, ax, ay, a):
    """(profondeur, latéral) de (x, y) par rapport à l'ancre (ax, ay), face à a."""
    c, s = math.cos(a), math.sin(a)
    dx, dy = x - ax, y - ay
    return dx * c + dy * s, -dx * s + dy * c


def _clamp(x, y, m=30.0):
    return min(max(x, m), W - m), min(max(y, m), H - m)


def _d2(ax, ay, bx, by):
    return (ax - bx) ** 2 + (ay - by) ** 2


def _ang(a, b):
    return abs((a - b + math.pi) % (2 * math.pi) - math.pi)


def _cat(u):
    if u.cls == 'general':
        return 'gen'
    if u.cls == 'chariot':
        return 'wagon'
    if u.cls == 'artillerie':
        return 'art'
    if u.cls == 'cavalerie':
        return 'cav'
    if u.light:
        return 'light'
    if u.type in ('milice', 'garde'):
        return 'mil'
    return 'inf'


def _groups(us):
    g = dict(inf=[], light=[], cav=[], art=[], mil=[], gen=[], wagon=[])
    for u in us:
        g[_cat(u)].append(u)
    return g


def _width(u):
    """Front d'une unité déployée (m)."""
    if u.cls == 'inf':
        return 120 * max(0.25, u.men / max(1.0, u.men_nom))
    if u.cls == 'cavalerie':
        return 100 * max(0.25, u.men / max(1.0, u.men_nom))
    if u.cls == 'artillerie':
        return 90.0
    return 20.0


def _quality(u):
    k = {'grenadiers': 1.35, 'sapeurs': 0.5, 'garde': 0.6, 'milice': 0.55}.get(u.type, 1.0)
    return u.men * (0.5 + u.morale / 200) * (1 + u.xp / 200) * k


def _einf(b, us):
    """Portée efficace moyenne de l'infanterie."""
    r = [b.ranges(u)[0] for u in us if u.cls == 'inf']
    return sum(r) / len(r) if r else 110.0


def _seed_rand(b, side, k):
    return random.Random((int(b.spec.get('seed', 0)) * 31 + side * 7 + k) & 0x7FFFFFFF).random()


def _form(b, side, u, f):
    """Change de formation, sauf si la manœuvre est déjà en cours (le moteur la recommencerait à zéro)."""
    if u.busy > 0 and u.next_form == f:
        return False
    if f == u.form and u.busy <= 0:
        return False
    return b.order(side, [u.id], 'form', form=f)[0]


def _note_once(b, mem, key, txt, delay=180.0):
    """Note du journal, une seule fois par clé dans le délai donné (charges répétées…)."""
    seen = mem.setdefault('noted', {})
    if b.clock - seen.get(key, -1e9) < delay:
        return
    seen[key] = round(b.clock)
    if len(seen) > 120:
        for k in sorted(seen, key=seen.get)[:60]:
            del seen[k]
    _note(b, mem, txt)


def _foe(e):
    """Nom d'une unité ennemie pour le journal : « 1er Ligne ennemi »."""
    return f"{e.name} ennemi" if e.name[:1].isdigit() else f"{e.name} (ennemi)"


def _announced(b, side):
    """Effectif de départ de l'ennemi, tel que les éclaireurs l'annoncent (le joueur le voit aussi)."""
    return sum(u.men0 for u in b.units if u.side != side and u.cls not in ('general', 'chariot'))


# ====================================================================== lecture du terrain
def _line_score(b, side, ax, ay, fd, half):
    """Valeur d'une ligne de défense : hauteur, couvert (haies, murets, lisières, maisons), champ de tir devant."""
    tot, n = 0.0, 0
    lat = -half
    while lat <= half + 1:
        x, y = _at(ax, ay, fd, 0, lat)
        lat += 40
        n += 1
        if not b.passable(x, y, 'inf', side):
            tot -= 2.0
            continue
        tot += _spot_score(b, x, y, fd)
    return tot / max(1, n)


def _spot_score(b, x, y, fd):
    h = b.height_at(x, y)
    fx, fy = _at(x, y, fd, 20)
    cov = max(b.cover_at(x, y), 0.8 * b.cover_at(fx, fy))
    f = 0.0
    for d in (60, 120, 200):
        qx, qy = _at(x, y, fd, d)
        if not (0 <= qx < W and 0 <= qy < H):
            continue
        if b.terrain_at(qx, qy) not in SCREEN:
            f += 1
        if b.height_at(qx, qy) < h - 2:
            f += 0.3
    return h / 25.0 + cov * 2.2 + f * 0.35


def _best_depth(b, side, x, y, fd, span):
    """Le bataillon cherche sa haie, son muret ou sa crête en avançant ou reculant de quelques dizaines de mètres."""
    best, bv = (x, y), -1e9
    for k in range(-int(span // 20), int(span // 20) + 1):
        px, py = _at(x, y, fd, k * 20)
        if not (20 < px < W - 20 and 20 < py < H - 20) or not b.passable(px, py, 'inf', side):
            continue
        v = _spot_score(b, px, py, fd) - abs(k) * 0.03
        if b.terrain_at(px, py) in WOODS:
            v -= 0.4   # une ligne dans le bois tire mal
        if v > bv:
            best, bv = (px, py), v
    return best


def _cover_spot(b, side, x, y, fd, r):
    """Poste de tirailleurs : bois, vignes, maisons, haies, avec une vue vers l'ennemi."""
    best, bv = (x, y), -1e9
    n = max(1, int(r // 40))
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            if i * i + j * j > n * n:
                continue
            px, py = x + i * 40, y + j * 40
            if not (20 < px < W - 20 and 20 < py < H - 20) or not b.passable(px, py, 'light', side):
                continue
            t = b.terrain_at(px, py)
            v = b.cover_at(px, py) * 3 + (0.8 if t in WOODS or t == T_BATI else 0.0) + b.height_at(px, py) / 60
            qx, qy = _at(px, py, fd, 140)
            if 0 <= qx < W and 0 <= qy < H and b.los(px, py, qx, qy):
                v += 0.7
            v -= math.hypot(i, j) / n * 0.8
            if v > bv:
                best, bv = (px, py), v
    return best


def _gun_spot(b, side, x, y, fd, r, wood=False, ahead=1e9, rough=False):
    """Emplacement de batterie près de (x, y) : hauteur et champ de tir dégagé vers fd ; en difficile, une lisière de
    bois (les canons y restent cachés jusqu'à leur première salve). rough : vignes et lisières, où la cavalerie
    ennemie charge mal, sont préférées."""
    best, bv = (x, y), -1e9
    n = max(1, int(r // 40))
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            if i * i + j * j > n * n:
                continue
            px, py = x + i * 40, y + j * 40
            if not (30 < px < W - 30 and 30 < py < H - 30) or not b.passable(px, py, 'artillerie', side):
                continue
            if _rel(px, py, x, y, fd)[0] > ahead:
                continue
            t = b.terrain_at(px, py)
            if t == T_BATI:
                continue
            h = b.height_at(px, py)
            f = 0
            for d in (250, 450, 650):
                qx, qy = _at(px, py, fd, d)
                if 0 <= qx < W and 0 <= qy < H and b.los(px, py, qx, qy, GUN_EYE):
                    f += 1
            if f == 0:
                continue
            v = h / 12.0 + f * 0.8 - math.hypot(i, j) / n * 1.2
            if t in WOODS:
                v += 1.5 if wood else (0.6 if rough else -1.0)
            elif t == T_VIGNE_T and rough:
                v += 0.6
            if v > bv:
                best, bv = (px, py), v
    return best


def _open_flank(b, side, ax, ay, fd, width):
    """Le flanc le plus dégagé pour la cavalerie (-1 gauche, 1 droite)."""
    sc = {}
    for w in (-1, 1):
        n = 0
        for lat in (width / 2 + 200, width / 2 + 400, width / 2 + 600):
            for dep in (100, 350, 600, 850):
                x, y = _at(ax, ay, fd, dep, w * lat)
                if 0 <= x < W and 0 <= y < H and b.passable(x, y, 'cav', side) and b.terrain_at(x, y) not in ROUGH:
                    n += 1
        sc[w] = n
    return 1 if sc[1] >= sc[-1] else -1


# ====================================================================== plan
def _choose_plan(b, side, mem, L, g, pl):
    if pl:
        return 'assaut' if side == 0 else 'place'
    mine = sum(u.men for k in ('inf', 'light', 'cav', 'art', 'mil') for u in g[k])
    r = mine / max(1.0, mem['ann'])
    tr = b.trait(side)
    plans = b.spec.get('plans') or [None, None]
    camp = plans[side] if isinstance(plans, (list, tuple)) and len(plans) > side else None
    n = max(1, sum(len(g[k]) for k in ('inf', 'light', 'cav', 'art', 'mil')))
    ncav, nart = len(g['cav']), len(g['art'])
    harass = L['harass'] + (0.1 if tr == 'prudent' else 0.0) - (0.1 if tr == 'audacieux' else 0.0)
    if side == 0:
        if r < harass or (camp == 'harcelement' and r < 1.2):
            return 'harcelement'
        want = camp if camp in ('frontal', 'artillerie', 'debordement') else None
        if want == 'debordement' and (ncav == 0 or L['n'] == 0):
            want = None
        if want == 'artillerie' and nart == 0:
            want = None
        if want is None:
            if ncav >= 2 and ncav / n >= 0.15 and L['n'] >= 1 and tr == 'cavalier':
                want = 'debordement'
            elif nart and (tr == 'artilleur' or nart / n >= 0.15):
                want = 'artillerie'
            else:
                want = 'frontal'
        return want
    # défenseur en rase campagne : le harcèlement de la campagne est suivi ; son plan « frontal » (le plan ordinaire
    # de la campagne) ne devient une contre-offensive qu'avec une nette supériorité
    if r < harass - 0.1 or (camp == 'harcelement' and r < 1.2):
        return 'harcelement'
    if r >= L['counter_k'] or (tr == 'audacieux' and r >= L['counter_k'] * 0.8) or \
            (camp == 'frontal' and r >= max(1.25, L['counter_k'] * 0.8)):
        return 'frontal'
    return 'tenir'


# ====================================================================== déploiement
def deploy(battle, side):
    """Déploiement du camp side (unités commandées par l'IA). Sert aussi de placement de départ au camp du joueur
    (bridge.default_deploy) : il est alors fait au niveau normal, quelle que soit la difficulté, et sans mémoire."""
    b = battle
    us = b.ai_units(side)
    if not us:
        return
    player = side not in (getattr(b, 'ai_sides', None) or (0, 1))
    L, lname = (LEVELS['normal'], 'normal') if player else _lvl(b, side)
    mem = _mem(b, side)
    mem.clear()
    mem.update(v=1, lvl=lname, role={}, lat={}, back={}, wing={}, post={}, vu={}, vu0={}, sq={}, fm={}, gslot={},
               journal=[], next=0.0, rnext=0.0, phase='attente', t_phase=0.0, t_bound=0.0, mode='ligne', notes={})
    g = _groups(us)
    mem['ann'] = round(_announced(b, side))
    mem['init'] = round(sum(u.men for u in us if u.cls not in ('general', 'chariot')))
    lo, hi = L['halt']
    mem['halt_k'] = round(lo + (hi - lo) * _seed_rand(b, side, 1), 2)
    pl = b.place_info()
    plan = _choose_plan(b, side, mem, L, g, pl)
    mem['plan'] = mem['plan0'] = plan
    if pl and side == 1:
        _deploy_place_def(b, side, mem, L, g, pl)
    elif pl:
        _deploy_place_att(b, side, mem, L, g, pl)
    else:
        _deploy_field(b, side, mem, L, g, plan)
    if player:
        b.ai_mem.pop(f's{side}', None)   # (le joueur commande ce camp : l'IA n'en garde rien)
        return
    tr = b.trait(side)
    _note(b, mem, f"plan choisi : {PLAN_LABEL[plan]} (niveau {lname}"
                  f"{', général ' + tr if tr else ''}, {mem['init']} hommes contre {mem['ann']} annoncés).")


def _put(b, side, mem, u, x, y, d, form, role, lat=None):
    b.deploy(side, [u.id], x, y, d, form)
    mem['role'][u.id] = role
    mem['post'][u.id] = [round(u.x, 1), round(u.y, 1), round(d, 3)]
    dep, l = _rel(u.x, u.y, mem['ax'], mem['ay'], mem['fd'])
    mem['lat'][u.id] = round(l if lat is None else lat, 1)
    mem['back'][u.id] = round(-dep, 1)


def _split_line(g, plan):
    """Ligne et réserve d'infanterie."""
    inf = sorted(g['inf'], key=_quality, reverse=True)
    weak = [u for u in inf if u.type in ('sapeurs', 'garde')]
    inf = [u for u in inf if u not in weak]
    n = len(inf)
    nres = 0 if n <= 2 else 1 if n <= 5 else 2 if n <= 9 else 3
    if plan == 'tenir' and n >= 4:
        nres += 1
    if plan == 'harcelement':
        nres = max(0, nres - 1)
    gren = [u for u in inf if u.type == 'grenadiers']
    oth = [u for u in inf if u.type != 'grenadiers']
    res = (gren + oth[2:] + oth[:2])[:nres]
    line = [u for u in inf if u not in res] + g['mil']
    res += weak
    if not line and res:
        line.append(res.pop(0))
    return line, res


def _layout(units, half, gap=22.0):
    """Ordre de bataille : les meilleurs au centre, les autres alternés à droite et à gauche. → [(u, lat)], largeur."""
    us = sorted(units, key=_quality, reverse=True)
    row = []
    for k, u in enumerate(us):
        if k % 2:
            row.append(u)
        else:
            row.insert(0, u)
    tot = sum(_width(u) + gap for u in row)
    room = max(200.0, 2 * half - 260)
    k = 1.0 if tot <= room else max(0.55, room / tot)
    x = -tot * k / 2
    out = []
    for u in row:
        w = (_width(u) + gap) * k
        out.append((u, round(x + w / 2, 1)))
        x += w
    return out, tot * k


def _deploy_field(b, side, mem, L, g, plan):
    z = b.zone(side)
    fd = b.front_dir(side)
    c, s = math.cos(fd), math.sin(fd)
    cx, cy = (z[0] + z[2]) / 2, (z[1] + z[3]) / 2
    hw, hh = (z[2] - z[0]) / 2, (z[3] - z[1]) / 2
    reach = abs(c) * hw + abs(s) * hh
    half = abs(s) * hw + abs(c) * hh
    fx, fy = cx + c * reach, cy + s * reach          # milieu du bord de la zone, côté ennemi
    depth = 2 * reach
    line, res = _split_line(g, plan)
    slots, width = _layout(line, half)
    mem['width'] = round(width)
    if side == 1 and plan != 'harcelement':
        d_line = depth / 2
        if L['terrain']:
            best = None
            for d in range(40, int(depth) - 50, 20):
                ax, ay = _at(fx, fy, fd, -d)
                sc = _line_score(b, side, ax, ay, fd, width / 2) - d / 2500.0
                if best is None or sc > best[0]:
                    best = (sc, d)
            if best:
                d_line = best[1]
    elif side == 1:
        d_line = max(60.0, depth - 160)
    else:
        d_line = min(depth - 80, 110.0)
    ax, ay = _at(fx, fy, fd, -d_line)
    mem.update(ax=round(ax, 1), ay=round(ay, 1), fd=round(fd, 4), mode='poste' if side == 1 else 'ligne')
    mem['lat0'] = []
    for u, lat in slots:
        x, y = _at(ax, ay, fd, 0, lat)
        if L['terrain']:
            x, y = _best_depth(b, side, x, y, fd, L['span'])
        _put(b, side, mem, u, x, y, fd, 'ligne', 'ligne', lat)
        mem['lat0'].append(lat)
    # infanterie légère : en avant, dans les bois, les vignes ou le bâti
    nl = len(g['light'])
    for k, u in enumerate(g['light']):
        lat = 0.0 if nl == 1 else (k / (nl - 1) - 0.5) * (width + 120)
        x0, y0 = _at(ax, ay, fd, 110 if side == 1 else 90, lat)
        if L['terrain']:
            x0, y0 = _cover_spot(b, side, x0, y0, fd, 90 * L['r_k'])
        _put(b, side, mem, u, x0, y0, fd, 'tirailleurs', 'avant', lat)
    # artillerie : un peu en arrière de la ligne, sur une hauteur qui voit loin, ou en lisière (difficile)
    na = len(g['art'])
    for k, u in enumerate(g['art']):
        lat = (k - (na - 1) / 2) * (100 if plan == 'artillerie' else 160)
        x0, y0 = _at(ax, ay, fd, -40, lat)
        if L['terrain']:
            x0, y0 = _gun_spot(b, side, x0, y0, fd, 110 * L['r_k'], wood=L['wood'],
                               ahead=15, rough=True)
        _put(b, side, mem, u, x0, y0, fd, 'batterie', 'art', lat)
    # cavalerie aux ailes (l'aile du débordement en a davantage), réserve de cavalerie en difficile
    cav = sorted(g['cav'], key=_quality, reverse=True)
    flank = _open_flank(b, side, ax, ay, fd, width) if plan == 'debordement' else 0
    mem['flank'] = flank
    keep = []
    if L['n'] == 2 and len(cav) >= 3 and plan != 'debordement':
        keep = [cav.pop(0)]
    nw = {1: 0, -1: 0}
    for k, u in enumerate(cav):
        if flank:
            w = flank if (k % 3 != 2 or len(cav) < 3) else -flank
        else:
            w = 1 if k % 2 == 0 else -1
        lat = w * (width / 2 + 110 + 120 * nw[w])
        nw[w] += 1
        x0, y0 = _at(ax, ay, fd, -70, lat)
        _put(b, side, mem, u, x0, y0, fd, 'ligne', 'cav', lat)
        mem['wing'][u.id] = w
    for u in keep:
        x0, y0 = _at(ax, ay, fd, -260, 0)
        _put(b, side, mem, u, x0, y0, fd, 'ligne', 'cav', 0.0)
        mem['wing'][u.id] = 0
    # réserve, état-major, chariot
    nr = len(res)
    for k, u in enumerate(res):
        lat = (k - (nr - 1) / 2) * 90
        x0, y0 = _at(ax, ay, fd, -(230 if side == 0 else 200), lat)
        _put(b, side, mem, u, x0, y0, fd, 'colonne', 'res', lat)
    for u in g['gen']:
        x0, y0 = _at(ax, ay, fd, -170)
        _put(b, side, mem, u, x0, y0, fd, None, 'gen', 0.0)
    for k, u in enumerate(g['wagon']):
        x0, y0 = _at(ax, ay, fd, -(150 if side == 1 else 240), 40 * k)
        if L['terrain']:
            x0, y0 = b.best_spot(x0, y0, 60, 'cover', side, cls='artillerie')
        _put(b, side, mem, u, x0, y0, fd, None, 'wagon', 40 * k)


# ---------------------------------------------------------------------- places
def _walls(b):
    m = getattr(b, 'map', None)
    return list(getattr(m, 'walls', None) or [])


def _ring(b, pl):
    """Rayon intérieur de l'enceinte ou des barricades dans 24 directions (None s'il n'y en a pas)."""
    px, py, R = pl['x'], pl['y'], pl['r']
    out = []
    for k in range(24):
        a = k * math.pi / 12
        r, hit = 20.0, None
        while r < R + 160:
            x, y = px + math.cos(a) * r, py + math.sin(a) * r
            if not (0 <= x < W and 0 <= y < H):
                break
            if b.terrain_at(x, y) in WALLS:
                hit = r
                break
            r += 10.0
        out.append(hit)
    return out


def _ring_at(mem, a, default):
    ring = mem.get('ring') or []
    if not ring:
        return default
    k = int(round((a % (2 * math.pi)) / (math.pi / 12))) % 24
    for dk in (0, 1, -1, 2, -2):
        r = ring[(k + dk) % 24]
        if r is not None:
            return r
    return default


def _breaches(b):
    out = []
    for w in _walls(b):
        for br in w.get('breach') or []:
            out.append((float(br[0]), float(br[1]), float(br[2])))
    return out


def _deploy_place_def(b, side, mem, L, g, pl):
    px, py, R = pl['x'], pl['y'], pl['r']
    heart = b.objective() or (px, py)
    z0 = b.zone(0)
    ex, ey = (z0[0] + z0[2]) / 2, (z0[1] + z0[3]) / 2
    fa = math.atan2(ey - py, ex - px)                 # d'où vient l'assaillant
    mem.update(ax=round(px, 1), ay=round(py, 1), fd=round(fa, 4), mode='poste', heart=list(heart))
    ring = _ring(b, pl)
    mem['ring'] = [None if r is None else round(r) for r in ring]
    walled = any(r is not None for r in ring)
    r_def = (R * 0.8) if not walled else None
    # brèches : un bataillon de chaque côté, à l'intérieur, à l'abri du mur (les canons du dehors ne le voient pas à
    # travers la brèche) ; les colonnes qui la franchissent sont prises entre deux feux
    posts = []                                        # (x, y, dir, genre)
    centers = []
    for bx, by, br in sorted(_breaches(b), key=lambda t: _ang(math.atan2(t[1] - py, t[0] - px), fa)):
        a = math.atan2(by - py, bx - px)
        ri = _ring_at(mem, a, math.hypot(bx - px, by - py) - 10)
        cx_, cy_ = px + math.cos(a) * (ri - 30), py + math.sin(a) * (ri - 30)
        ox, oy = px + math.cos(a) * (ri + 50), py + math.sin(a) * (ri + 50)
        centers.append([round(cx_), round(cy_), round(a, 3)])
        da = (br + 55) / max(60.0, ri)
        for sgn in (1, -1):
            aa = a + sgn * da
            rr = _ring_at(mem, aa, ri) - 22
            x, y = px + math.cos(aa) * rr, py + math.sin(aa) * rr
            posts.append((x, y, math.atan2(oy - y, ox - x), 'breche'))
    mem['breach'] = centers
    wall_posts = []
    for k in (0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 8, -8, 10, -10, 12):
        a = fa + k * 0.38
        ri = _ring_at(mem, a, None) if walled else None
        if walled and ri is None:
            continue
        r = (ri - 12) if ri is not None else r_def
        x, y = px + math.cos(a) * r, py + math.sin(a) * r
        if any(_d2(x, y, q[0], q[1]) < 90 ** 2 for q in posts + wall_posts):
            continue
        wall_posts.append((x, y, a, 'mur'))
    inf = sorted(g['inf'], key=_quality, reverse=True)
    strong = [u for u in inf if u.type not in ('sapeurs', 'garde')]
    weak = [u for u in inf if u not in strong]
    used = set()
    nb = len(posts)
    # brèches : les meilleurs bataillons ; la réserve : un bon bataillon au cœur
    res = []
    if len(strong) > nb + 1:
        pick = next((u for u in strong if u.type == 'grenadiers'), strong[0])
        strong.remove(pick)
        res.append(pick)
    for (x, y, a, _k), u in zip(posts, strong):
        _put(b, side, mem, u, x, y, a, 'ligne', 'breche')
        used.add(u.id)
    rest = [u for u in strong if u.id not in used]
    # remparts : légers d'abord, puis l'infanterie, les canons au plus près de l'assaillant
    wp = list(wall_posts)
    for u in g['art']:
        if not wp:
            break
        x, y, a, _ = wp.pop(0)
        _put(b, side, mem, u, x, y, a, 'batterie', 'art')
    for u in g['light'] + rest + weak:
        if wp:
            x, y, a, _ = wp.pop(0)
            _put(b, side, mem, u, x, y, a, 'tirailleurs' if u.light else 'ligne', 'mur')
        else:
            res.append(u)
    # milice : dans les rues entre le mur et le cœur, et au cœur
    mil = g['mil']
    for k, u in enumerate(mil):
        if k == 0:
            x, y = heart[0] + math.cos(fa) * 30, heart[1] + math.sin(fa) * 30
            role = 'coeur'
        else:
            a = fa + ((k + 1) // 2) * 0.7 * (1 if k % 2 else -1)
            r = R * 0.5
            x, y = px + math.cos(a) * r, py + math.sin(a) * r
            role = 'rue'
        _put(b, side, mem, u, x, y, fa, 'ligne', role)
    for k, u in enumerate(res):
        x, y = heart[0] + math.cos(fa) * 60 - math.sin(fa) * (k - (len(res) - 1) / 2) * 60, \
            heart[1] + math.sin(fa) * 60 + math.cos(fa) * (k - (len(res) - 1) / 2) * 60
        _put(b, side, mem, u, x, y, fa, 'colonne', 'res')
    for k, u in enumerate(g['cav']):
        x, y = heart[0] - math.cos(fa) * 60 + 50 * k, heart[1] - math.sin(fa) * 60
        _put(b, side, mem, u, x, y, fa, 'ligne', 'cav')
        mem['wing'][u.id] = 0
    for u in g['gen']:
        _put(b, side, mem, u, heart[0] - math.cos(fa) * 20, heart[1] - math.sin(fa) * 20, fa, None, 'gen')
    for u in g['wagon']:
        _put(b, side, mem, u, heart[0] - math.cos(fa) * 90, heart[1] - math.sin(fa) * 90, fa, None, 'wagon')
    mem['r_in'] = round(min([r for r in ring if r is not None], default=R))


def _deploy_place_att(b, side, mem, L, g, pl):
    px, py, R = pl['x'], pl['y'], pl['r']
    heart = b.objective() or (px, py)
    z = b.zone(side)
    zx, zy = (z[0] + z[2]) / 2, (z[1] + z[3]) / 2
    fa = math.atan2(zy - py, zx - px)                 # de la place vers l'assaillant
    ring = _ring(b, pl)
    mem['ring'] = [None if r is None else round(r) for r in ring]
    brs = sorted(_breaches(b), key=lambda t: _ang(math.atan2(t[1] - py, t[0] - px), fa))
    if brs:
        a_b = math.atan2(brs[0][1] - py, brs[0][0] - px)
    else:
        a_b = fa
    ri = _ring_at(mem, a_b, R + 15)
    bout = (px + math.cos(a_b) * (ri + 60), py + math.sin(a_b) * (ri + 60))
    bin_ = (px + math.cos(a_b) * (ri - 50), py + math.sin(a_b) * (ri - 50))
    # diversion : une autre brèche, ou une autre face de l'enceinte
    if len(brs) > 1:
        a_d = math.atan2(brs[-1][1] - py, brs[-1][0] - px)
        if _ang(a_d, a_b) < 0.5:
            a_d = a_b + 1.0
    else:
        a_d = a_b + (1.0 if _seed_rand(b, side, 3) < 0.5 else -1.0)
    rd = _ring_at(mem, a_d, R + 15)
    dpt = (px + math.cos(a_d) * (rd + 70), py + math.sin(a_d) * (rd + 70))
    # point de rassemblement : à l'avant de la zone, face à la brèche
    stx, sty = bout
    ux, uy = zx - stx, zy - sty
    n = math.hypot(ux, uy) or 1.0
    ux, uy = ux / n, uy / n
    for _ in range(300):
        if z[0] + 50 <= stx <= z[2] - 50 and z[1] + 50 <= sty <= z[3] - 50:
            break
        stx, sty = stx + ux * 20, sty + uy * 20
    fd = math.atan2(bout[1] - sty, bout[0] - stx)
    mem.update(ax=round(stx, 1), ay=round(sty, 1), fd=round(fd, 4), mode='poste', heart=list(heart),
               bout=[round(bout[0]), round(bout[1])], bin=[round(bin_[0]), round(bin_[1])],
               div=[round(dpt[0]), round(dpt[1])], a_b=round(a_b, 3), r_in=round(ri))
    inf = sorted(g['inf'] + g['mil'], key=_quality, reverse=True)
    lights, cavs = list(g['light']), list(g['cav'])
    # sans assez d'infanterie de ligne (la campagne envoie souvent un bataillon léger ou des cavaliers prendre un
    # village), les légers forment les colonnes d'assaut ; sans aucun fantassin, les cavaliers donnent l'assaut
    while len(inf) < 2 and lights:
        inf.append(lights.pop(0))
    if not inf and cavs:
        inf, cavs = cavs, []
    n_inf = len(inf)
    n1 = max(1, min(4, (n_inf + 1) // 2))
    first = inf[:n1]
    div = []
    rest = inf[n1:]
    if len(rest) >= 3 and L['n'] >= 1:
        div.append(rest.pop())
    second = rest
    for k, u in enumerate(first):
        x, y = _at(stx, sty, fd, 0, (k - (n1 - 1) / 2) * 70)
        _put(b, side, mem, u, x, y, fd, 'colonne', 'assaut', (k - (n1 - 1) / 2) * 70)
    for k, u in enumerate(second):
        lat = (k - (len(second) - 1) / 2) * 110
        x, y = _at(stx, sty, fd, -170, lat)
        _put(b, side, mem, u, x, y, fd, 'colonne', 'vague2', lat)
    # diversion : un bataillon et les légers, déployés vers l'autre face
    sgn = 1 if _rel(dpt[0], dpt[1], stx, sty, fd)[1] >= 0 else -1
    if L['n'] >= 1 and lights:
        div.append(lights.pop(0))
    for k, u in enumerate(div):
        x, y = _at(stx, sty, fd, -40, sgn * (330 + 90 * k))
        _put(b, side, mem, u, x, y, fd, 'tirailleurs' if u.light else 'colonne', 'diversion', sgn * (330 + 90 * k))
    for k, u in enumerate(lights):
        x, y = _at(stx, sty, fd, 60, (k - (len(lights) - 1) / 2) * 160)
        if L['terrain']:
            x, y = _cover_spot(b, side, x, y, fd, 120)
        _put(b, side, mem, u, x, y, fd, 'tirailleurs', 'avant')
    na = len(g['art'])
    for k, u in enumerate(g['art']):
        lat = (k - (na - 1) / 2) * 120 + (-sgn * 150)
        x, y = _at(stx, sty, fd, -30, lat)
        if L['terrain']:
            x, y = _gun_spot(b, side, x, y, fd, 90 * L['r_k'], rough=True)
        _put(b, side, mem, u, x, y, fd, 'batterie', 'art', lat)
    for k, u in enumerate(cavs):
        w = 1 if k % 2 == 0 else -1
        x, y = _at(stx, sty, fd, -260, w * (220 + 100 * (k // 2)))
        _put(b, side, mem, u, x, y, fd, 'ligne', 'cav', w * 220)
        mem['wing'][u.id] = w
    for u in g['gen']:
        _put(b, side, mem, u, *_at(stx, sty, fd, -240), fd, None, 'gen', 0.0)
    for u in g['wagon']:
        _put(b, side, mem, u, *_at(stx, sty, fd, -330, 60), fd, None, 'wagon', 60.0)
    mem['n_assault'] = round(sum(u.men for u in first + second))


# ====================================================================== réflexion
def think(battle, side, dt):
    b = battle
    if b.phase != 'combat' or b.withdrawing[side]:
        return
    us = b.ai_units(side)
    if not us:
        return
    L, lname = _lvl(b, side)
    mem = _mem(b, side)
    if not mem.get('role'):
        _adopt(b, side, mem, L, lname, us)
    foes = _picture(b, side, mem)
    now = b.clock
    if now >= mem.get('rnext', 0.0):
        mem['rnext'] = now + L['reflex'] - 0.01
        _reflexes(b, side, mem, L, us, foes)
    if now < mem.get('next', 0.0):
        return
    mem['next'] = now + L['period'] + (b.rng.random() * L['jitter'] if L['jitter'] else 0.0)
    _heavy(b, side, mem, L, us, foes)


def _adopt(b, side, mem, L, lname, us):
    """Mémoire absente (bataille d'une ancienne sauvegarde, unités passées sous le contrôle de l'IA) : on reprend
    la situation telle qu'elle est."""
    mem.clear()
    g = _groups(us)
    mem.update(v=1, lvl=lname, role={}, lat={}, back={}, wing={}, post={}, vu={}, vu0={}, sq={}, fm={}, gslot={},
               journal=[], next=0.0, rnext=0.0, phase='attente', t_phase=b.clock, t_bound=0.0, notes={})
    mem['ann'] = round(_announced(b, side))
    mem['init'] = round(sum(u.men0 for u in us if u.cls not in ('general', 'chariot')))
    mem['halt_k'] = round(sum(L['halt']) / 2, 2)
    pl = b.place_info()
    plan = _choose_plan(b, side, mem, L, g, pl)
    mem['plan'] = mem['plan0'] = plan
    if plan == 'assaut':
        # assaut d'une place : le plan du déploiement (colonnes face à la brèche, seconde vague, diversion, canons),
        # chacun gardant sa place du moment pour poste (la bataille est engagée : b.deploy ne déplace plus personne).
        # (En assaut frontal, la ligne s'arrêtait hors de vue des défenseurs abrités et attendait la nuit.)
        _deploy_place_att(b, side, mem, L, g, pl)
        # la préparation d'artillerie compte depuis le début de la bataille, comme si l'IA l'avait menée (sinon une
        # reprise en plein combat repartait pour une heure de canonnade avant le premier assaut)
        mem.update(phase='prepa', t_phase=0.0)
        _note(b, mem, f"l'IA reprend le commandement : {PLAN_LABEL[plan]}.")
        return
    fd = b.front_dir(side)
    combat = [u for u in us if u.cls in ('inf', 'cavalerie', 'artillerie')] or us
    ax = sum(u.x for u in combat) / len(combat)
    ay = sum(u.y for u in combat) / len(combat)
    mem.update(ax=round(ax, 1), ay=round(ay, 1), fd=round(fd, 4), mode='poste' if plan in ('tenir', 'place') else 'ligne')
    if pl:
        mem['heart'] = list(b.objective() or (pl['x'], pl['y']))
        mem['r_in'] = pl['r']
        mem['ring'] = [None if r is None else round(r) for r in _ring(b, pl)]
        mem['breach'] = []
    mem['lat0'] = []
    for u in us:
        _adopt_unit(mem, u)
    mem['width'] = round(max(200.0, 2 * max([abs(v) for k, v in mem['lat'].items()
                                               if mem['role'].get(k) == 'ligne'] or [100.0]) + 120))
    _note(b, mem, f"l'IA reprend le commandement : {PLAN_LABEL[plan]}.")


def _adopt_unit(mem, u):
    c = _cat(u)
    role = dict(gen='gen', wagon='wagon', art='art', cav='cav', light='avant').get(c, 'ligne')
    if mem.get('plan') == 'place' and role == 'ligne':
        role = 'mur'
    mem['role'][u.id] = role
    dep, lat = _rel(u.x, u.y, mem['ax'], mem['ay'], mem['fd'])
    mem['lat'][u.id] = round(lat, 1)
    mem['back'][u.id] = round(-dep, 1) if role != 'ligne' else 0.0
    mem['post'][u.id] = [round(u.x, 1), round(u.y, 1), round(mem['fd'], 3)]
    if role == 'cav':
        mem['wing'][u.id] = 1 if lat > 0 else -1
    if role == 'ligne':
        mem.setdefault('lat0', []).append(round(lat, 1))


def _picture(b, side, mem):
    """Ce que le camp voit maintenant, et ce dont il se souvient (dernières positions, effectifs, état)."""
    now = round(b.clock)
    vu, vu0 = mem.setdefault('vu', {}), mem.setdefault('vu0', {})
    foes = b.visible_enemies(side)
    for e in foes:
        vu[e.id] = [round(e.x), round(e.y), now, round(e.men), e.cls, e.form, e.state, round(e.morale), round(e.dir, 2),
                    (b.ranges(e)[2] or 0) if e.cls == 'artillerie' else 0]
        if e.cls not in ('general', 'chariot') and e.id not in vu0:
            vu0[e.id] = round(e.men0)
    return foes


def _foe_est(mem):
    """Estimation des forces ennemies : ce qu'on a vu (sauf les troupes vues en déroute), et l'effectif annoncé des
    unités jamais vues."""
    vu, vu0 = mem['vu'], mem['vu0']
    known = sum(v[3] for k, v in vu.items() if k in vu0 and v[6] not in ('deroute', 'hors'))
    unseen = max(0.0, mem.get('ann', 0) - sum(vu0.values()))
    return known + unseen


def _body(b, mem, maxage=150.0):
    """Le gros de l'ennemi (infanterie et artillerie) d'après les repérages récents : [(id, x, y, cls, form)]."""
    now = b.clock
    out = []
    for k, v in mem['vu'].items():
        if now - v[2] > maxage or v[6] in ('deroute', 'hors'):
            continue
        if v[4] in ('inf', 'artillerie'):
            out.append((k, v[0], v[1], v[4], v[5]))
    return out


# ---------------------------------------------------------------------- réflexes
def _reflexes(b, side, mem, L, us, foes):
    cavs = [e for e in foes if e.cls == 'cavalerie' and e.valid]
    for u in us:
        st = u.state
        if st == 'deroute':
            if L['n'] or b.rng.random() < 0.5:
                b.order(side, [u.id], 'rally')   # le moteur refuse si l'ennemi est trop près
            continue
        if u.cls != 'inf' or st in ('melee', 'charge', 'ralliement'):
            continue
        _square(b, side, mem, L, u, cavs, foes)
    if L['counter'] and cavs:
        _counter_charge(b, side, mem, us, cavs, foes)


def _square(b, side, mem, L, u, cavs, foes=()):
    """Carré quand des cavaliers menacent ; on reprend sa formation quand ils s'éloignent. Pas de carré sous le fusil
    de l'infanterie ennemie (à moins de 200 m), ni dans la mitraille d'une batterie ennemie connue, tant que les
    cavaliers ne chargent pas cette troupe : le carré y serait fusillé sans pouvoir répondre. Des cavaliers qui
    marchent vers nous ne menacent qu'à moins des trois quarts de sq_r (au pas, ils ne surprennent personne)."""
    now = b.clock
    best, bd = None, 1e9
    for e in cavs:
        d = math.hypot(e.x - u.x, e.y - u.y)
        if d < bd:
            best, bd = e, d
    sq = mem['sq']
    want = False
    if best is not None and bd < L['sq_r'] and b.terrain_at(u.x, u.y) not in ROUGH:
        coming = best.state == 'charge' or bd < L['sq_r'] * 0.5 or \
            (best.state == 'marche' and _ang(best.dir, math.atan2(u.y - best.y, u.x - best.x)) < 0.6 and
             (L['n'] == 0 or bd < L['sq_r'] * 0.75))
        want = coming and (L['n'] == 0 or _charge_ok(b, best.side, best, u))   # (rochers, forêt, eau : pas de charge)
        if want and L['n'] >= 1 and u.form in ('ligne', 'colonne') and u.busy <= 0 and u.morale >= BT.FORMED + 10 \
                and u.ammo >= 1 and _ang(u.dir, math.atan2(best.y - u.y, best.x - u.x)) < 1.0:
            # une ligne ferme qui voit venir la charge de face la reçoit par son feu (le moteur la repousse)
            want = False
    shot = L['n'] >= 1 and best is not None and not (best.state == 'charge' and best.target == u.id) and \
        (any(e.cls == 'inf' and e.valid and _d2(e.x, e.y, u.x, u.y) < 200 ** 2 for e in foes) or
         any(_d2(gx, gy, u.x, u.y) < gr * gr for gx, gy, gr, gid in _gun_zones(b, mem, 300.0)))
    if shot:
        want = False
    forming = u.busy > 0 and u.next_form == 'carre'
    if want and u.form != 'carre' and not forming:
        if not L['sq_late'] and best.state == 'charge' and bd < 110:
            return   # trop tard : pris en pleine manœuvre, ce serait pire
        if L['sq_miss'] and b.rng.random() < L['sq_miss']:
            return
        _form(b, side, u, 'carre')
        sq[u.id] = round(now)
        if not mem['notes'].get('carre'):
            mem['notes']['carre'] = 1
            _note(b, mem, f"des cavaliers menacent : {u.name} forme le carré.")
    elif not want and (u.form == 'carre' or forming):
        far = best is None or bd > L['sq_r'] * 0.9 or shot
        if far and now - sq.get(u.id, -999) > 40:
            role = mem['role'].get(u.id)
            back = 'tirailleurs' if u.light else ('colonne' if role in ('res', 'assaut', 'vague2') else 'ligne')
            if _form(b, side, u, back) or (u.busy > 0 and u.next_form == back):
                sq.pop(u.id, None)
            mem['fm'][u.id] = round(now)


def _charge_ok(b, side, u, e):
    """La charge peut-elle aller droit au but ? (le moteur charge en ligne droite ; rochers, eau, forêt l'arrêtent)"""
    mc = 'cav' if u.cls == 'cavalerie' else ('light' if u.light else 'inf')
    dx, dy = e.x - u.x, e.y - u.y
    n = max(1, int(math.hypot(dx, dy) // 25))
    for k in range(1, n):
        x, y = u.x + dx * k / n, u.y + dy * k / n
        if not b.passable(x, y, mc, side) or (mc == 'cav' and b.terrain_at(x, y) in (T_FORET_T, T_MARAIS_T, T_ROCHE)):
            return False
    return True


def _counter_charge(b, side, mem, us, cavs, foes):
    """La cavalerie ennemie qui charge nos troupes, ou qui s'y est engagée, est chargée à son tour : avec assez
    d'escadrons pour l'emporter, et pas sous le nez de son infanterie."""
    mine = [u for u in us if u.cls == 'cavalerie' and u.valid and u.state not in ('charge', 'melee') and u.busy <= 0
            and u.morale > 45 and u.men > 0.3 * u.men0 and not (u.order and u.order.get('kind') == 'attack' and u.path)]
    if not mine:
        return
    ours = [o for o in us if o.cls in ('inf', 'artillerie') and o.alive]
    e_inf = [f for f in foes if f.cls == 'inf' and f.valid]
    for e in cavs:
        if e.state not in ('melee', 'charge') or not mine:
            continue
        if not any(_d2(o.x, o.y, e.x, e.y) < 300 ** 2 for o in ours):
            continue
        if any(_d2(f.x, f.y, e.x, e.y) < 120 ** 2 for f in e_inf):
            continue   # escortée par son infanterie : nos cavaliers s'y feraient massacrer
        foe_men = sum(c.men for c in cavs if _d2(c.x, c.y, e.x, e.y) < 220 ** 2)
        cand = sorted((c for c in mine if _d2(c.x, c.y, e.x, e.y) < 600 ** 2), key=lambda c: _d2(c.x, c.y, e.x, e.y))
        got, men = [], 0.0
        for c in cand:
            if _charge_ok(b, side, c, e):
                got.append(c)
                men += c.men
                if men >= 0.8 * foe_men:
                    break
        if not got or men < 0.55 * foe_men:
            continue
        for c in got:
            b.order(side, [c.id], 'charge', target=e.id)
            mine.remove(c)
        _note_once(b, mem, f"cc{e.id}", f"{' et '.join(c.name for c in got)} contre-charge{'nt' if len(got) > 1 else ''}"
                                         f" les cavaliers ennemis ({_foe(e)}).", 300)


# ---------------------------------------------------------------------- réflexion lourde
def _heavy(b, side, mem, L, us, foes):
    for u in us:
        if u.id not in mem['role']:
            _adopt_unit(mem, u)
    sit = _situation(b, mem, us, foes)
    if _decide_withdraw(b, side, mem, L, sit):
        return
    want = {}
    busy = set()
    plan = mem['plan']
    if plan == 'place':
        _think_place_def(b, side, mem, L, us, foes, sit, want, busy)
    elif plan == 'assaut':
        _think_place_att(b, side, mem, L, us, foes, sit, want, busy)
    else:
        _think_field(b, side, mem, L, us, foes, sit, want, busy)
    _support(b, side, mem, L, us, foes, sit, want)
    _cavalry(b, side, mem, L, us, foes, sit, want, busy)
    _bayonets(b, side, mem, L, us, foes, sit, busy)
    _artillery(b, side, mem, L, us, foes, sit, want, busy)
    _apply(b, side, mem, us, want, busy)


def _situation(b, mem, us, foes):
    combat = [u for u in us if u.cls in ('inf', 'cavalerie', 'artillerie')]
    valid = [u for u in combat if u.valid]
    # (une troupe en déroute compte pour moitié : la plupart se rallient quelques minutes plus tard)
    mine = sum(u.men for u in valid) + 0.5 * sum(u.men for u in combat if u.state == 'deroute')
    init = mem.get('init') or mine
    foe = _foe_est(mem)
    mor = sum(u.morale * u.men for u in valid) / max(1.0, mine)
    routed = sum(1 for u in combat if u.state == 'deroute')
    now = b.clock
    e_routed = sum(1 for v in mem['vu'].values() if v[6] == 'deroute' and now - v[2] < 300)
    seen = [e for e in foes if e.valid]
    if seen and mem.get('t_contact') is None:
        mem['t_contact'] = round(now)
        e = min(seen, key=lambda e: min((_d2(e.x, e.y, u.x, u.y) for u in combat), default=0))
        _note(b, mem, f"premier contact : {_foe(e)} repéré.")
    return dict(combat=combat, valid=valid, mine=mine, init=init, foe=foe, ratio=mine / max(1.0, foe),
                loss=1 - mine / max(1.0, init), mor=mor, routed=routed, e_routed=e_routed, seen=seen)


def _stalled(b, mem, sit, line=None):
    """Rien ne bouge depuis 45 min : les effectifs des deux camps (vus) n'ont presque pas changé ; ou notre ligne
    n'a pas tiré un coup de fusil depuis 30 min alors que l'ennemi n'a presque rien perdu (on se fait canonner de loin
    sans pouvoir répondre)."""
    now = b.clock
    hist = _history(b, mem, sit)
    old = [h for h in hist if now - h[0] >= 2700]
    if mem.get('t_contact') is None:
        return False
    if line and mem.get('phase') == 'combat' and now - mem.get('t_phase', now) > 1800 and \
            now - max(u.fired_t for u in line) > 1800:
        h30 = [h for h in hist if now - h[0] >= 1800]
        if h30 and h30[-1][2] - sit['foe'] < 0.02 * max(1, h30[-1][2]):
            return True
    if not old:
        return False
    h = old[-1]
    return h[1] - sit['mine'] < 0.01 * max(1, h[1]) and h[2] - sit['foe'] < 0.01 * max(1, h[2])


def _history(b, mem, sit):
    """Effectifs des deux camps (le nôtre, l'ennemi estimé), relevés toutes les 5 min (une heure au plus)."""
    hist = mem.setdefault('hist', [])
    if not hist or b.clock - hist[-1][0] >= 300:
        hist.append([round(b.clock), round(sit['mine']), round(sit['foe'])])
        if len(hist) > 12:
            del hist[:len(hist) - 12]
    return hist


def _tenacity(b, side, mem, L, sit):
    """Obstination selon la situation : supplément de pertes accepté avant de décrocher (négatif : on décroche plus
    tôt). On s'accroche quand on a l'avantage — l'ennemi a perdu plus d'hommes que nous (d'après ses effectifs vus),
    le rapport de forces vu est favorable, des troupes ennemies sont en déroute, il nous reste des réserves fraîches —
    ou qu'on tient une position clé (la ligne du défenseur sur une crête, derrière des haies, des murets, dans un
    village) ; sans rien de tout cela, on décroche plus tôt (TEN_NONE). Rase campagne seulement (l'assaut et la défense
    d'une place ont leurs propres règles). Renvoie (supplément, raisons)."""
    if mem['plan'] in ('place', 'assaut') or mem.get('t_contact') is None or not L.get('ten_k', 1.0):
        return 0.0, []   # (facile : ne lit pas la situation)
    k, why = 0.0, []
    # tués, blessés et prisonniers des deux camps (les nôtres ; ceux de l'ennemi d'après ses effectifs vus)
    ours = [u for u in b.units if u.side == side and u.cls in ('inf', 'cavalerie', 'artillerie')]
    cas = sum(u.men0 - u.men for u in ours) / max(1.0, sum(u.men0 for u in ours))
    vu, vu0 = mem['vu'], mem['vu0']
    e_cas = sum(max(0, n0 - vu[k_][3]) for k_, n0 in vu0.items() if k_ in vu) / max(1.0, mem.get('ann') or 1)
    # (à couvert, le défenseur perd d'ordinaire moins que l'assaillant : chacun juge l'échange à cette aune)
    d = e_cas * EXCHANGE - cas if side == 0 else e_cas - cas * EXCHANGE
    if d > 0.02:
        k += min(TEN_TRIED, TEN_TRIED_K * d)
        why.append(f"l'ennemi a perdu davantage ({round(e_cas * 100)} % contre {round(cas * 100)} %)")
    if sit['ratio'] >= 1.15:
        k += TEN_RATIO
        why.append('rapport de forces favorable')
    inf = [e for e in sit['seen'] if e.cls == 'inf']
    shaken = inf and sum(e.morale for e in inf) / len(inf) < 50
    if sit['e_routed'] >= 2 or shaken:
        k += TEN_ROUT
        why.append('l\'ennemi a des troupes en déroute' if sit['e_routed'] >= 2 else 'l\'ennemi est ébranlé')
    fresh = sum(u.men for u in sit['valid'] if mem['role'].get(u.id) in ('res', 'garde_flanc') and u.morale > 60
                and u.ammo > 0.5 * u.ammo0 and u.cls == 'inf')
    if fresh > 0.12 * max(1.0, sit['init']):
        k += TEN_RES
        why.append('des réserves fraîches')
    if side == 1 and mem.get('mode') == 'poste':
        line = [u for u in sit['valid'] if mem['role'].get(u.id) == 'ligne']
        body = _body(b, mem)
        eh = sum(b.height_at(x, y) for _, x, y, _c, _f in body) / len(body) if body else None
        held = sum(u.men for u in line if b.cover_at(u.x, u.y) >= 0.2 or b.feature_at(u.x, u.y) >= 2 or
                   (eh is not None and b.height_at(u.x, u.y) > eh + 8))
        if line and held >= 0.4 * sum(u.men for u in line):
            k += TEN_POS
            why.append('la position est bonne')
    if not why:
        return TEN_NONE, []
    return min(TEN_MAX, k) * L.get('ten_k', 1.0), why


def _decide_withdraw(b, side, mem, L, sit):
    """Décrocher quand la bataille est perdue (jamais pour le défenseur d'une place)."""
    plan = mem['plan']
    if plan == 'place' or not sit['combat']:
        return False
    _history(b, mem, sit)
    why = None
    tr = b.trait(side)
    k = 0.08 if tr == 'prudent' else (-0.05 if tr == 'audacieux' else 0.0)
    if side == 0 and plan in ('frontal', 'artillerie', 'debordement'):
        k -= L.get('wd_att', ATT_TENACITY)   # l'assaillant accepte des pertes plus lourdes pour emporter la position
    ten, ten_why = _tenacity(b, side, mem, L, sit)
    k -= ten
    if plan == 'harcelement' and mem.get('t_contact') is not None:
        if b.clock - mem['t_contact'] > mem.get('harass_t', 2700) or sit['loss'] > 0.18:
            why = "l'escarmouche a assez duré"
    # (les pertes comptent pour moitié les troupes en déroute : un camp qui en a plusieurs à la fois plie)
    def heavy(k):
        return (sit['loss'] > L['wd_loss'] - k and sit['ratio'] < L['wd_ratio'] + 0.1) or \
            (sit['loss'] > L['wd_loss'] + L.get('wd_even_loss', WD_EVEN_LOSS) - k and
             sit['ratio'] < L['wd_ratio'] + L.get('wd_even', WD_EVEN))   # (combat égal qui s'éternise : le plus éprouvé cède)
    if ten > 0 and not heavy(k) and heavy(k + ten):
        _note_once(b, mem, 'tenace', f"l'armée s'accroche malgré {round(sit['loss'] * 100)} % de pertes : "
                                     f"{', '.join(ten_why)}.", 1200)
    if heavy(k):
        why = 'pertes trop lourdes'
    elif sit['ratio'] < 0.45 and sit['loss'] > 0.2:
        why = "l'ennemi est bien plus fort"
    elif sit['valid'] and sit['mor'] < 32 and sit['routed'] >= len(sit['valid']):
        why = 'le moral est brisé'
    elif side == 0 and b.time_left() < 900 and sit['ratio'] < 1.6 and mem.get('t_contact') is not None:
        why = 'la nuit tombe'
    elif side == 0 and plan != 'harcelement' and \
            _stalled(b, mem, sit, [u for u in sit['valid'] if mem['role'].get(u.id) == 'ligne' and u.cls == 'inf']):
        # (les combats durent : une ligne qui ne gagne plus de terrain n'est pas battue, elle serre au plus près ;
        # on ne décroche qu'après un assaut général manqué, ou nettement plus faible)
        # (assaut d'une place : l'assaut général est une nouvelle vague ; ses vagues lancées, on n'annonce plus rien)
        quiet = plan == 'assaut' and mem.get('waves', 0) >= L.get('waves', ASSAULT_WAVES)
        if sit['ratio'] >= 0.85 and L['n'] >= 1 and not mem.get('general_assault'):
            mem['general_assault'] = round(b.clock)
            mem['halt_k'] = round(mem.get('halt_k', 0.85) * 0.5, 2)
            if not quiet:
                _note(b, mem, f"l'attaque piétine : assaut général (rapport de forces vu {sit['ratio']:.2f}).")
        elif sit['ratio'] < 0.7 or (b.clock - mem.get('general_assault', b.clock) > 2700 and sit['ratio'] < 1.2):
            why = "l'attaque piétine"
        elif b.clock - mem.get('general_assault', b.clock) > 2700:
            # (nettement plus fort : on ne lâche pas, on relance l'assaut)
            mem['general_assault'] = round(b.clock)
            if not quiet:
                _note(b, mem, f"nouvel assaut général (rapport de forces vu {sit['ratio']:.2f}).")

    if why is None:
        return False
    b.withdraw(side)
    _note(b, mem, f"l'armée décroche en bon ordre ({why} ; {round(sit['loss'] * 100)} % de pertes, rapport de "
                  f"forces vu {sit['ratio']:.2f}).")
    return True


# ---------------------------------------------------------------------- rase campagne
def _front_dep(body, ax, ay, fd, span):
    """Profondeur (par rapport à l'ancre) du premier ennemi devant la ligne, dans son couloir ; et son latéral moyen."""
    best, lats = None, []
    for k, x, y, cls, form in body:
        d, l = _rel(x, y, ax, ay, fd)
        if abs(l) < span and d > -150:
            if best is None or d < best:
                best = d
        lats.append(l)
    return best, (sum(lats) / len(lats) if lats else 0.0)


def _set_phase(b, mem, ph, txt=None):
    if mem.get('phase') != ph:
        mem['phase'] = ph
        mem['t_phase'] = round(b.clock)
        if txt:
            _note(b, mem, txt)


def _think_field(b, side, mem, L, us, foes, sit, want, busy):
    plan = mem['plan']
    now = b.clock
    roles = mem['role']
    fd = mem['fd']
    body = _body(b, mem)
    width = mem.get('width', 600)
    line = [u for u in us if roles.get(u.id) == 'ligne']
    e_inf = _einf(b, line)
    halt = mem.get('halt_k', 0.85) * e_inf
    front, lat_c = _front_dep(body, mem['ax'], mem['ay'], fd, width / 2 + 250)
    _roles_update(b, side, mem, L, us, sit, front)
    attacking = plan in ('frontal', 'artillerie', 'debordement') or (plan == 'harcelement' and side == 0)
    ph = mem['phase']
    # --------------------------------------------------------------- défenseur
    if not attacking:
        if ph == 'attente' and (front is not None and front < 1300 or sit['seen']):
            _set_phase(b, mem, 'combat')
        if plan == 'tenir' and L['counter'] and mem['phase'] == 'combat' and sit['ratio'] >= L['counter_k'] and \
                sit['e_routed'] >= 2 and sit['mor'] > 50:
            mem['plan'] = 'frontal'
            mem['mode'] = 'ligne'
            _recenter(mem, line)
            _set_phase(b, mem, 'assaut', f"l'assaillant flanche : contre-attaque générale (rapport {sit['ratio']:.1f}).")
        for u in line:
            p = mem['post'].get(u.id)
            if p:
                f = _march_form(b, mem, L, u, p[0], p[1], _foe_dist(u, body), True) or 'ligne'
                want[u.id] = [p[0], p[1], p[2], 'colonne' if f == 'colonne' and front is None else
                              ('ligne' if f == 'colonne' else f), False]
        _lights_def(b, side, mem, L, us, foes, sit, want)
        return
    # --------------------------------------------------------------- assaillant (ou contre-attaque)
    ax, ay = mem['ax'], mem['ay']
    # (l'ordre oblique du difficile, qui portait toute la ligne contre l'aile ennemie la plus faible, a été retiré :
    # sur 96 batailles, l'assaillant difficile gagnait 27 fois avec, 36 sans ; la mitraille à bout portant le punissait)
    shift = None
    if body and abs(lat_c) > width / 2 and L['n'] >= 1:
        shift = lat_c * 0.5   # l'ennemi n'est pas en face : la ligne glisse vers lui
    if shift and abs(shift) > 30:
        step = max(-140.0, min(140.0, shift))
        ax, ay = _at(ax, ay, fd, 0, step)
        mem['ax'], mem['ay'] = round(ax, 1), round(ay, 1)
    has_art = any(roles.get(u.id) == 'art' and u.valid for u in us)
    e_art = max([b.ranges(u)[0] for u in us if u.cls == 'artillerie'] or [0])
    standoff = max(430.0, min(560.0, e_art * 0.75)) if has_art else 430.0
    if plan == 'harcelement':
        standoff = 450.0
    if ph == 'attente':
        _set_phase(b, mem, 'marche')
        ph = 'marche'
    if ph == 'marche':
        if front is not None and front < standoff + 120:
            if plan == 'harcelement':
                _set_phase(b, mem, 'prepa', "l'ennemi est en vue : escarmouche à longue portée.")
            elif has_art and plan in ('frontal', 'artillerie', 'debordement'):
                _set_phase(b, mem, 'prepa', "l'ennemi est en vue : l'artillerie se met en batterie, la ligne attend.")
            else:
                _set_phase(b, mem, 'assaut', "l'ennemi est en vue : la ligne marche à l'ennemi.")
        else:
            if front is not None:
                tgt = front - standoff
            else:
                ez = b.zone(1 - side)
                tgt = _rel((ez[0] + ez[2]) / 2, (ez[1] + ez[3]) / 2, ax, ay, fd)[0] - 450
                seen_once = _body(b, mem, 7200.0)
                if seen_once:
                    # l'ennemi a été vu, puis perdu de vue (bois, brouillard) : on marche sur sa dernière position connue
                    tgt = min(_rel(x, y, ax, ay, fd)[0] for k, x, y, cls, form in seen_once) - standoff
                elif mem.get('t_probe') is not None or abs(tgt) < 40:
                    # personne en vue au bout de la marche : l'ennemi attend peut-être dans les bois ; après 5 min, la
                    # ligne (ses légers devant) va le chercher par bonds, jusqu'au fond de sa zone
                    t0 = mem.setdefault('t_probe', round(now))
                    tgt = tgt + 750 if now - t0 > 300 else 0.0
                    if tgt:
                        _note_once(b, mem, 'probe', "personne en vue : la ligne s'avance à la recherche de l'ennemi.",
                                   7200)
            _advance(b, mem, L, line, tgt)
    ph = mem['phase']
    if ph == 'prepa':
        t = now - mem['t_phase']
        prep = L['prep'] * (2.0 if plan == 'artillerie' else 1.0)
        prep_max = L['prep_max'] * (1.5 if plan == 'artillerie' else 1.0)
        done = t >= prep
        if L['n'] == 2 and t < prep_max and done:
            # en difficile : on attend que l'artillerie ait ébranlé l'ennemi
            seen_mor = [e.morale for e in sit['seen'] if e.cls == 'inf']
            # (le moral remonte vite au repos, jusqu'à 90 et plus près du général : « ébranlé », c'est moins de 82)
            if seen_mor and sum(seen_mor) / len(seen_mor) > 82 and sit['ratio'] < 1.3:
                done = False
        if plan == 'debordement':
            done = mem.get('fl') == 'attaque' or t >= prep_max
        gun = next((u for u in us if u.cls == 'artillerie' and u.valid), None)
        if gun is not None and t > prep * 0.5 and _grape_dist(b, mem, L, gun, b.ranges(gun)[2], foes):
            done = True   # plus rien ne menace nos canons : ligne et batteries s'avancent ensemble
        if plan == 'harcelement':
            done = False
        if front is not None:
            _advance(b, mem, L, line, front - standoff)
        if done:
            _set_phase(b, mem, 'assaut', "fin de la préparation : la ligne avance par bonds.")
    ph = mem['phase']
    batteries = _gun_zones(b, mem) if L['n'] >= 1 else []
    # (assaut général : on serre l'ennemi et on enlève ses canons, de flanc ; on brave la mitraille, mais pas sa gerbe
    # serrée à moins de 150 m d'une batterie en ordre, qui faucherait les files entières)
    guns = [(gx, gy, BT.GRAPE_CLOSE + 20, gid) for gx, gy, gr, gid in batteries] if mem.get('general_assault') \
        else batteries
    if ph == 'combat' and line and now - mem['t_phase'] > 240 and now - max(u.fired_t for u in line) > 240 and \
            not any(_d2(gx, gy, mem['ax'], mem['ay']) < (gr + 250) ** 2 for gx, gy, gr, gid in guns):
        halt *= 0.5   # personne ne tire : l'ennemi est hors de vue ou hors de portée, on serre
        if not mem['notes'].get('serre'):
            mem['notes']['serre'] = 1
            _note(b, mem, "la ligne ne voit plus l'ennemi : elle serre au plus près.")
    if ph in ('assaut', 'combat', 'poursuite'):
        if front is not None:
            gap = front - halt
            if ph == 'assaut' and gap < 40:
                _set_phase(b, mem, 'combat', "la ligne est à portée : feu de bataillon.")
            _advance(b, mem, L, line, gap)
        elif sit['e_routed'] and not sit['seen']:
            if ph != 'poursuite':
                _set_phase(b, mem, 'poursuite', "l'ennemi plie : poursuite.")
            ez = b.zone(1 - side)
            _advance(b, mem, L, line, _rel((ez[0] + ez[2]) / 2, (ez[1] + ez[3]) / 2, ax, ay, fd)[0])
        else:
            ez = b.zone(1 - side)
            _advance(b, mem, L, line, min(250.0, _rel((ez[0] + ez[2]) / 2, (ez[1] + ez[3]) / 2, ax, ay, fd)[0]))
    # ordres de la ligne
    for u in line:
        sx, sy = _slot(mem, u.id)
        if mem['phase'] == 'combat' and L['n'] >= 1:
            sx, sy = _fine_halt(b, side, mem, L, sx, sy, body, halt)
        if guns:
            sx, sy = _out_of_grape(guns, sx, sy, fd)
        fdist = _foe_dist(u, body)
        want[u.id] = [sx, sy, fd, _march_form(b, mem, L, u, sx, sy, fdist), False]
    if batteries and mem['phase'] in ('assaut', 'combat') and L['storm']:
        _storm_guns(b, side, mem, us, foes, batteries, busy)
    if plan == 'debordement':
        _flank_group(b, side, mem, L, us, foes, sit, want, busy, body)
    _lights_att(b, side, mem, L, us, foes, sit, want, body, front, halt)


def _storm_guns(b, side, mem, us, foes, guns, busy):
    """Une batterie ennemie interdit l'approche (mitraille) et nos canons ne la font pas taire : un ou deux bataillons
    frais l'enlèvent à la baïonnette (les canonniers tiennent mal au corps à corps). Pas si des cavaliers ennemis
    rôdent autour."""
    now = b.clock
    vis = {e.id: e for e in foes if e.cls == 'artillerie' and e.valid}
    storm = mem.setdefault('storm', {})
    roles = mem['role']
    for gx, gy, gr, gid in guns:
        e = vis.get(gid)
        if e is None or now - storm.get(gid, -1e9) < 240:
            continue
        if _cav_near(b, mem, e.x, e.y, 500, 120):
            continue
        cand = [u for u in us if u.cls == 'inf' and not u.light and u.valid and u.id not in busy and
                u.state not in ('charge', 'melee') and u.busy <= 0 and u.form != 'carre' and u.morale > BT.FORMED + 5 and
                u.men > 0.6 * u.men0 and roles.get(u.id) in ('ligne', 'res') and
                _d2(u.x, u.y, e.x, e.y) < 380 ** 2]
        # de face, une batterie en ordre reçoit la charge par deux décharges de mitraille à bout portant (très cher) :
        # on la prend de flanc ou de dos, de face seulement quand elle est déjà ébranlée ou réduite, ou en nombre
        intact = e.form == 'batterie' and e.morale >= 50 and e.men > 0.6 * e.men0
        cand.sort(key=lambda u: (_gun_front(e, u) and intact, _d2(u.x, u.y, e.x, e.y)))
        got = [u for u in cand if _charge_ok(b, side, u, e)][:2]
        if not got or sum(u.men for u in got) < 1.5 * e.men:
            continue
        if intact and all(_gun_front(e, u) for u in got) and sum(u.men for u in got) < 4.0 * e.men:
            continue
        for u in got:
            b.order(side, [u.id], 'charge', target=e.id)
            busy.add(u.id)
        storm[gid] = round(now)
        _note(b, mem, f"la batterie ennemie ({_foe(e)}) interdit l'approche : {' et '.join(u.name for u in got)} "
                      f"l'enlève{'nt' if len(got) > 1 else ''} à la baïonnette.")


def _gun_front(e, u):
    """u aborderait-il cette batterie de face (dans son champ de tir) ?"""
    return _ang(e.dir, math.atan2(u.y - e.y, u.x - e.x)) < 1.2


def _gun_zones(b, mem, maxage=600.0, k=None):
    """Batteries ennemies connues (vues depuis moins de 10 min, ni en déroute ni hors de combat) : [(x, y, rayon de
    mitraille meurtrière (60 % de la portée de mitraille) + 40 m, id)]."""
    now = b.clock
    out = []
    for key, v in mem['vu'].items():
        if v[4] == 'artillerie' and now - v[2] <= maxage and v[6] not in ('deroute', 'hors') and v[3] > 25:
            out.append((v[0], v[1], (k or GRAPE_DEADLY) * (v[9] if len(v) > 9 and v[9] else 280) + 40, key))
    return out


def _out_of_grape(guns, x, y, fd):
    """Recule un poste hors de portée de mitraille des batteries ennemies connues (au plus de 300 m)."""
    for _ in range(8):
        hit = False
        for gx, gy, gr, gid in guns:
            if _d2(gx, gy, x, y) < gr * gr:
                hit = True
                break
        if not hit:
            break
        x, y = _clamp(*_at(x, y, fd, -40))
    return x, y


def _recenter(mem, line):
    """L'ancre de la ligne repasse au centre des bataillons (passage des postes fixes à la ligne mobile)."""
    if not line:
        return
    ax = sum(u.x for u in line) / len(line)
    ay = sum(u.y for u in line) / len(line)
    mem['ax'], mem['ay'] = round(ax, 1), round(ay, 1)
    for u in line:
        mem['lat'][u.id] = round(_rel(u.x, u.y, ax, ay, mem['fd'])[1], 1)
        mem['back'][u.id] = 0.0


def _slot(mem, uid):
    if mem.get('mode') == 'poste' and uid in mem['post']:
        p = mem['post'][uid]
        return p[0], p[1]
    return _clamp(*_at(mem['ax'], mem['ay'], mem['fd'], -mem['back'].get(uid, 0.0), mem['lat'].get(uid, 0.0)))


def _advance(b, mem, L, line, target):
    """La ligne avance d'un bond vers target (profondeur par rapport à l'ancre), en attendant ses retardataires."""
    if target is None or abs(target) < 25:
        return
    now = b.clock
    if target > 0 and L['cohesion']:
        lag = 0.0
        for u in line:
            if u.state in ('melee', 'charge', 'deroute') or u.form == 'carre':
                continue
            sx, sy = _slot(mem, u.id)
            lag = max(lag, math.hypot(sx - u.x, sy - u.y))
        if lag > 55 and now - mem.get('t_bound', 0) < (100 if L['n'] == 2 else 75):
            return
    step = max(-150.0, min(target, L['bound']))
    x, y = _clamp(*_at(mem['ax'], mem['ay'], mem['fd'], step), 60)
    mem['ax'], mem['ay'] = round(x, 1), round(y, 1)
    mem['t_bound'] = round(now)


def _fine_halt(b, side, mem, L, sx, sy, body, halt):
    """Chaque bataillon règle sa distance sur l'ennemi qui lui fait face (sans s'écarter de plus de 70 m) et y cherche
    un couvert (haie, muret, vigne) à bonne portée ; au-delà de l'aile ennemie, il s'avance à sa hauteur pour la
    prendre de flanc."""
    fd = mem['fd']
    best, aside = None, None
    for k, x, y, cls, form in body:
        d, l = _rel(x, y, sx, sy, fd)
        if d < -60:
            continue
        if abs(l) < 140:
            if best is None or d < best:
                best = d
        elif abs(l) < 330 and (aside is None or d < aside):
            aside = d
    if best is None:
        if aside is None or L['n'] == 0:
            return sx, sy
        return _clamp(*_at(sx, sy, fd, max(-70.0, min(120.0, aside - 10))))
    adj = max(-70.0, min(70.0, best - halt))
    x, y = _at(sx, sy, fd, adj)
    if L['terrain']:
        e = halt / max(0.3, mem.get('halt_k', 0.85))
        bx, by, bv = x, y, b.cover_at(x, y) + 0.01
        for dd in (-40, -20, 20):
            a2 = adj + dd
            if not (0.6 * halt <= best - a2 <= 1.1 * e) or abs(a2) > 90:
                continue
            px, py = _at(sx, sy, fd, a2)
            if not b.passable(px, py, 'inf', side):
                continue
            qx, qy = _at(px, py, fd, 20)
            v = max(b.cover_at(px, py), 0.8 * b.cover_at(qx, qy))
            if v > bv + 0.05:
                bx, by, bv = px, py, v
        x, y = bx, by
    return _clamp(x, y)


def _foe_dist(u, body):
    best = 1e9
    for k, x, y, cls, form in body:
        d = (x - u.x) ** 2 + (y - u.y) ** 2
        if d < best:
            best = d
    return math.sqrt(best)


def _march_form(b, mem, L, u, sx, sy, fdist, defending=False):
    """Formation de l'infanterie : colonne pour marcher loin du feu ; à portée de l'ennemi ou sous le feu, l'ordre
    dispersé (tirailleurs : pertes ×0,35 au boulet, ×0,55 à la mitraille, ×0,8 à la fusillade, pour 40 % de feu en
    moins) tant qu'aucun cavalier ennemi n'a été vu depuis 10 min (normal : à moins de 1 500 m ; difficile :
    1 200 m), sinon la ligne.
    Facile : la ligne, et la colonne gardée trop longtemps."""
    if u.light:
        return 'tirailleurs'
    near = fdist < (380 if L['col_late'] else 720)
    hit = b.clock - u.hit_t < 40 and not L['col_late']
    if near or hit:
        if L['skirm'] >= (2 if defending else 1) and not _cav_near(b, mem, u.x, u.y, 1500 if L['n'] == 1 else 1200, 600):
            return 'tirailleurs'
        return 'ligne'
    if math.hypot(sx - u.x, sy - u.y) > 320:
        return 'colonne'
    return None


def _roles_update(b, side, mem, L, us, sit, front):
    """Réserves : combler les trous, relever les épuisés, couvrir un flanc, s'engager trop tôt (facile)."""
    roles = mem['role']
    now = b.clock
    for u in us:
        if u.state == 'deroute' and roles.get(u.id) in ('ligne', 'res', 'avant', 'garde_flanc', 'soutien', 'breche', 'mur', 'rue',
                                                         'coeur', 'assaut', 'vague2', 'diversion'):
            mem.setdefault('was', {})[u.id] = roles[u.id]
            roles[u.id] = 'rallie'
        elif roles.get(u.id) == 'rallie' and u.state == 'repos' and u.morale > 55 and \
                u.ammo >= 0.3 * u.ammo0 and u.cls == 'inf':
            roles[u.id] = 'res'   # (assaut d'une place : elle repartira avec la prochaine vague)
            mem['back'][u.id] = 220.0
    if mem['plan'] in ('place', 'assaut'):
        return
    res = [u for u in us if roles.get(u.id) == 'res' and u.valid and u.state not in ('melee', 'charge')]
    line = [u for u in us if roles.get(u.id) == 'ligne' and u.valid]
    contact = front is not None and front < 700
    # facile : la réserve s'engage dès le contact
    if L['res_early'] and contact and res:
        w = mem.get('width', 600) / 2
        for k, u in enumerate(res):
            roles[u.id] = 'ligne'
            side_ = 1 if k % 2 == 0 else -1
            mem['lat'][u.id] = round(side_ * (w + 80 + 140 * (k // 2)), 1)
            mem['back'][u.id] = 0.0
            if mem.get('mode') == 'poste':
                mem['post'][u.id] = [round(c, 1) for c in _at(mem['ax'], mem['ay'], mem['fd'], 0,
                                                              mem['lat'][u.id])] + [mem['fd']]
        _note(b, mem, "la réserve est engagée d'emblée dans la ligne.")
        return
    # ligne débordée : la réserve prolonge l'aile (on garde un bataillon pour les trous et les relèves)
    if L['extend'] and res and len(res) >= 2 and (front is not None and front < 450):
        w = mem.get('width', 600) / 2
        lats = []
        for k, x, y, cls, form in _body(b, mem):
            d, l = _rel(x, y, mem['ax'], mem['ay'], mem['fd'])
            if d < 600:
                lats.append(l)
        for s in (1, -1):
            if not lats or max(l * s for l in lats) < w + 60 or len(res) < 2:
                continue
            lat = s * (w + 75)
            tx, ty = _at(mem['ax'], mem['ay'], mem['fd'], 0, lat)
            u = min(res, key=lambda r: _d2(r.x, r.y, tx, ty))
            res.remove(u)
            roles[u.id] = 'ligne'
            mem['lat'][u.id] = round(lat, 1)
            mem['back'][u.id] = 0.0
            mem.setdefault('lat0', []).append(round(lat, 1))
            if mem.get('mode') == 'poste':
                px, py = _best_depth(b, side, tx, ty, mem['fd'], 40) if L['terrain'] else (tx, ty)
                mem['post'][u.id] = [round(px, 1), round(py, 1), mem['fd']]
            mem['width'] = round(2 * w + 150)
            w = mem['width'] / 2
            _note(b, mem, f"l'ennemi déborde {WING[s]} : {u.name} quitte la réserve et prolonge la ligne.")
    # percée : des ennemis derrière notre ligne ; la réserve les contre-attaque
    if L['extend'] and res and sit['seen'] and mem['plan'] in ('tenir', 'harcelement'):
        inside = [e for e in sit['seen'] if e.cls in ('inf', 'cavalerie') and
                  _rel(e.x, e.y, mem['ax'], mem['ay'], mem['fd'])[0] < -40 and
                  abs(_rel(e.x, e.y, mem['ax'], mem['ay'], mem['fd'])[1]) < mem.get('width', 600) / 2 + 150]
        for e in inside:
            if not res:
                break
            u = min(res, key=lambda r_: _d2(r_.x, r_.y, e.x, e.y))
            if _d2(u.x, u.y, e.x, e.y) > 600 ** 2:
                continue
            res.remove(u)
            if e.cls == 'inf' and _melee_power(b, u) > 1.1 * _melee_power(b, e) and _charge_ok(b, side, u, e):
                b.order(side, [u.id], 'charge', target=e.id)
            else:
                b.order(side, [u.id], 'attack', target=e.id)
            _note_once(b, mem, 'perce' + e.id, f"l'ennemi a percé ({_foe(e)}) : {u.name} contre-attaque.", 600)
    # canons menacés de près, sans infanterie auprès : un bataillon de réserve vient les couvrir
    if L['n'] >= 1 and res and sit['seen']:
        for g in us:
            if g.cls != 'artillerie' or not g.valid or roles.get(g.id) != 'art':
                continue
            near_foe = any(e.cls in ('inf', 'cavalerie') and _d2(e.x, e.y, g.x, g.y) < 300 ** 2 for e in sit['seen'])
            cover = any(o.cls == 'inf' and o.valid and o is not g and _d2(o.x, o.y, g.x, g.y) < 150 ** 2 for o in us)
            if near_foe and not cover:
                u = min(res, key=lambda r_: _d2(r_.x, r_.y, g.x, g.y))
                if _d2(u.x, u.y, g.x, g.y) > 700 ** 2:
                    continue
                res.remove(u)
                roles[u.id] = 'soutien'
                mem.setdefault('escort', {})[u.id] = g.id
                _note(b, mem, f"la batterie {g.name} est menacée : {u.name} vient la couvrir.")
                if not res:
                    break
    # trous dans la ligne
    lat0 = mem.get('lat0') or []
    line = [u for u in us if roles.get(u.id) == 'ligne' and u.valid]   # (avec les bataillons qui viennent d'allonger la ligne)
    held = [mem['lat'].get(u.id, 0.0) for u in line]
    for lat in lat0:
        if any(abs(lat - h) < 60 for h in held):
            continue
        if not res or not contact or L['n'] == 0:
            break
        tx, ty = _at(mem['ax'], mem['ay'], mem['fd'], 0, lat)
        u = min(res, key=lambda r: _d2(r.x, r.y, tx, ty))
        if u.morale < 50:
            continue
        res.remove(u)
        roles[u.id] = 'ligne'
        mem['lat'][u.id] = lat
        mem['back'][u.id] = 0.0
        if mem.get('mode') == 'poste':
            mem['post'][u.id] = [round(tx, 1), round(ty, 1), mem['fd']]
        held.append(lat)
        _note(b, mem, f"un trou s'ouvre dans la ligne : {u.name} monte de la réserve pour le combler.")
    # relèves : munitions, moral, fatigue
    if L['relief'] and res and contact:
        for v in sorted(line, key=lambda v: v.ammo / max(1, v.ammo0)):
            tired = v.ammo < 0.2 * v.ammo0 or v.morale < 40 or v.fat > 85
            if not tired or v.state in ('melee', 'charge'):
                continue
            ok = [r for r in res if r.ammo > 0.6 * r.ammo0 and r.morale > 60 and r.fat < 60]
            if not ok:
                break
            r = min(ok, key=lambda r: _d2(r.x, r.y, v.x, v.y))
            res.remove(r)
            roles[r.id], roles[v.id] = 'ligne', 'res'
            mem['lat'][r.id], mem['back'][r.id] = mem['lat'].get(v.id, 0.0), mem['back'].get(v.id, 0.0)
            mem['back'][v.id] = 230.0
            if v.id in mem['post']:
                mem['post'][r.id] = list(mem['post'][v.id])
                mem['post'][v.id] = [round(c, 1) for c in _at(mem['ax'], mem['ay'], mem['fd'], -230,
                                                              mem['lat'][r.id])] + [mem['fd']]
            why = 'sans cartouches' if v.ammo < 0.2 * v.ammo0 else ('épuisé' if v.fat > 85 else 'ébranlé')
            _note(b, mem, f"{r.name} relève {v.name} ({why}), qui passe en réserve près du chariot.")
            if not res:
                break
    # flancs : un ennemi déborde l'aile ; la réserve (ou un bataillon d'aile) fait face
    if L['flank'] and sit['seen']:
        w = mem.get('width', 600) / 2
        thr = {}
        for e in sit['seen']:
            if e.cls not in ('inf', 'cavalerie'):
                continue
            d, l = _rel(e.x, e.y, mem['ax'], mem['ay'], mem['fd'])
            if abs(l) > w + 120 and -400 < d < 200:
                s = 1 if l > 0 else -1
                thr[s] = thr.get(s, 0.0) + e.men
        guards = mem.setdefault('guard', {})
        gt = mem.setdefault('guard_t', {})
        for s, men in thr.items():
            if men >= 150:
                gt[str(s)] = round(now)
        for s in list(guards):
            if now - gt.get(s, 0) > 300:   # la menace a disparu : la garde de flanc retourne en réserve
                uid = guards.pop(s)
                if roles.get(uid) == 'garde_flanc':
                    roles[uid] = 'res'
                    mem['back'][uid] = 220.0
                    mem['lat'][uid] = 0.0
        for s, men in thr.items():
            if men < 150 or str(s) in guards and any(g.id == guards[str(s)] and g.valid for g in us):
                continue
            if not res:
                break
            tx, ty = _at(mem['ax'], mem['ay'], mem['fd'], -60, s * (w + 70))
            u = min(res, key=lambda r: _d2(r.x, r.y, tx, ty))
            res.remove(u)
            roles[u.id] = 'garde_flanc'
            mem['lat'][u.id] = round(s * (w + 70), 1)
            mem['back'][u.id] = 60.0
            guards[str(s)] = u.id
            _note(b, mem, f"{WING[s]} est menacée : {u.name} se porte sur le flanc.")


def _lights_def(b, side, mem, L, us, foes, sit, want):
    """Légers du défenseur : postes avancés, repli sur les ailes de la ligne quand l'ennemi approche."""
    roles = mem['role']
    w = mem.get('width', 600) / 2
    fold = mem.setdefault('fold', {})
    for u in us:
        if roles.get(u.id) != 'avant':
            continue
        p = mem['post'].get(u.id)
        if not p:
            continue
        danger = False
        for e in sit['seen']:
            d2 = _d2(e.x, e.y, u.x, u.y)
            if e.cls == 'inf' and not e.light and d2 < 170 ** 2:
                danger = True
            elif e.cls == 'cavalerie' and d2 < 380 ** 2 and b.terrain_at(u.x, u.y) not in ROUGH:
                danger = True
        if danger and L['n'] >= 1:
            fold[u.id] = round(b.clock)
        elif L['flankfire'] and b.clock - u.fired_t > 240 and b.clock - mem.get('t_contact', b.clock) > 240:
            spot = _flank_fire_spot(b, side, u, sit)
            if spot:
                fold.pop(u.id, None)
                want[u.id] = [spot[0], spot[1], spot[2], 'tirailleurs', False]
                continue
            if any(b.clock - v.fired_t < 60 for v in us if mem['role'].get(v.id) == 'ligne'):
                fold[u.id] = round(b.clock)   # poste inutile : on rejoint l'aile de la ligne, qui se bat
        if u.id in fold and b.clock - fold[u.id] < 300:
            s = 1 if mem['lat'].get(u.id, 0.0) >= 0 else -1
            x, y = _at(mem['ax'], mem['ay'], mem['fd'], -20, s * (w + 60))
            want[u.id] = [x, y, mem['fd'], 'tirailleurs', True]
        else:
            want[u.id] = [p[0], p[1], p[2], 'tirailleurs', False]


def _flank_fire_spot(b, side, u, sit):
    """Un poste de tir pour des légers inoccupés : de flanc, à bonne portée de l'ennemi le plus proche de notre ligne
    (à moins de 700 m d'eux), à couvert si possible ; None s'il n'y a rien à faire."""
    best, bd = None, 700.0 ** 2
    for e in sit['seen']:
        if e.cls != 'inf' or not e.valid:
            continue
        d = _d2(e.x, e.y, u.x, u.y)
        if d < bd:
            best, bd = e, d
    if best is None:
        return None
    e_r = b.ranges(u)[0]
    a = math.atan2(u.y - best.y, u.x - best.x)
    x, y = _clamp(best.x + math.cos(a) * e_r * 0.9, best.y + math.sin(a) * e_r * 0.9)
    if b.terrain_at(x, y) not in ROUGH:
        x, y = _cover_spot(b, side, x, y, a + math.pi, 60)
    return x, y, a + math.pi


def _lights_att(b, side, mem, L, us, foes, sit, want, body, front, halt):
    """Légers de l'assaillant : en avant de la ligne, d'un couvert à l'autre ; aux ailes une fois la ligne engagée."""
    roles = mem['role']
    w = mem.get('width', 600) / 2
    ph = mem['phase']
    lights = [u for u in us if roles.get(u.id) == 'avant']
    cache = mem.setdefault('lspot', {})
    key = f"{round(mem['ax'] / 40)}:{round(mem['ay'] / 40)}:{ph}"
    for k, u in enumerate(lights):
        lat = mem['lat'].get(u.id, 0.0)
        if ph in ('combat', 'poursuite'):
            s = 1 if lat >= 0 else -1
            x, y = _at(mem['ax'], mem['ay'], mem['fd'], 0, s * (w + 70 + 80 * (k // 2)))
            want[u.id] = [x, y, mem['fd'], 'tirailleurs', False]
            continue
        ahead = 140.0
        if front is not None:
            ahead = min(ahead, max(0.0, front - halt * 1.1))
        x, y = _at(mem['ax'], mem['ay'], mem['fd'], ahead, lat)
        c = cache.get(u.id)
        if L['terrain'] and (not c or c[0] != key):
            sx, sy = _cover_spot(b, side, x, y, mem['fd'], 80 * min(1.5, L['r_k']))
            cache[u.id] = [key, round(sx, 1), round(sy, 1)]
            c = cache[u.id]
        if L['terrain'] and c:
            x, y = c[1], c[2]
        want[u.id] = [x, y, mem['fd'], 'tirailleurs', False]


def _flank_group(b, side, mem, L, us, foes, sit, want, busy, body):
    """Débordement : la cavalerie de l'aile et les légers tournent le flanc ennemi, puis le prennent de flanc et de dos."""
    flank = mem.get('flank') or 1
    roles = mem['role']
    grp = [u for u in us if (roles.get(u.id) == 'cav' and mem['wing'].get(u.id) == flank) or
           (roles.get(u.id) == 'avant' and (mem['lat'].get(u.id, 0.0) * flank > 0 or
                                            sum(1 for v in us if roles.get(v.id) == 'avant') == 1))]
    if not grp:
        mem['fl'] = 'attaque'
        return
    fl = mem.get('fl', 'attente')
    # des cavaliers ennemis plus nombreux barrent le chemin : on revient sur l'aile et on réessaiera plus tard
    if fl in ('marche', 'attaque') and grp:
        gx = sum(u.x for u in grp) / len(grp)
        gy = sum(u.y for u in grp) / len(grp)
        e_men = sum(e.men for e in foes if e.cls == 'cavalerie' and e.valid and _d2(e.x, e.y, gx, gy) < 650 ** 2)
        my_men = sum(u.men for u in grp if u.cls == 'cavalerie' and u.valid)
        if e_men > 0.9 * my_men and e_men > 60:
            fl = mem['fl'] = 'attente'
            mem['t_fl'] = round(b.clock)
            _note_once(b, mem, 'fl_abort', f"des cavaliers ennemis plus nombreux barrent le débordement : "
                                           f"la colonne de flanc se replie sur {WING[flank]}.", 900)
            return
    if fl == 'attente' and (body or mem['phase'] in ('prepa', 'assaut', 'combat')) and \
            b.clock - mem.get('t_fl', -1e9) > 600:
        fl = mem['fl'] = 'marche'
        mem['t_fl'] = round(b.clock)
        _note(b, mem, f"débordement par {WING[flank]} : la cavalerie et les légers tournent l'ennemi.")
    if fl == 'attente':
        return
    fd = mem['fd']
    ax, ay = mem['ax'], mem['ay']
    if body:
        ends = [(_rel(x, y, ax, ay, fd)) for k, x, y, cls, form in body]
        end_lat = max(l * flank for d, l in ends) * flank
        dep = min(d for d, l in ends)
    else:
        end_lat = flank * (mem.get('width', 600) / 2)
        dep = 600.0
    if fl == 'marche':
        tx, ty = _clamp(*_at(ax, ay, fd, dep - 80, end_lat + flank * 380), 80)
        arrived = sum(1 for u in grp if _d2(u.x, u.y, tx, ty) < 200 ** 2)
        if arrived >= max(1, len(grp) // 2) or b.clock - mem.get('t_fl', 0) > 900:
            fl = mem['fl'] = 'attaque'
            _note(b, mem, f"le débordement est en place sur {WING[flank]} : on prend l'ennemi de flanc.")
        for k, u in enumerate(grp):
            x, y = _at(tx, ty, fd, -60 * (k // 2), flank * 70 * (k % 2))
            want[u.id] = [x, y, fd - flank * 1.2, 'tirailleurs' if u.light else None, u.cls == 'cavalerie']
            roles_tag = mem.setdefault('flg', {})
            roles_tag[u.id] = 1
        return
    # attaque : les légers se postent au flanc de l'ennemi, la cavalerie charge (voir _cavalry, rayon élargi)
    for u in grp:
        if u.light:
            x, y = _at(ax, ay, fd, dep + 40, end_lat + flank * 130)
            want[u.id] = [x, y, fd - flank * math.pi / 2, 'tirailleurs', False]
        else:
            x, y = _at(ax, ay, fd, dep + 60, end_lat + flank * 360)
            want[u.id] = [x, y, fd - flank * math.pi / 2, None, False]
        mem.setdefault('flg', {})[u.id] = 2


# ---------------------------------------------------------------------- place : défense
def _think_place_def(b, side, mem, L, us, foes, sit, want, busy):
    pl = b.place_info()
    px, py = pl['x'], pl['y']
    heart = mem.get('heart') or [px, py]
    r_in = mem.get('r_in', pl['r'])
    roles = mem['role']
    _roles_update(b, side, mem, L, us, sit, None)
    inside = [e for e in sit['seen'] if _d2(e.x, e.y, px, py) < (r_in - 5) ** 2]
    for u in us:
        r = roles.get(u.id)
        p = mem['post'].get(u.id)
        if r in ('breche', 'mur', 'rue', 'coeur', 'res', 'art', 'cav', 'gen', 'wagon', 'avant') and p:
            form = 'tirailleurs' if u.light else ('colonne' if r == 'res' else ('ligne' if u.cls == 'inf' else None))
            want[u.id] = [p[0], p[1], p[2], form, False]
    # renforts : une brèche attaquée, des postes de rempart inutiles (normal, difficile)
    if L['n'] >= 1:
        posts = mem.get('breach') or []
        hot = []
        for q in posts:
            men = sum(e.men for e in sit['seen'] if _d2(e.x, e.y, q[0], q[1]) < 320 ** 2)
            if men > 150:
                hot.append((men, q))
        if hot:
            hot.sort(reverse=True)
            q = hot[0][1]
            moved = mem.setdefault('moved', {})
            quiet = [u for u in us if roles.get(u.id) == 'mur' and u.valid and u.cls == 'inf' and u.id not in moved
                     and not any(_d2(e.x, e.y, u.x, u.y) < 400 ** 2 for e in sit['seen'])]
            if quiet and len(moved) < (2 if L['n'] == 2 else 1):
                u = min(quiet, key=lambda v: _d2(v.x, v.y, q[0], q[1]))
                a = q[2]
                x, y = q[0] - math.cos(a) * 55 + math.sin(a) * 60 * (len(moved) % 2 * 2 - 1), \
                    q[1] - math.sin(a) * 55 - math.cos(a) * 60 * (len(moved) % 2 * 2 - 1)
                mem['post'][u.id] = [round(x, 1), round(y, 1), round(a, 3)]
                roles[u.id] = 'breche'
                moved[u.id] = 1
                _note(b, mem, f"la brèche est attaquée : {u.name} quitte un rempart tranquille pour la renforcer.")
    # intrus dans la place : la réserve contre-attaque
    if inside:
        res = [u for u in us if roles.get(u.id) in ('res', 'cav') and u.valid and u.state not in ('melee', 'charge')
               and u.busy <= 0]
        for u in res:
            e = min(inside, key=lambda e: _d2(e.x, e.y, u.x, u.y))
            d = math.sqrt(_d2(e.x, e.y, u.x, u.y))
            if d > 500:
                continue
            if u.cls == 'cavalerie':
                if b.terrain_at(e.x, e.y) not in ROUGH and e.form != 'carre':
                    b.order(side, [u.id], 'charge', target=e.id)
                    busy.add(u.id)
            elif d < 110 and (e.morale < 60 or e.men < 0.6 * u.men) and u.morale > 50:
                b.order(side, [u.id], 'charge', target=e.id)
                busy.add(u.id)
            else:
                if not (u.order and u.order.get('kind') == 'attack' and u.target == e.id):
                    b.order(side, [u.id], 'attack', target=e.id)
                busy.add(u.id)
        if not mem['notes'].get('intrus'):
            mem['notes']['intrus'] = 1
            _note(b, mem, f"l'ennemi a pénétré dans la place : la réserve contre-attaque.")
    # cœur de la place : toujours quelqu'un pour le tenir
    if L['n'] >= 1:
        guard = [u for u in us if u.valid and _d2(u.x, u.y, heart[0], heart[1]) < 120 ** 2]
        if not guard:
            cand = [u for u in us if u.valid and u.cls == 'inf' and roles.get(u.id) not in ('breche',)
                    and u.state not in ('melee', 'charge')]
            if cand:
                u = min(cand, key=lambda v: _d2(v.x, v.y, heart[0], heart[1]))
                roles[u.id] = 'coeur'
                mem['post'][u.id] = [heart[0], heart[1], mem['fd']]
                want[u.id] = [heart[0], heart[1], mem['fd'], 'ligne', True]
                _note(b, mem, f"{u.name} court tenir le cœur de la place.")


# ---------------------------------------------------------------------- place : assaut
def _think_place_att(b, side, mem, L, us, foes, sit, want, busy):
    pl = b.place_info()
    px, py = pl['x'], pl['y']
    roles = mem['role']
    now = b.clock
    heart = mem['heart']
    bout, bin_, div = mem['bout'], mem['bin'], mem['div']
    r_in = mem.get('r_in', pl['r'])
    fd = mem['fd']
    _roles_update(b, side, mem, L, us, sit, None)
    ph = mem['phase']
    if ph == 'attente':
        _set_phase(b, mem, 'prepa', "l'artillerie ouvre le feu sur la brèche ; les colonnes attendent.")
        ph = 'prepa'
    t = now - mem['t_phase']
    assault = [u for u in us if roles.get(u.id) in ('assaut', 'vague2')]
    a_men = sum(u.men for u in assault if u.valid)
    if ph in ('prepa', 'regroupe'):
        prep = L['assault_prep'] * (0.6 if ph == 'regroupe' else 1.0)
        ready = t >= prep
        if L['n'] == 2 and ready and t < prep * 2:
            near = [e for e in sit['seen'] if _d2(e.x, e.y, bout[0], bout[1]) < 260 ** 2 and e.cls == 'inf']
            if near and sum(e.morale for e in near) / len(near) > 82:
                ready = False   # les défenseurs de la brèche tiennent encore : on pilonne
        if not any(u.cls == 'artillerie' and u.valid for u in us) and t > 120:
            ready = True
        if ready:
            mem['n_assault'] = round(max(1.0, a_men))
            _set_phase(b, mem, 'assaut', "la brèche est praticable : les colonnes d'assaut s'élancent, "
                                         "la diversion attaque l'autre face.")
            ph = 'assaut'
            t = 0.0
    if ph == 'assaut':
        # assaut repoussé, ou assaut général décidé quand tout piétine (_decide_withdraw) : on se regroupe sous les
        # canons, et les troupes ralliées depuis (en réserve ou encore à se reformer) repartent avec la vague suivante
        # (ASSAULT_WAVES au plus)
        ga = mem.get('general_assault')
        wave = a_men < 0.35 * mem.get('n_assault', a_men or 1) and sit['ratio'] > 0.9
        if t > 300 and L['n'] >= 1 and mem.get('waves', 0) < L.get('waves', ASSAULT_WAVES) and \
                (wave or (ga and ga != mem.get('ga_wave'))):
            mem['ga_wave'] = ga
            mem['waves'] = mem.get('waves', 0) + 1
            was = mem.get('was', {})
            for u in us:
                if (roles.get(u.id) == 'rallie' or (roles.get(u.id) == 'res' and u.id in was)) and u.state == 'repos':
                    roles[u.id] = 'vague2'
            _set_phase(b, mem, 'regroupe', "l'assaut est repoussé : on se regroupe sous la protection des canons."
                       if wave else "l'assaut piétine : on regroupe toutes les troupes pour un assaut général.")
            ph = 'regroupe'
    for u in us:
        r = roles.get(u.id)
        p = mem['post'].get(u.id)
        if r in ('assaut', 'vague2'):
            if ph != 'assaut' or (r == 'vague2' and t < 150):
                if p:
                    want[u.id] = [p[0], p[1], p[2], 'colonne', False]
                continue
            d_c = math.hypot(u.x - px, u.y - py)
            if d_c < r_in - 20:
                want[u.id] = [heart[0], heart[1], fd, 'colonne', False]
            elif _d2(u.x, u.y, bout[0], bout[1]) < 70 ** 2 or d_c < r_in + 30:
                want[u.id] = [bin_[0], bin_[1], fd, 'colonne', True]
            else:
                run = _d2(u.x, u.y, bout[0], bout[1]) < 260 ** 2
                want[u.id] = [bout[0], bout[1], fd, 'colonne' if L['n'] or not run else None, run]
        elif r == 'diversion':
            if ph == 'assaut' or (ph == 'prepa' and t > L['assault_prep'] - 150):
                a = math.atan2(div[1] - py, div[0] - px)
                want[u.id] = [div[0], div[1], a + math.pi, 'tirailleurs' if u.light else 'ligne', False]
            elif p:
                want[u.id] = [p[0], p[1], p[2], None, False]
        elif r in ('avant',) and p:
            if ph == 'assaut':
                x, y = bout[0] + math.cos(fd) * -90, bout[1] + math.sin(fd) * -90
                want[u.id] = [x, y, fd, 'tirailleurs', False]
            else:
                want[u.id] = [p[0], p[1], p[2], 'tirailleurs', False]
        elif r == 'res' and p:
            want[u.id] = [p[0], p[1], p[2], 'colonne', False]
    # au cœur : les premiers arrivés tiennent la place
    for u in assault:
        if u.valid and _d2(u.x, u.y, heart[0], heart[1]) < 60 ** 2:
            if not mem['notes'].get('coeur'):
                mem['notes']['coeur'] = 1
                _note(b, mem, f"{u.name} atteint le cœur de la place.")


# ---------------------------------------------------------------------- soutiens : général, chariot, ralliés
def _support(b, side, mem, L, us, foes, sit, want):
    roles = mem['role']
    fd = mem['fd']
    plan = mem['plan']
    seen = sit['seen']
    line = [u for u in us if roles.get(u.id) in ('ligne', 'breche', 'assaut') and u.valid]
    if line:
        cx = sum(u.x for u in line) / len(line)
        cy = sum(u.y for u in line) / len(line)
    else:
        cx, cy = mem['ax'], mem['ay']
    gen_pos = None
    wagons = {'w': next((w for w in us if w.cls == 'chariot' and w.alive and roles.get(w.id) == 'wagon'), None)}
    for u in us:
        r = roles.get(u.id)
        if r == 'gen':
            if plan == 'place':
                p = mem['post'].get(u.id)
                gx, gy = (p[0], p[1]) if p else (cx, cy)
            else:
                lat = 0.0
                if L['gen_move'] and line:
                    # vers le secteur le plus éprouvé
                    wts = [(max(0.0, 70 - v.morale), _rel(v.x, v.y, cx, cy, fd)[1]) for v in line]
                    tw = sum(w for w, _ in wts)
                    if tw > 0:
                        lat = max(-300.0, min(300.0, sum(w * l for w, l in wts) / tw))
                back = 170 if plan != 'assaut' else 200
                if mem['phase'] == 'assaut' and plan == 'assaut':
                    back = 120
                gx, gy = _at(cx, cy, fd, -back, lat)
                if not L['gen_move']:
                    p = mem['post'].get(u.id)
                    if p and _d2(p[0], p[1], gx, gy) < 450 ** 2:
                        gx, gy = p[0], p[1]
                    else:
                        mem['post'][u.id] = [round(gx, 1), round(gy, 1), fd]
            run = False
            if L['gen_move']:
                # des fuyards : le général va les chercher (le moteur ne les rallie qu'auprès de lui)
                f = _fetch(b, side, mem, L, u, us, seen, gx, gy)
                if f is not None:
                    gx, gy, run = f
            # jamais à portée de fusil
            for e in seen:
                if _d2(e.x, e.y, gx, gy) < 230 ** 2 and e.cls != 'artillerie':
                    a = math.atan2(gy - e.y, gx - e.x)
                    gx, gy = e.x + math.cos(a) * 260, e.y + math.sin(a) * 260
            if L['n'] >= 1:
                gx, gy = _shelter(b, mem, us, u, gx, gy, fd)
            gen_pos = (gx, gy)
            want[u.id] = [gx, gy, fd, None, run]
    for u in us:
        r = roles.get(u.id)
        if r == 'wagon':
            if plan == 'place':
                p = mem['post'].get(u.id)
                if p:
                    want[u.id] = [p[0], p[1], p[2], None, False]
                continue
            lat = 0.0
            if L['n'] >= 1 and line:
                low = min(line, key=lambda v: v.ammo / max(1, v.ammo0))
                if low.ammo < 0.5 * low.ammo0:
                    lat = _rel(low.x, low.y, cx, cy, fd)[1]
            back = 130 if mem['phase'] in ('combat', 'attente') else 230
            if L['n'] == 0:
                back = 260
            wx, wy = _at(cx, cy, fd, -back, lat)
            for e in seen:
                if _d2(e.x, e.y, wx, wy) < 200 ** 2:
                    a = math.atan2(wy - e.y, wx - e.x)
                    wx, wy = e.x + math.cos(a) * 320, e.y + math.sin(a) * 320
            if L['n'] >= 1:
                wx, wy = _shelter(b, mem, us, u, wx, wy, fd)
            want[u.id] = [wx, wy, fd, None, False]
        elif r == 'rallie' and u.valid and u.state == 'repos':
            # ralliés : se refaire près du général, à l'abri
            gx, gy = gen_pos or _at(cx, cy, fd, -220)
            if L['n'] == 0:
                continue
            k = sum(1 for c in u.id if c.isdigit()) % 3 - 1
            x, y = _at(gx, gy, fd, -50, 70 * k)
            want[u.id] = [x, y, fd, 'colonne' if u.cls == 'inf' and not u.light else None, False]
        elif r == 'res' and plan not in ('place', 'assaut'):
            sx, sy = _slot(mem, u.id) if mem.get('mode') == 'ligne' else (mem['post'].get(u.id) or [None, None])[:2]
            if sx is None:
                sx, sy = _at(cx, cy, fd, -220, mem['lat'].get(u.id, 0.0))
            wagon = wagons.get('w')
            if wagon is not None and u.ammo < 0.6 * u.ammo0 and u.cls == 'inf' and L['n'] >= 1:
                # recompléter ses cartouches au chariot (il recomplète à moins de 150 m)
                k = sum(1 for c in u.id if c.isdigit()) % 3 - 1
                sx, sy = _at(wagon.x, wagon.y, fd, 40, 60 * k)
            want[u.id] = [sx, sy, fd, 'colonne', False]
        elif r == 'soutien':
            g = b.unit(mem.get('escort', {}).get(u.id))
            if g is None or not g.alive or g.side != side or \
                    not any(_d2(e.x, e.y, g.x, g.y) < 450 ** 2 for e in seen if e.cls in ('inf', 'cavalerie')):
                roles[u.id] = 'res'   # la menace est passée (ou la batterie perdue) : retour en réserve
                continue
            x, y = _at(g.x, g.y, fd, 30, 70)
            want[u.id] = [x, y, fd, 'ligne', False]
        elif r == 'garde_flanc':
            sx, sy = _slot(mem, u.id) if mem.get('mode') == 'ligne' else \
                _at(mem['ax'], mem['ay'], fd, -mem['back'].get(u.id, 60.0), mem['lat'].get(u.id, 0.0))
            s = 1 if mem['lat'].get(u.id, 0.0) > 0 else -1
            want[u.id] = [sx, sy, fd + s * 0.9, 'ligne', False]


def _fetch(b, side, mem, L, g, us, seen, gx, gy):
    """Des fuyards à rallier : le moteur ne les rallie qu'auprès d'un général (l'ordre « Rallier », que les réflexes
    donnent sans cesse, dès que l'ennemi est à plus de 150 m ; d'eux-mêmes, au calme, à plus de 400 m). Le général va
    au-devant d'eux, sur leur chemin de fuite (vers notre bord), au premier endroit où il est hors de portée de fusil
    (l'ennemi repéré à plus de FETCH_SAFE), un peu en arrière : ils passent près de lui et se reforment. Pas s'il faut
    passer sous le feu, si des cavaliers ennemis rôdent par là, ni pour une poignée d'hommes ; le groupe le plus
    nombreux qu'on rejoint vite d'abord. Ceux qui passeront de toute façon près de son poste ordinaire (gx, gy), derrière
    la ligne, l'y trouveront : il ne le quitte pas pour eux. Renvoie (x, y, au galop) ou None."""
    runs = [v for v in us if v.state == 'deroute' and v.men >= 50 and v.cls in ('inf', 'cavalerie', 'artillerie')]
    if not runs:
        return None
    foes = [e for e in seen if e.valid and e.cls in ('inf', 'cavalerie')]
    ahead = min(120.0, 0.3 * b.rally_radius(g))
    reach = FETCH_REACH[L['n']]
    best, bv = None, 0.0
    r2 = (b.rally_radius(g) - 60) ** 2
    for v in runs:
        ex, ey = b.edge_point(side, v.x, v.y)
        far = math.hypot(ex - v.x, ey - v.y)
        a = math.atan2(ey - v.y, ex - v.x)
        if any(_d2(v.x + math.cos(a) * s, v.y + math.sin(a) * s, gx, gy) < r2 for s in range(0, min(700, int(far)), 50)):
            continue
        for s in range(0, 1000, 100):
            if s > far - 80:
                break
            px, py = v.x + math.cos(a) * s, v.y + math.sin(a) * s
            if any(_d2(e.x, e.y, px, py) < FETCH_SAFE ** 2 for e in foes):
                continue   # trop près de l'ennemi : plus loin sur son chemin
            tx, ty = _clamp(px + math.cos(a) * ahead, py + math.sin(a) * ahead, 40)
            d = math.hypot(tx - g.x, ty - g.y)
            mx, my = (tx + g.x) / 2, (ty + g.y) / 2
            if d > reach or any(_d2(e.x, e.y, mx, my) < 260 ** 2 or _d2(e.x, e.y, tx, ty) < FETCH_SAFE ** 2
                                for e in foes) \
                    or _cav_near(b, mem, tx, ty, 550, 240) or _cav_near(b, mem, mx, my, 450, 240):
                break      # trop loin, ou il faudrait s'exposer
            val = v.men / (1.0 + d / 500.0)
            if val > bv:
                best, bv = (tx, ty, d > 150, v), val
            break
    if best is None:
        return None
    tx, ty, run, v = best
    _note_once(b, mem, 'fetch' + v.id, f"le général va au-devant des fuyards du {v.name} pour les rallier.", 900)
    return tx, ty, run


def _shelter(b, mem, us, u, x, y, fd):
    """Des cavaliers ennemis rôdent : l'état-major ou le chariot se met derrière le bataillon le plus proche
    (un chariot escorté ne se laisse pas enlever)."""
    if not _cav_near(b, mem, x, y, 550, 120) and not _cav_near(b, mem, u.x, u.y, 550, 120):
        return x, y
    inf = [o for o in us if o.cls == 'inf' and o.valid and o.state not in ('charge', 'melee')]
    if not inf:
        return x, y
    o = min(inf, key=lambda v: _d2(v.x, v.y, x, y))
    _note_once(b, mem, 'abri' + u.id, f"des cavaliers ennemis rôdent : {u.name} s'abrite derrière {o.name}.", 900)
    return _at(o.x, o.y, fd, -45)


# ---------------------------------------------------------------------- cavalerie
def _cavalry(b, side, mem, L, us, foes, sit, want, busy):
    roles = mem['role']
    fd = mem['fd']
    plan = mem['plan']
    now = b.clock
    cavs = [u for u in us if u.cls == 'cavalerie' and roles.get(u.id) == 'cav']
    if not cavs:
        return
    w2 = mem.get('width', 600) / 2
    flg = mem.get('flg', {})
    e_cav = [e for e in foes if e.cls == 'cavalerie' and e.valid]
    idle = mem.setdefault('idle', {})
    seen_ids = {e.id: e for e in foes}
    for u in cavs:
        if u.state in ('charge', 'melee', 'deroute', 'ralliement') or u.busy > 0:
            continue
        if u.order and u.order.get('kind') == 'attack' and u.path and u.target in seen_ids:
            t = seen_ids[u.target]
            if t.alive and t.state != 'hors':
                if _d2(t.x, t.y, u.x, u.y) < 150 ** 2 and t.form != 'carre':
                    b.order(side, [u.id], 'charge', target=t.id)   # l'obstacle est contourné : on charge
                busy.add(u.id)
                continue
        # poste : l'aile, en retrait, hors de portée efficace des canons ennemis repérés
        wing = mem['wing'].get(u.id, 1)
        if plan in ('place', 'assaut'):
            p = mem['post'].get(u.id)
            sx, sy = (p[0], p[1]) if p else (u.x, u.y)
        elif wing == 0:
            sx, sy = _clamp(*_at(mem['ax'], mem['ay'], fd, -260, 0))
        else:
            lat = wing * (w2 + 110 + 120 * _wing_rank(mem, us, u))
            sx, sy = _clamp(*_at(mem['ax'], mem['ay'], fd, -70, lat))
            if mem.get('mode') == 'poste' and u.id in mem['post'] and mem['phase'] in ('attente', 'combat'):
                p = mem['post'][u.id]
                sx, sy = p[0], p[1]
        if L['n'] >= 1:
            sx, sy = _out_of_guns(b, mem, sx, sy, fd)
        fresh = u.morale > (50 if L['n'] else 40) and u.men > 0.35 * u.men0 and u.fat < 80
        r = L['cav_r']
        if flg.get(u.id) == 2:
            r *= 1.6
        if now - idle.get(u.id, now) > 600 and L['n'] == 2:
            r *= 1.3
        tgt = _cav_target(b, side, L, u, foes, e_cav, r) if fresh else None
        if tgt is not None:
            b.order(side, [u.id], 'charge', target=tgt.id)
            busy.add(u.id)
            idle[u.id] = round(now)
            _note_charge(b, mem, u, tgt, wing)
            continue
        if u.id in want:   # (débordement : le groupe de flanc a déjà sa destination)
            continue
        if not u.morale > 35 and plan not in ('place',):
            sx, sy = _at(sx, sy, fd, -150)
        far = _d2(u.x, u.y, sx, sy) > 400 ** 2
        want[u.id] = [sx, sy, fd, None, far]
        if u.id not in idle:
            idle[u.id] = round(now)


def _wing_rank(mem, us, u):
    w = mem['wing'].get(u.id)
    same = [v.id for v in us if v.cls == 'cavalerie' and mem['wing'].get(v.id) == w and mem['role'].get(v.id) == 'cav']
    same.sort()
    return same.index(u.id) if u.id in same else 0


def _out_of_guns(b, mem, x, y, fd):
    """Recule le poste d'attente de la cavalerie hors de portée efficace des batteries ennemies repérées."""
    now = b.clock
    for k, v in mem['vu'].items():
        if v[4] != 'artillerie' or now - v[2] > 600 or v[6] in ('deroute', 'hors'):
            continue
        e = 700.0
        for _ in range(4):
            if _d2(v[0], v[1], x, y) >= e * e:
                break
            x, y = _clamp(*_at(x, y, fd, -60))
    return x, y


def _note_charge(b, mem, u, tgt, wing):
    if tgt.cls == 'artillerie':
        what = f"la batterie isolée ({_foe(tgt)})"
    elif tgt.cls == 'chariot':
        what = "un chariot de munitions ennemi"
    elif tgt.cls == 'general':
        what = "l'état-major ennemi"
    elif tgt.state == 'deroute':
        what = f"les fuyards du {_foe(tgt)}"
    else:
        a = _ang(tgt.dir, math.atan2(u.y - tgt.y, u.x - tgt.x))
        how = ' de dos' if a > 2.3 else (' de flanc' if a > 1.2 else '')
        what = f"le {_foe(tgt)}{how}"
    who = f"la cavalerie de {WING.get(wing, 'la réserve')}" if wing in WING else u.name
    _note_once(b, mem, f"ch{u.id}{tgt.id}", f"{who} ({u.name}) charge {what}.", 300)


def _cav_target(b, side, L, u, foes, e_cav, r):
    """La meilleure proie à portée de charge : artillerie sans soutien, fuyards, flanc ou dos, ennemi ébranlé."""
    best, bv = None, 0.0
    for e in foes:
        if not e.alive or e.state == 'hors':
            continue
        d = math.hypot(e.x - u.x, e.y - u.y)
        if d > r:
            continue
        tt = b.terrain_at(e.x, e.y)
        rough = tt in ROUGH
        if not L['cav_pick']:
            # facile : sans discernement (sauf le carré déjà formé, la plupart du temps)
            if e.form == 'carre' and b.rng.random() < 0.7:
                continue
            v = 1.0 / (1 + d / 200)
            if e.cls in ('general', 'chariot'):
                v *= 0.5
            if v > bv:
                best, bv = e, v
            continue
        if e.form == 'carre' or rough:
            continue
        support = sum(1 for f in foes if f is not e and f.valid and f.cls == 'inf' and
                      _d2(f.x, f.y, e.x, e.y) < 130 ** 2 and f.state not in ('melee',))
        a = _ang(e.dir, math.atan2(u.y - e.y, u.x - e.x))
        if e.cls == 'chariot':
            v = 3.0
        elif e.state == 'deroute':
            v = 1.8 * min(1.5, e.men / 250) if not support else 0.6
        elif e.cls == 'artillerie':
            v = (3.2 if e.form == 'attelee' else 2.6) * (0.35 if support else 1.0)
            if e.form == 'batterie' and e.morale >= 50 and a <= 1.2:
                v *= 0.4   # de face, la mitraille à bout portant vide les selles : de flanc ou de dos
        elif e.cls == 'general':
            v = 2.0 if not support else 0.5
        elif e.cls == 'cavalerie':
            v = 1.4 if e.state == 'melee' else (0.9 if e.morale < 45 or e.men < 0.5 * u.men else 0.0)
        else:
            v = 0.5
            if a > 2.3:
                v *= 2.6
            elif a > 1.2:
                v *= 1.9
            if e.state == 'melee':
                v *= 2.0
            if e.morale < 45:
                v *= 1.8
            elif e.morale < 60:
                v *= 1.2
            if e.men < 0.5 * e.men0:
                v *= 1.3
            if e.form == 'tirailleurs':
                v *= 1.6
            elif e.form == 'colonne':
                v *= 1.15
            # une ligne fraîche, de face : on s'en garde
            if a <= 1.2 and e.morale >= 55 and e.state != 'melee' and e.form != 'tirailleurs':
                v *= 0.25
        # cavaliers ennemis frais à proximité : gare à la contre-charge (difficile : on n'y va pas sans supériorité)
        fresh = sum(c.men for c in e_cav if c is not e and c.morale > 50 and
                    _d2(c.x, c.y, e.x, e.y) < (450 if L['cav_safe'] else 250) ** 2)
        if fresh:
            if L['cav_safe'] and fresh > 0.7 * u.men and e.cls != 'chariot':
                continue
            v *= 0.6
        v *= 1.25 - d / r * 0.5
        if v > bv and _charge_ok(b, side, u, e):
            best, bv = e, v
    return best if bv >= (0.55 if L['cav_pick'] else 0.0) else None


# ---------------------------------------------------------------------- baïonnette
def _melee_power(b, u):
    """Force au corps à corps estimée (comme le moteur : type, moral, expérience, fatigue, ordre dispersé, maisons et
    murs), à partir de ce que l'on voit de l'unité."""
    k = U.TYPE.get(u.type, U.TYPE['ligne'])['melee'] * (0.5 + u.morale / 200) * (0.8 + u.xp / 250) * (1 - u.fat / 250)
    if u.form == 'tirailleurs':
        k *= 0.7
    t = b.terrain_at(u.x, u.y)
    if t in (T_MUR, T_PORTE, T_BARRICADE) and u.side == 0:
        k *= 0.6
    elif t == T_BATI:
        k *= 1.4
    elif t != T_BRECHE and b.cover_at(u.x, u.y) >= 0.5:
        k *= 1.5
    return k * u.men


def _bayonets(b, side, mem, L, us, foes, sit, busy):
    """Charge à la baïonnette : contre un ennemi éprouvé, en désordre, pris de flanc, des canons sans soutien ; et,
    après l'avoir assez fusillé, contre l'ennemi d'en face quand le rapport des forces au corps à corps est bon (les
    tirailleurs tiennent mal à la baïonnette). Difficile : les bataillons voisins chargent ensemble."""
    roles = mem['role']
    plan = mem['plan']
    now = b.clock
    cav_near = [e for e in foes if e.cls == 'cavalerie' and e.valid]
    # (une fusillade d'une salve par minute use l'ennemi lentement : on ne croise la baïonnette, à forces égales, qu'après
    # un quart d'heure de feu)
    fired_long = mem.get('phase') == 'combat' and now - mem.get('t_phase', now) >= FIRE_LONG
    cands = []
    for u in us:
        if u.cls != 'inf' or not u.valid or u.id in busy or u.busy > 0 or u.state in ('charge', 'melee') or \
                u.form == 'carre':
            continue
        r = roles.get(u.id)
        if r not in ('ligne', 'assaut', 'vague2', 'garde_flanc', 'soutien', 'res', 'breche', 'mur', 'rue', 'coeur',
                     'diversion'):
            continue
        if r == 'res' and plan not in ('place',):
            continue
        if u.morale < 50 or u.men < 0.45 * u.men0:
            continue
        if any(_d2(c.x, c.y, u.x, u.y) < 380 ** 2 for c in cav_near):
            continue   # des cavaliers tout près : une troupe qui charge, en désordre, serait sabrée
        reach = 130.0 if r in ('assaut', 'vague2', 'coeur') else 120.0
        if plan == 'place' and r in ('breche', 'mur'):
            reach = 80.0
        mine = _melee_power(b, u)
        best, bv, br = None, 0.0, 0.0
        for e in foes:
            if not e.valid or e.cls in ('general', 'chariot', 'cavalerie'):
                continue
            d = math.hypot(e.x - u.x, e.y - u.y)
            if d > reach:
                continue
            if not L['cav_pick']:
                # facile : charge au petit bonheur
                if b.rng.random() < 0.12:
                    best, bv = e, 1.0
                continue
            v = 0.0
            ratio = mine / max(1.0, _melee_power(b, e))
            sup = sum(1 for f in foes if f is not e and f.valid and f.cls == 'inf' and _d2(f.x, f.y, e.x, e.y) < 110 ** 2)
            if e.cls == 'artillerie' and not sup:
                # (une batterie en ordre, abordée de face, vous reçoit à mitraille : pas sans l'avoir ébranlée)
                v = 0.6 if e.form == 'batterie' and e.morale >= 50 and _gun_front(e, u) else 2.0
            if e.morale < 40:
                v = max(v, 1.6)
            if e.men < 0.45 * e.men0:
                v = max(v, 1.2)
            if e.state == 'melee':
                v = max(v, 1.4)
            if _ang(e.dir, math.atan2(u.y - e.y, u.x - e.x)) > 1.3 and e.morale < 65:
                v = max(v, 1.3)
            if r in ('assaut', 'vague2', 'coeur') and u.men > 0.8 * e.men:
                v = max(v, 1.0)
            # après la fusillade : à la baïonnette si l'on est nettement plus fort au corps à corps
            if e.cls == 'inf' and (fired_long or e.men < 0.85 * e.men0) and ratio >= 1.3:
                v = max(v, 0.8 + ratio * 0.2)
            if ratio < 0.8 and e.cls == 'inf':
                v *= 0.5
            if v > bv:
                best, bv, br = e, v, ratio
        if best is not None:
            cands.append((bv, br, u, best))
    if not cands:
        return
    cands.sort(key=lambda c: -c[0])
    launched = []
    for bv, br, u, e in cands:
        go = bv >= 1.0
        # difficile : les voisins d'un bataillon qui charge chargent aussi, s'ils ne sont pas trop faibles
        if not go and L['n'] == 2 and br >= 1.0 and any(_d2(v.x, v.y, u.x, u.y) < 220 ** 2 for v, _ in launched):
            go = True
        if go and _charge_ok(b, side, u, e):
            b.order(side, [u.id], 'charge', target=e.id)
            busy.add(u.id)
            launched.append((u, e))
    if launched:
        u, e = launched[0]
        what = f"les canons du {_foe(e)}" if e.cls == 'artillerie' else f"le {_foe(e)}"
        others = f" (avec {', '.join(v.name for v, _ in launched[1:])})" if len(launched) > 1 else ''
        _note_once(b, mem, 'bay' + u.id, f"{u.name} charge à la baïonnette {what}{others}.", 600)


# ---------------------------------------------------------------------- artillerie
def _artillery(b, side, mem, L, us, foes, sit, want, busy):
    roles = mem['role']
    plan = mem['plan']
    ph = mem['phase']
    fd = mem['fd']
    now = b.clock
    body = _body(b, mem, 300)
    front, _ = _front_dep(body, mem['ax'], mem['ay'], fd, mem.get('width', 600) / 2 + 300)
    gslot = mem.setdefault('gslot', {})
    ours = [o for o in us if o.cls in ('inf', 'cavalerie') and o.valid]
    wagon = next((w for w in us if w.cls == 'chariot' and w.alive), None)
    arts = [u for u in us if u.cls == 'artillerie' and roles.get(u.id) == 'art']
    known = None
    looked = False   # (une seule recherche d'emplacement par réflexion : elle coûte des lignes de vue)
    for u in arts:
        if u.state in ('deroute', 'ralliement', 'melee'):
            continue
        e, mx, g = b.ranges(u)
        p = mem['post'].get(u.id)
        c = gslot.get(u.id)
        fixed = plan in ('place', 'assaut') or (mem.get('mode') == 'poste' and ph in ('attente', 'combat'))
        if wagon is not None and u.ammo < 0.15 * u.ammo0 and L['n'] >= 1:
            pos = (wagon.x + 40, wagon.y)
        elif fixed or ph == 'marche' or front is None:
            if fixed:
                pos = (c[1], c[2]) if c and c[0] == 'fixe' else ((p[0], p[1]) if p else (u.x, u.y))
            elif ph == 'marche':
                pos = _clamp(*_at(mem['ax'], mem['ay'], fd, -60, mem['lat'].get(u.id, 0.0)))
            else:
                pos = (u.x, u.y) if u.form == 'batterie' else \
                    _clamp(*_at(mem['ax'], mem['ay'], fd, -60, mem['lat'].get(u.id, 0.0)))
            # batterie aveugle (haies, bois, crête) alors que l'ennemi est à portée : on cherche un emplacement qui voit
            if fixed and L['n'] >= 1 and not looked and u.form == 'batterie' and not u.path and \
                    now - max(u.fired_t, c[3] if c else 0.0) > 180 and not _cav_near(b, mem, u.x, u.y, 800) and \
                    not any(_d2(f.x, f.y, u.x, u.y) < 450 ** 2 for f in foes if f.valid):
                if known is None:
                    known = _known_targets(b, mem)
                near = [t for t in known if _d2(t[0], t[1], u.x, u.y) < (mx * 1.1) ** 2]
                if near and not _gun_view(b, u.x, u.y, near, mx):
                    looked = True
                    x, y = _gun_spot_view(b, side, u.x, u.y, fd, 120, near, mx, 1e9)
                    gslot[u.id] = ['fixe', round(x, 1), round(y, 1), round(now)]
                    if _d2(x, y, u.x, u.y) > 40 ** 2:
                        _note_once(b, mem, 'aveugle' + u.id, f"{u.name} ne voit rien : elle change d'emplacement.", 600)
                    pos = (x, y)
        else:
            # à bonne portée du front ennemi, sur un emplacement qui voit l'ennemi
            dist = e * (0.85 if ph == 'prepa' else 0.6)
            gd = _grape_dist(b, mem, L, u, g, foes) if ph != 'marche' else None
            if gd:
                dist = gd   # batterie avancée à mitraille, hors de portée des fusils ennemis
                _note_once(b, mem, 'mitraille', f"plus de cavaliers ennemis aux alentours : les batteries "
                                                f"s'avancent à portée de mitraille ({round(gd)} m).", 7200)
            dist = max(dist, 200.0)
            key = f"{round(front / 80)}:{round(mem['ax'] / 80)}:{round(mem['ay'] / 80)}:{round(dist / 60)}"
            idle = c is not None and now - max(u.fired_t, c[3]) > 150 and u.form == 'batterie' and not u.path
            if c and c[0] == key and not (idle and L['n'] >= 1):
                pos = (c[1], c[2])
            elif looked:
                pos = (c[1], c[2]) if c else (u.x, u.y)
            else:
                looked = True
                x, y = _clamp(*_at(mem['ax'], mem['ay'], fd, front - dist, mem['lat'].get(u.id, 0.0)), 50)
                if L['terrain']:
                    if known is None:
                        known = _known_targets(b, mem)
                    near = [t for t in known if _d2(t[0], t[1], x, y) < (mx * 1.05) ** 2]
                    if near:
                        x, y = _gun_spot_view(b, side, x, y, fd, 100 * min(1.6, L['r_k']), near,
                                              (g * 0.98 if gd else e * 1.1), 0 if gd else 40)
                    else:
                        x, y = _gun_spot(b, side, x, y, fd, 70 * L['r_k'], ahead=30, rough=True)
                # on ne déplace pas une batterie qui tire pour quelques mètres
                if not idle and _d2(u.x, u.y, x, y) < (40 if gd else 110) ** 2 and u.form == 'batterie':
                    x, y = u.x, u.y
                gslot[u.id] = [key, round(x, 1), round(y, 1), round(now)]
                pos = (x, y)
        dist2 = _d2(u.x, u.y, pos[0], pos[1])
        if dist2 > 45 ** 2:
            want[u.id] = [pos[0], pos[1], fd, 'attelee', False]
            continue
        if u.form != 'batterie':
            if u.busy <= 0 and not u.path:
                _form(b, side, u, 'batterie')
            busy.add(u.id)
            continue
        busy.add(u.id)
        # cible
        if not L['art_pick']:
            continue   # facile : les canons tirent sur ce qui se présente (choix du moteur)
        tgt = _art_target(b, u, foes, ours, mem, mx, e, g)
        if tgt is not None and (u.target != tgt.id or not u.order or u.order.get('kind') != 'attack'):
            b.order(side, [u.id], 'attack', target=tgt.id)


def _grape_dist(b, mem, L, u, g, foes):
    """Distance de tir à mitraille quand elle dépasse la portée des fusils ennemis (canons Gribeauval contre fusils à
    silex, par exemple) et qu'aucun cavalier ennemi ne menace la batterie : aucun vu depuis 5 min à moins de 1 000 m
    (grape = 1 ; le réglage plus hardi, 700 m, grape = 2, perd ses canons trop souvent) ; sinon None."""
    if not L['grape'] or not g:
        return None
    inf_mx = 0
    for e in foes:
        if e.cls == 'inf' and e.valid:
            inf_mx = max(inf_mx, b.ranges(e)[1])
    if not inf_mx or g < inf_mx + 25:
        return None
    if _cav_near(b, mem, u.x, u.y, 1000 if L['grape'] == 1 else 700):
        return None
    return min(g * 0.95, inf_mx + 35)


def _cav_near(b, mem, x, y, r, maxage=300.0):
    """Des cavaliers ennemis ont-ils été vus récemment à moins de r mètres ?"""
    now = b.clock
    r2 = r * r
    for v in mem['vu'].values():
        if v[4] == 'cavalerie' and now - v[2] <= maxage and v[6] not in ('deroute', 'hors') and \
                _d2(v[0], v[1], x, y) < r2:
            return True
    return False


def _known_targets(b, mem, maxage=300.0):
    """Ennemis repérés récemment (positions connues) : [(x, y, cls)], les plus proches de notre ancre d'abord."""
    now = b.clock
    out = [(v[0], v[1], v[4]) for v in mem['vu'].values()
           if now - v[2] <= maxage and v[6] not in ('deroute', 'hors') and v[4] in ('inf', 'artillerie', 'cavalerie')]
    ax, ay = mem['ax'], mem['ay']
    out.sort(key=lambda t: _d2(t[0], t[1], ax, ay))
    return out[:7]


def _gun_view(b, x, y, tg, reach):
    n = 0
    r2 = reach * reach
    for tx, ty, cls in tg:
        if _d2(x, y, tx, ty) <= r2 and b.los(x, y, tx, ty, GUN_EYE, EYES.get(cls, 2.5)):
            n += 1
    return n


def _gun_spot_view(b, side, x, y, fd, r, tg, reach, ahead):
    """Emplacement de batterie qui voit le plus d'ennemis connus à portée (la hauteur départage ; lisières et vignes,
    où la cavalerie charge mal, sont préférées). Au plus une trentaine de cases et cinq cibles : quelques ms."""
    best, bv = (x, y), -1e9
    n = max(1, min(3, int(r // 40)))
    tg = tg[:5]
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            if i * i + j * j > n * n:
                continue
            px, py = x + i * 40, y + j * 40
            if not (30 < px < W - 30 and 30 < py < H - 30) or not b.passable(px, py, 'artillerie', side):
                continue
            if _rel(px, py, x, y, fd)[0] > ahead:
                continue
            t = b.terrain_at(px, py)
            if t == T_BATI:
                continue
            seen = _gun_view(b, px, py, tg, reach)
            v = seen * 1.5 + b.height_at(px, py) / 12.0 - math.hypot(i, j) / n * 0.8 + \
                (0.5 if t in WOODS or t == T_VIGNE_T else 0.0)
            if v > bv:
                best, bv = (px, py), v
    return best


def _art_target(b, u, foes, ours, mem, mx, e_r, g):
    best, bv = None, 0.0
    cur = u.target
    bout = mem.get('bout') if mem['plan'] == 'assaut' else None
    for t in foes:
        if not t.alive or t.state in ('hors', 'deroute'):
            continue
        d = math.hypot(t.x - u.x, t.y - u.y)
        if d > mx * 0.98:
            continue
        cov = b.cover_at(t.x, t.y)
        if g and d <= g:
            v = BT.P_MITRAILLE * BT.grape_k(d, g) * GRAPE.get(t.form, 1.0) * (1 - cov)
        else:
            v = BT.P_BOULET * BT.ball_k(d, e_r) * BALL.get(t.form, 1.0) * (1 - 0.6 * cov)
        if t.cls == 'artillerie':
            g_t = b.ranges(t)[2] or 280
            threat = min((_d2(t.x, t.y, o.x, o.y) for o in ours), default=1e12) < (g_t + 60) ** 2
            v *= (2.0 if threat else 1.4) if d <= e_r else 1.0
        elif t.cls == 'cavalerie':
            v *= 1.3
        elif t.cls == 'chariot':
            v *= 1.5
        elif t.cls == 'general':
            v *= 0.3
        near = min((_d2(t.x, t.y, o.x, o.y) for o in ours), default=1e12)
        if near < 400 ** 2:
            v *= 1 + 0.6 * (1 - math.sqrt(near) / 400)
        if bout and _d2(t.x, t.y, bout[0], bout[1]) < 260 ** 2:
            v *= 1.6
        if t.id == cur:
            v *= 1.25   # (changer de cible coûte du temps de pointage)
        if v > bv and b.los_units(u, t):
            best, bv = t, v
    return best




# ---------------------------------------------------------------------- exécution
def _apply(b, side, mem, us, want, busy):
    """Transforme les intentions (position, orientation, formation) en ordres, seulement quand ils changent quelque
    chose : on ne recalcule pas les chemins à chaque réflexion."""
    now = b.clock
    fm = mem['fm']
    blocked = mem.setdefault('blocked', {})
    for k in [k for k, v in blocked.items() if now - v[2] > 120]:
        del blocked[k]
    for u in us:
        w = want.get(u.id)
        if w is None or u.id in busy:
            continue
        if u.state in ('deroute', 'melee', 'charge', 'ralliement') or u.busy > 0 or u.form == 'carre':
            continue
        x, y, d, form, run = w
        x, y = _clamp(x, y)
        dist2 = _d2(u.x, u.y, x, y)
        if u.cls == 'artillerie':
            if dist2 > 45 ** 2:
                _goto(b, side, mem, u, x, y, d, run, 30.0)
            continue
        if form and form != u.form and form in ('ligne', 'colonne', 'tirailleurs') and \
                now - fm.get(u.id, -999) > 75 and u.cls == 'inf':
            if form != u.form and _form(b, side, u, form):
                fm[u.id] = round(now)
                continue
        tol = 22.0 if mem['role'].get(u.id) in ('ligne', 'breche', 'mur') else 35.0
        _goto(b, side, mem, u, x, y, d, run, tol)


def _goto(b, side, mem, u, x, y, d=None, run=False, tol=22.0):
    dx, dy = x - u.x, y - u.y
    g = u.goal
    if dx * dx + dy * dy <= tol * tol:
        if u.path and g and _d2(g[0], g[1], x, y) > tol * tol:
            b.order(side, [u.id], 'move', x=x, y=y, dir=d, run=run)
        elif d is not None and not u.path and u.cls not in ('artillerie', 'general', 'chariot') and \
                _ang(u.dir, d) > 0.7 and u.state not in ('feu', 'recharge') and b.clock - u.fired_t > 40:
            b.order(side, [u.id], 'move', x=u.x, y=u.y, dir=d)
        return
    if u.path and g and _d2(g[0], g[1], x, y) <= (tol * 1.2) ** 2:
        return
    bl = mem['blocked'].get(u.id)
    if bl and _d2(bl[0], bl[1], x, y) < 80 ** 2:
        return   # destination introuvable il y a peu : on ne relance pas la recherche de chemin
    dist = math.sqrt(dx * dx + dy * dy)
    legs = mem.setdefault('leg', {})
    if dist > LEG + 80:
        # longue marche : par étapes (la recherche de chemin du moteur reste courte, donc bon marché)
        lg = legs.get(u.id)
        if u.path and g and lg and _d2(lg[0], lg[1], x, y) < (tol * 2) ** 2 and _d2(g[0], g[1], u.x, u.y) > 120 ** 2:
            return
        legs[u.id] = [round(x), round(y)]
        k = LEG / dist
        x, y, d = u.x + dx * k, u.y + dy * k, None
    else:
        legs.pop(u.id, None)
    b.order(side, [u.id], 'move', x=x, y=y, dir=d, run=run)
    if not u.path:
        mem['blocked'][u.id] = [round(x), round(y), round(b.clock)]
