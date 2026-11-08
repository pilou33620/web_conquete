"""Religion (SPEC-RELIGION.md, décisions 1 à 8) : la part de réformés de chaque place, la ferveur catholique de son
pays, la politique religieuse de chaque camp et ses effets (ordre public, livres, exil, conversions forcées).

    n['rp']        part de réformés de la place (0 à 1)
    n['rgb']       [bonus d'ordre public, jusqu'à quand] : une concession locale aux réformés (revoltes.apaiser)
    f['culte']     politique religieuse du camp (CULTES)
    f['culte_t']   date du dernier changement (un par an)
"""
import hashlib
import os

from . import rules as R

ACTIF = not os.environ.get('CONQUETE_SANS_RELIGION')   # interrupteur du banc d'équilibre (décision 32)

# part de réformés d'un département (1790, à la louche) ; les autres : aucune
PART_DEPT = {'30': 0.35, '67': 0.40, '07': 0.25, '48': 0.20, '26': 0.15, '79': 0.12, '82': 0.12, '17': 0.10, '81': 0.10,
             '68': 0.10, '25': 0.10, '05': 0.06, '09': 0.06, '47': 0.06, '64': 0.05, '34': 0.05, '24': 0.04, '33': 0.03,
             '16': 0.03, '85': 0.03, '86': 0.03, '57': 0.03, '12': 0.03, '08': 0.02, '76': 0.02, '75': 0.02, '88': 0.02}
# villes et bourgs bien plus réformés que leur pays
PART_VILLE = {'Bayonne': 0.0, 'Orthez': 0.6, 'Salies-de-Béarn': 0.4, 'Navarrenx': 0.2, 'Nérac': 0.5, 'Tonneins': 0.5, 'Clairac': 0.6,
              'Bergerac': 0.35, 'Sainte-Foy-la-Grande': 0.6, 'Montauban': 0.4, 'Nîmes': 0.35, 'Alès': 0.5, 'Anduze': 0.8,
              'Saint-Jean-du-Gard': 0.9, 'Uzès': 0.4, 'Le Vigan': 0.5, 'Saint-Hippolyte-du-Fort': 0.6, 'Sauve': 0.6,
              'Sommières': 0.4, 'Ganges': 0.5, 'Meyrueis': 0.5, 'Castres': 0.3, 'Mazamet': 0.5, 'Puylaurens': 0.4,
              'La Rochelle': 0.15, 'Pons': 0.3, 'La Tremblade': 0.5, 'Royan': 0.3, "Saint-Jean-d'Angély": 0.2,
              'Jarnac': 0.3, 'Melle': 0.4, 'Pouzauges': 0.3, 'Mouchamps': 0.6, 'Loudun': 0.15, 'Strasbourg': 0.5,
              'Wissembourg': 0.5, 'Mulhouse': 0.9, 'Sainte-Marie-aux-Mines': 0.6, 'Colmar': 0.3, 'Montbéliard': 0.9,
              'Privas': 0.6, 'Annonay': 0.3, 'Lamastre': 0.6, 'Die': 0.5, 'Dieulefit': 0.6, 'Mens': 0.6, 'Sedan': 0.2,
              'Millau': 0.3, 'Saint-Affrique': 0.3, 'Bolbec': 0.2}
# ferveur catholique : l'Ouest de la chouannerie, le Massif central, le Pays basque, la Savoie (décision 2)
FERVENTS = {'85', '49', '44', '79', '53', '35', '56', '22', '29', '50', '61', '72', '48', '12', '15', '43', '64', '73', '74'}
FERVEUR = 1.6
PROT, MIXTE, CATH = 0.5, 0.15, 0.05   # seuils des noms de confession

# politiques religieuses : années d'ouverture, effet sur l'ordre public des réformés (× part) et des catholiques,
# modificateurs du camp, exil (part de la population réformée qui part chaque mois), conversions (part chaque mois)
CULTES = {
    'tolerance': dict(nom='Tolérance', de=0, a=9999, prot=0.0, cath=0.0, fx={}, exil=0.0, conv=0.0,
                      desc="Chacun prie à sa guise. Avant l'édit de 1787, le clergé grogne (catholiques −2 %)."),
    'contrainte': dict(nom='Contrainte', de=0, a=1789, prot=-0.15, cath=0.02, fx={}, exil=0.003, conv=0.0,
                       desc="L'édit de Fontainebleau appliqué : réformés −15 % (selon leur part), catholiques +2 % ; "
                            "des réformés s'exilent chez le voisin tolérant."),
    'dragonnades': dict(nom='Dragonnades', de=0, a=1760, prot=-0.30, cath=0.04, fx={}, exil=0.01, conv=0.02,
                        desc="Dragons logés chez les réformés : réformés −30 %, catholiques +4 % ; conversions forcées "
                             "(−2 % de réformés par mois) et exil massif."),
    'concordat': dict(nom='Concordat', de=1801, a=9999, prot=0.0, cath=0.03, fx=dict(livres=-0.03), exil=0.0, conv=0.0,
                      desc="Le clergé, salarié par l'État, prêche l'obéissance : catholiques +3 %, livres −3 %."),
    'laique': dict(nom='Clergé soumis à l’État', de=1790, a=9999, prot=0.0, cath=-0.08, fx=dict(livres=0.04), exil=0.0,
                   conv=0.0, desc="Biens du clergé vendus, clergé soumis : livres +4 %, catholiques −8 % (davantage "
                                  "dans les pays fervents)."),
}
ORDRE = ['tolerance', 'contrainte', 'dragonnades', 'concordat', 'laique']
TOLERANCE_AV = 1787   # avant l'édit de tolérance, la tolérance fâche le clergé
TOLERANCE_CATH = -0.02
CHANGE_JOURS = 365    # une politique se garde au moins un an
APAISE_JOURS = 365    # une concession locale aux réformés dure un an


def nom(g, k):
    """Le nom de la politique selon l'époque (le clergé soumis : Constitution civile, anticléricalisme, laïcité)."""
    if k != 'laique':
        return CULTES[k]['nom']
    y = g.date().year
    return 'Constitution civile du clergé' if y < 1801 else 'Anticléricalisme' if y < 1880 else 'Laïcité'


def ouvertes(g, y=None):
    y = g.date().year if y is None else y
    return [k for k in ORDRE if CULTES[k]['de'] <= y <= CULTES[k]['a']]


def defaut(y):
    return 'contrainte' if y < TOLERANCE_AV else 'tolerance' if y < 1801 else 'concordat'


def part_base(gn):
    """Part de réformés d'une place d'après la carte : sa ville connue, sinon son département, variée par place."""
    if gn['name'] in PART_VILLE:
        return PART_VILLE[gn['name']]
    p = PART_DEPT.get(gn['dept'], 0.0)
    if not p:
        return 0.0
    h = int(hashlib.sha1(gn['slug'].encode()).hexdigest()[:6], 16) / 0xFFFFFF   # (tirage fixe, le même à chaque partie)
    p *= 0.2 + 1.6 * h
    return round(p, 3) if p >= CATH else 0.0


def confession(rp):
    return 'protestante' if rp >= PROT else 'mixte' if rp >= MIXTE else 'catholique'


def init(g):
    """Partie neuve ou ancienne sauvegarde : la part de réformés de chaque place, la politique de chaque camp."""
    for n in g.nodes:
        n.setdefault('rp', part_base(g.geo.nodes[n['id']]))
    y = g.date().year
    for f in g.factions.values():
        f.setdefault('culte', defaut(y))


migrate = init


def stab_bonus(g, n):
    """Effet de la politique religieuse du maître sur l'ordre public visé par une place (appelé très souvent)."""
    if not ACTIF:
        return 0.0
    f = g.factions.get(n['owner'])
    if f is None:
        return 0.0
    c = CULTES[f.get('culte', 'tolerance')]
    rp = n.get('rp', 0.0)
    cath = c['cath']
    if cath < 0:
        cath *= FERVEUR if g.geo.nodes[n['id']]['dept'] in FERVENTS else 1.0
    elif cath == 0 and f.get('culte') == 'tolerance' and g.date().year < TOLERANCE_AV:
        cath = TOLERANCE_CATH
    v = rp * c['prot'] + (1 - rp) * cath
    b = n.get('rgb')
    if b and b[1] > g.t:
        v += b[0] * rp
    return v


def mods(g, code, m):
    """Les modificateurs du camp que donne sa politique (Game.recompute_mods)."""
    if not ACTIF:
        return
    for k, v in CULTES[g.factions[code].get('culte', 'tolerance')]['fx'].items():
        m[k] = m.get(k, 0) + v


def set_culte(g, code, k, force=False):
    f = g.factions[code]
    if k not in CULTES:
        return False, "Politique inconnue."
    if k not in ouvertes(g):
        return False, f"{nom(g, k)} : ce n'est pas de cette époque."
    if k == f.get('culte'):
        return False, "C'est déjà votre politique."
    if not force and g.t - f.get('culte_t', -1e9) < CHANGE_JOURS:
        return False, f"Une politique religieuse se garde un an (jusqu'au {g.date_str(f['culte_t'] + CHANGE_JOURS)})."
    f['culte'] = k
    f['culte_t'] = g.t
    g.recompute_mods(code)
    g._dirty_income = True
    return True, f"Politique religieuse : {nom(g, k).lower()}."


def mensuel(g):
    """Chaque mois (Game.monthly) : politique sortie de son époque, exil et conversions forcées."""
    if not ACTIF:
        return
    ok = ouvertes(g)
    for code, f in g.factions.items():
        if f['alive'] and f.get('culte') not in ok:
            f['culte'] = defaut(g.date().year)
            g.recompute_mods(code)
            if code == g.player:
                g.log('info', f"Les temps changent : votre politique religieuse devient « {nom(g, f['culte']).lower()} ».",
                      important=True)
    nb = None
    exiles = {}
    for n in g.nodes:
        rp = n.get('rp', 0.0)
        if rp < CATH:
            continue
        f = g.factions.get(n['owner'])
        if f is None:
            continue
        c = CULTES[f['culte']]
        if not c['exil']:
            continue
        lost = n.get('pop', 0) * rp * c['exil']
        n['pop'] = n.get('pop', 0) - lost
        exiles[n['owner']] = exiles.get(n['owner'], 0.0) + lost
        if c['conv']:
            n['rp'] = round(rp * (1 - c['conv']), 4)
            n['stab'] = max(0.0, n['stab'] - 0.01)   # (des « nouveaux convertis » qui ne pardonnent pas)
    for code, lost in exiles.items():
        nb = nb or g.frontieres()[0]
        refuge = next((o for o in sorted(nb.get(code, ())) if g.factions[o]['alive']
                       and not CULTES[g.factions[o]['culte']]['exil']), None)
        if refuge:
            g.factions[refuge]['refu'] = g.factions[refuge].get('refu', 0.0) + lost * R.POP_REFUGE
        if code == g.player and lost >= 50:
            g.log('revolte', f"Exil des réformés : {R.nb(round(lost, -1))} artisans et négociants ont quitté vos terres ce "
                             f"mois-ci" + (f", pour {g.fname(refuge)}." if refuge else " pour le Refuge (Genève, Londres, "
                                                                                       "Amsterdam)."), who=code)


def ia_culte(g, code, belliqueux):
    """Chaque année, l'IA prend la politique de son époque qui lui rapporte le plus (décision 21)."""
    f = g.factions[code]
    if g.t - f.get('culte_t', -1e9) < CHANGE_JOURS:
        return
    mine = g.owned_nodes(code)
    if not mine:
        return
    cur = f['culte']
    best, bv = cur, None
    pop = sum(n.get('pop', 0) for n in mine) or 1.0
    part = sum(n.get('pop', 0) * n.get('rp', 0.0) for n in mine) / pop
    for k in ouvertes(g):
        if k == 'dragonnades' and k != cur:
            continue   # (les dragonnades ne viennent que d'un événement)
        f['culte'] = k
        v = sum(stab_bonus(g, n) * n.get('pop', 0) for n in mine) / pop + 0.5 * CULTES[k]['fx'].get('livres', 0)
        v -= 40 * CULTES[k]['exil'] * part   # l'exil vide les villes de leurs artisans
        if belliqueux and k == 'contrainte':
            v += 0.01
        if k == cur:
            v += 0.005   # (on ne change pas pour presque rien)
        if bv is None or v > bv:
            best, bv = k, v
    f['culte'] = cur
    if best != cur:
        set_culte(g, code, best)


def vue(g, code):
    """La politique religieuse d'un camp pour le panneau Production et impôts."""
    f = g.factions[code]
    mine = g.owned_nodes(code)
    ref = sum(n.get('pop', 0) * n.get('rp', 0.0) for n in mine)
    pop = sum(n.get('pop', 0) for n in mine) or 1.0
    t = f.get('culte_t', -1e9) + CHANGE_JOURS
    return dict(k=f.get('culte', 'tolerance'), nom=nom(g, f.get('culte', 'tolerance')),
                options=[[k, nom(g, k), CULTES[k]['desc']] for k in ouvertes(g)],
                ref=int(round(ref, -1)), part=round(ref / pop, 3), lib=None if t <= g.t else g.date_str(t))
