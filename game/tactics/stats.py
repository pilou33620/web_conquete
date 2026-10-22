"""Valeurs chiffrées d'une troupe, à la manière d'Empire: Total War (fiche du régiment, en bataille et en campagne).

Une seule source : elles se tirent des coefficients du moteur (units.TYPE, rules.ARMS, units.ranges, units.reload_time,
units.precision, battle.FORM_TIME, les technologies de l'armée) ; 40 = un régiment de ligne aguerri (xp 50) au fusil à
silex. Elles disent la vérité : deux fois plus en Mêlée, deux fois plus de pertes au corps à corps (tests/test_bataille.py,
ValeursChiffrees, le vérifie sur le moteur).
Chaque valeur : [base, expérience, général]. Moral, fatigue, distance, terrain, couvert et temps n'y entrent pas.
"""
import math

from .. import rules as R
from . import units as U
from . import battle as B   # (battle.py lit aussi xp_k, ELAN, power_k, charge_k : à l'appel, l'import est circulaire)

K = 40.0                              # 40 = ligne aguerrie au fusil à silex
K_CHOC = 15.0                         # charge : 15 = une ligne à plein élan
ELAN = dict(cavalerie=2.2, inf=1.0)   # élan de la charge (battle._impact, mom)
# technologies de combat de l'armée (rules.TECH, comme engine.reg_power en résolution automatique) : bridge.make_spec
# les met dans spec['tech'][camp], battle.py les applique, la fiche les compte dans la base
TECH_MODS = ('all_power', 'inf_power', 'art_power', 'cav_power', 'ligne_fire', 'carre_fire', 'colonne_charge',
             'cav_charge', 'art_charge')
ARM_POWER = dict(inf='inf_power', artillerie='art_power', cavalerie='cav_power')


def xp_k(xp):
    """L'expérience au tir, à la mêlée et au feu de défense (battle._fire, _melee_k, _impact) : ×0,8 à ×1,2."""
    return 0.8 + xp / 250


def power_k(md, cls):
    """Toutes armes et arme de la troupe (état-major, système divisionnaire, poudreries, hussards…) : au tir, à la
    mêlée, au choc."""
    return 1 + md.get('all_power', 0.0) + md.get(ARM_POWER[cls], 0.0) if cls in ARM_POWER else 1.0


def charge_k(md, cls):
    """Cuirassiers (la cavalerie) ou ordre mixte (l'infanterie en colonne) : l'élan de la charge."""
    return 1 + md.get('cav_charge' if cls == 'cavalerie' else 'colonne_charge', 0.0)


def _v(f, xp, kg=1.0, nd=None):
    # arrondis sur les totaux : base + expérience + général retombent juste
    b, t = round(f(0), nd), round(f(xp), nd)
    return [b, round(t - b, nd), round(round(f(xp) * kg, nd) - t, nd)]


def stats(typ, arm=0, xp=0.0, trait=None, defender=False, swift=0.0, mods=None):
    """Valeurs d'une troupe (régiment de campagne ou unité tactique) : dict clé → [base, expérience, général],
    sauf por (portées en m), jus (demi-justesse D50, en m) et mun (dotation). mods : technologies de l'armée
    (TECH_MODS), dans la base."""
    t, cls, arm, md = U.TYPE.get(typ, U.TYPE['ligne']), U.cls_of(typ), arm or 0, mods or {}
    pk = power_k(md, cls)
    out = dict(mel=_v(lambda x: K * t['melee'] * xp_k(x) * pk, xp, 1.08 if trait == 'audacieux' else 1.0))
    if cls in ELAN:
        kg = (1.12 if trait == 'audacieux' else 1.0) * (1.2 if trait == 'cavalier' and cls == 'cavalerie' else 1.0)
        # (l'expérience n'y fait rien ; l'infanterie charge en colonne)
        out['chg'] = _v(lambda x: K_CHOC * ELAN[cls] * t['melee'] * pk * charge_k(md, cls), xp, kg)
    if typ == 'mitrailleuses':
        fk = 1.0
    elif cls == 'inf':
        fk = t['fire'] * math.sqrt(R.ARMS['inf'][min(arm, len(R.ARMS['inf']) - 1)][2])
    elif cls == 'cavalerie':
        fk = t['fire'] * math.sqrt(0.8)   # ses carabines
    elif cls == 'artillerie':
        fk = R.ARMS['artillerie'][min(arm, len(R.ARMS['artillerie']) - 1)][2]
    else:
        fk = None   # état-major, chariot : ils ne tirent pas
    if fk and cls == 'inf':
        fk *= 1 + md.get('ligne_fire', 0.0)   # feu de rang, de peloton : en ligne, comme la base
    if fk:
        art = cls == 'artillerie' and typ != 'mitrailleuses' and trait == 'artilleur'
        out['pre'] = _v(lambda x: K * fk * pk * xp_k(x), xp, 1.25 if art else 1.0)
        out['rec'] = _v(lambda x: U.reload_time(U.Unit(type=typ, cls=cls, arm=arm, xp=x)), xp)
        out['por'] = list(U.ranges(dict(type=typ, arm=arm)))
        out['mun'] = U.ammo0_of(cls)
        if typ == 'mitrailleuses' or cls != 'artillerie':
            # portée de justesse : la Précision (à bout portant) y tombe de moitié (units.precision, 1/(1+(d/D50)²))
            p = U.precision(U.Unit(type=typ, cls=cls, arm=arm), 100.0)
            out['jus'] = round(100 / math.sqrt(1 / p - 1))
    out['vit'] = _v(lambda x: t['speed'], xp, 1.1 if trait == 'cavalier' and cls == 'cavalerie' else 1.0, 1)
    kd = 1 / 0.85 if trait == 'inspirant' else 1 / 0.9 if trait == 'prudent' and defender else 1.0
    out['dis'] = _v(lambda x: K * t['steady'], xp, kd)
    if cls == 'inf':
        out['car'] = _v(lambda x: max(10.0, B.FORM_TIME['carre'] * max(0.4, 1 - 0.4 * x / 100 - swift)), xp)
    return out


def of_unit(u, tb):
    """Les valeurs d'une unité tactique dans sa bataille (trait du général vivant, ordre mixte de son camp)."""
    return stats(u.type, u.arm, u.xp, tb.trait(u.side), u.side == 1, tb.spec.get('fm_swift', [0, 0])[u.side],
                 tb.tech(u.side))
