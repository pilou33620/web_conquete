"""Familles dirigeantes (SPEC-MERCENAIRES.md, « Familles et successions ») : la maison de chaque camp, son chef, ses
héritiers et ses mariages ; chaque année, naissances, morts et successions, et la crise quand il n'y a pas d'héritier.

    f['maison'] = dict(nom, chef=dict(nom, ne, trait) | None (succession en cours), conjoint=None | dict(nom, de),
                       heritiers=[dict(nom, ne[, conjoint])], liens={camp: année du mariage})
"""
import random

from . import rules as R
from . import events as EV


def _rng(g, code, quoi):
    # (son propre tirage, fixé par la partie, l'année et le camp : le hasard commun de la partie n'est pas décalé)
    return random.Random(f"{g.seed}-{g.date().year}-{code}-{quoi}")


def _trait(rnd):
    return rnd.choice(list(R.MAISON_TRAITS))


def nouvelle(g, code):
    """La maison d'un camp en début de partie, ou d'une ancienne sauvegarde au chargement."""
    rnd = _rng(g, code, 'maison')
    y = g.date().year
    nom = rnd.choice(R.MAISON_NOMS[code])
    chef = dict(nom=f"{rnd.choice(R.PRENOMS)} {nom}", ne=y - rnd.randint(28, 52), trait=_trait(rnd))
    m = dict(nom=nom, chef=chef, conjoint=None, heritiers=[], liens={})
    if rnd.random() < 0.7:
        m['conjoint'] = dict(nom=f"{rnd.choice(R.PRENOMS_F)} {rnd.choice(R.SURNAMES)}", de=None)
        m['heritiers'] = sorted((dict(nom=f"{rnd.choice(R.PRENOMS)} {nom}", ne=rnd.randint(max(chef['ne'] + 20, y - 20), y))
                                 for _ in range(rnd.randint(0, 3))), key=lambda h: h['ne'])
    return m


def titre(g):
    y = g.date().year
    return [t for a, t in R.MAISON_TITRES if a <= y][-1]


def lie(g, a, b):
    """Les maisons de a et b sont-elles unies par un mariage ?"""
    return b in (g.factions[a].get('maison') or {}).get('liens', {})


def epoux(g, code):
    """Qui la maison peut marier : le chef s'il est seul, sinon l'aîné des héritiers libres (None : personne)."""
    m = g.factions[code].get('maison')
    if not m or not m['chef']:
        return None
    if not m['conjoint']:
        return m['chef']
    return next((h for h in m['heritiers'] if not h.get('conjoint')), None)


def refus_mariage(g, a, b):
    """Raison pour laquelle a et b ne peuvent pas marier leurs maisons (None : ils le peuvent)."""
    if g.at_war(a, b):
        return "Pas de mariage avec un ennemi."
    if lie(g, a, b):
        return "Vos deux maisons sont déjà unies par un mariage."
    for x in (a, b):
        if not epoux(g, x):
            return f"{g.fname(x)} n'a personne à marier (ni chef seul, ni héritier libre)."
    return None


def marier(g, a, b):
    """Mariage entre les maisons de a et b : chacun marie son chef seul ou son aîné libre à une fille de l'autre maison."""
    from . import diplomacy as D
    y = g.date().year
    noms = []
    for x, o in ((a, b), (b, a)):
        m, p = g.factions[x]['maison'], epoux(g, x)
        c = dict(nom=f"{_rng(g, x, 'mariage-' + o).choice(R.PRENOMS_F)} {g.factions[o]['maison']['nom']}", de=o)
        if p is m['chef']:
            m['conjoint'] = c
        else:
            p['conjoint'] = c
        m['liens'][o] = y
        g.factions[x]['rel'][o] = min(100, g.factions[x]['rel'][o] + R.MARIAGE_REL)
        noms.append(f"{p['nom']} épouse {c['nom']}")
    p = g.player
    g.log('diplo', f"Mariage entre les maisons {R.de(g.fname(a))} et {R.de(g.fname(b))} : {' ; '.join(noms)}.", who=a,
          important=p in (a, b) or D.borders(g, p, a) or D.borders(g, p, b))


def guerre(g, a, b):
    """a déclare la guerre à b (diplomacy.declare_war) : contre une maison alliée par mariage, son pays gronde."""
    if not lie(g, a, b):
        return
    g.factions[a].setdefault('tmods', []).append(dict(k='order', v=-0.1, until=g.t + R.PARJURE_JOURS))
    g.recompute_mods(a)
    if a == g.player:
        g.log('revolte', f"Faire la guerre à une maison alliée par mariage indigne le pays : ordre public −10 % "
                         f"pendant {R.PARJURE_JOURS // 30} mois.", important=True)


# ------------------------------------------------------------------ chaque année
def annuel(g):
    """En janvier (Game.monthly) : naissances, puis la mort du chef selon son âge."""
    y = g.date().year
    for code, f in g.factions.items():
        m = f.get('maison')
        if not f['alive'] or not m or not m['chef']:
            continue
        rnd = _rng(g, code, 'vie')
        age = y - m['chef']['ne']
        if m['conjoint'] and age < R.NAISSANCE_AGE and len(m['heritiers']) < R.HERITIERS_MAX and rnd.random() < R.NAISSANCE_P:
            m['heritiers'].append(dict(nom=f"{rnd.choice(R.PRENOMS)} {m['nom']}", ne=y))
            if code == g.player:
                g.log('info', f"Naissance dans votre maison : {m['heritiers'][-1]['nom']}.", who=code)
        # rare avant 50 ans, puis de plus en plus probable (12 % à 60 ans, 36 % à 80 ans)
        if rnd.random() < min(0.6, max(0.005, (age - 50) * 0.012)):
            mort(g, code, rnd)


def mort(g, code, rnd):
    """Le chef meurt : l'aîné des héritiers lui succède ; sans héritier, crise de succession."""
    from . import diplomacy as D
    f = g.factions[code]
    m, chef = f['maison'], f['maison']['chef']
    age = g.date().year - chef['ne']
    imp = code == g.player or D.borders(g, g.player, code)
    qui = f"{chef['nom']}, {titre(g).lower()} {R.de(g.fname(code))}"
    if m['heritiers']:
        h = min(m['heritiers'], key=lambda x: x['ne'])
        m['heritiers'].remove(h)
        m['chef'] = dict(nom=h['nom'], ne=h['ne'], trait=_trait(rnd))
        m['conjoint'] = h.get('conjoint')
        g.recompute_mods(code)
        g.log('evenement', f"Mort {R.de(qui)}, à {age} ans. Son aîné {h['nom']} lui succède "
                           f"({R.MAISON_TRAITS[m['chef']['trait']]['label'].lower()}).", who=code, important=imp)
        return
    m['chef'] = m['conjoint'] = None
    g.log('evenement', f"Mort {R.de(qui)}, à {age} ans, sans héritier : crise de succession.", who=code, important=imp)
    crise(g, code, chef, rnd)


def crise(g, code, chef, rnd):
    """Crise de succession : six mois de désordre, et un événement à choix (le cousin, le plus prudent, en dernier)."""
    f = g.factions[code]
    m = f['maison']
    y = g.date().year
    EV.apply(g, code, dict(tmod=dict(order=-0.1), days=R.CRISE_JOURS))
    # le prétendant étranger : la maison alliée par mariage que l'on aime le plus
    lies = [o for o in m['liens'] if g.factions[o]['alive'] and g.factions[o]['maison']['chef']
            and not g.at_war(code, o) and g.factions[o]['overlord'] != code]
    pret = max(lies, key=lambda o: f['rel'][o]) if lies else None
    autres = [n for n in R.MAISON_NOMS[code] if n != m['nom']]
    choices = []
    if pret:
        mp = g.factions[pret]['maison']
        nom = f"{rnd.choice(R.PRENOMS)} {mp['nom']}"
        choices.append(dict(label=f"Reconnaître le prétendant {nom} : vassalité envers {g.fname(pret)}",
                            fx=dict(chef=dict(nom=nom, ne=y - rnd.randint(20, 40), trait=_trait(rnd), maison=mp['nom']),
                                    vassal=pret), ai=3 if f['rel'][pret] > 40 else 1))
    refus = dict(refus=pret) if pret else {}
    nom = rnd.choice(autres)
    choices.append(dict(label=f"Faire élire un notable, {nom}",
                        fx=dict(res=dict(livres=-300), chef=dict(nom=f"{rnd.choice(R.PRENOMS)} {nom}", ne=y - rnd.randint(35, 55),
                                                                 trait=_trait(rnd), maison=nom), **refus), ai=2))
    choices.append(dict(label=f"Appeler un cousin de la maison {m['nom']}",
                        fx=dict(stab=-0.08, chef=dict(nom=f"{rnd.choice(R.PRENOMS)} {m['nom']}", ne=y - rnd.randint(25, 45),
                                                      trait=_trait(rnd)), **refus), ai=2))
    ev = dict(id='crise_succession', who=[code], title='Crise de succession', choices=choices,
              text=f"{chef['nom']} meurt sans héritier ; les factions se disputent sa place. Six mois de désordre : "
                   f"ordre public −10 % dans tout le pays." + (f" {g.fname(pret)}, uni à la maison par mariage, fait "
                                                                f"valoir ses droits : le refuser peut mener à la guerre." if pret else ''))
    EV.fire(g, code, ev, 'hist')


def appliquer(g, code, fx):
    """Les effets d'un choix de crise de succession (events.apply) : le nouveau chef, la vassalité, le refus."""
    from . import diplomacy as D
    m = g.factions[code]['maison']
    if fx.get('chef'):
        c = dict(fx['chef'])
        m['nom'] = c.pop('maison', m['nom'])
        m['chef'], m['conjoint'] = c, None
    o = fx.get('vassal')
    if o and g.factions[o]['alive'] and g.factions[o]['overlord'] != code:
        D.make_vassal(g, code, o)
    o = fx.get('refus')
    # le prétendant éconduit (une IA) peut prendre les armes : guerre de succession
    if o and o != g.player and g.factions[o]['alive'] and not D.war_refusal(g, o, code) \
            and g.rng.random() < 0.3 + 0.4 * R.FACTIONS[o]['personality']['aggr']:
        g.log('diplo', f"{g.fname(o)} revendique la succession {R.de(g.fname(code))} : guerre de succession !", who=o,
              important=True)
        D.declare_war(g, o, code)


def decrire(g, fx):
    """Les effets propres aux crises de succession, en clair (events.describe)."""
    out = []
    if fx.get('chef'):
        out.append(f"nouveau chef : {fx['chef']['nom']} ({R.MAISON_TRAITS[fx['chef']['trait']]['label'].lower()})")
    if fx.get('vassal'):
        out.append(f"vassal {R.de(g.fname(fx['vassal']))}")
    if fx.get('refus'):
        out.append(f"{g.fname(fx['refus'])} éconduit peut déclarer la guerre")
    return out


def vue(g, code):
    """La maison pour la carte du camp (Diplomatie)."""
    m = g.factions[code].get('maison')
    if not m:
        return None
    y, ch = g.date().year, m['chef']
    tr = R.MAISON_TRAITS[ch['trait']] if ch else None
    return dict(nom=m['nom'], titre=titre(g), conjoint=m['conjoint'], her=[y - h['ne'] for h in m['heritiers']],
                liens=sorted(m['liens']), libre=bool(epoux(g, code)),
                chef=dict(nom=ch['nom'], age=y - ch['ne'], trait=tr['label'], desc=tr['desc']) if ch else None)
