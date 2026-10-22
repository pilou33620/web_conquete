"""Unités tactiques : une par régiment de campagne (et par compagnie de milice d'une place), plus l'état-major.

Chiffres de référence (contrat, § 2 et § 4) :
- dotation d'un plein de munitions : infanterie 60 cartouches par homme, artillerie 120 coups par pièce
  (8 pièces par batterie), cavalerie 20 (pistolets, carabines) ;
- portées (efficace / maximale / mitraille), dérivées du type et de la génération d'armes `arm` : ranges(reg) ;
- justesse du feu : precision(u, d), moitié à D50 ;
- vitesses au pas sur prairie (m/s de bataille) : infanterie 1,2, légère 1,4, cavalerie 2,5 (galop 7),
  artillerie attelée 1,5 ;
- cadence d'un feu soutenu : une salve par minute environ pour le fusil à silex, une volée toutes les 80 à 100 s pour
  les canons lisses (la dotation dure une heure de feu pour l'infanterie, deux heures et demie pour les canons) ;
- emprises au sol : ligne de 300 hommes ≈ 120 × 12 m, colonne ≈ 40 × 50, carré ≈ 45 × 45, tirailleurs ≈ 220 × 30,
  cavalerie en ligne ≈ 100 × 15, batterie en batterie ≈ 80 × 30 ; elles rétrécissent avec les pertes.
"""
import math

from .. import rules as R

AMMO0 = dict(inf=60, artillerie=120, cavalerie=20)
PIECES = 8                     # pièces d'une batterie complète
ART_MEN = 120                  # servants d'une batterie complète

# portées (m) par génération d'armes (rules.ARMS)
INF_RANGE = [(80, 150), (100, 200), (120, 230), (130, 250), (300, 600), (500, 1200), (550, 1300), (600, 1500)]
# justesse du feu en bataille (pas au tir à la cible) : elle baisse dès les premiers mètres, de moitié à D50 mètres
# (fumée, peur, hausse mal réglée, balle lente qui passe au-dessus des têtes), puis comme 1/d² : precision()
INF_D50 = [55, 70, 80, 85, 180, 360, 400, 450]   # par génération d'armes (rules.ARMS), comme INF_RANGE
MIT_D50 = 1000           # mitrailleuse : gerbe étroite, tout se perd si la hausse est fausse
CAV_D50 = 45             # mousquetons et pistolets des cavaliers
ART_RANGE = [(500, 900, 250), (600, 1000, 260), (700, 1100, 280), (800, 1200, 300), (1400, 2500, 330),
             (1800, 3000, 360), (2200, 3500, 400)]
CAV_RANGE = (30, 60)
# batterie de mitrailleuses (Reffye, 1866 ; SPEC-TECH.md) : six pièces (les servants d'une batterie de huit, pièce pour
# pièce : pieces() vaut aussi pour elle), un feu roulant de 25 canons ; ni boulet, ni mitraille
MIT_RANGE = (1200, 2000)
MIT_RELOAD = 12          # une gerbe de 25 balles toutes les 12 s de bataille (les munitions fondent)
# rechargement entre deux salves (s de bataille) : cadence d'un feu soutenu en bataille (une salve par minute environ
# pour le fusil à silex, une volée par minute pour les canons lisses), pas celle de l'exercice ; le chargement par la
# culasse change tout
INF_RELOAD = [70, 62, 60, 55, 55, 25, 22, 18]
ART_RELOAD = [100, 95, 85, 80, 80, 65, 30]
CAV_RELOAD = 30

# caractère de chaque type de troupe
TYPE = {
    'ligne': dict(melee=1.0, fire=1.0, speed=1.2, steady=1.0),
    'legere': dict(melee=0.85, fire=1.05, speed=1.4, steady=0.95),
    'grenadiers': dict(melee=1.5, fire=1.05, speed=1.2, steady=1.3),
    'chasseurs': dict(melee=0.95, fire=1.1, speed=1.45, steady=1.05),
    'sapeurs': dict(melee=0.6, fire=0.6, speed=1.15, steady=0.9),
    'garde': dict(melee=0.7, fire=0.7, speed=1.1, steady=0.85),
    'milice': dict(melee=0.6, fire=0.6, speed=1.1, steady=0.8),
    'cavalerie': dict(melee=1.6, fire=0.4, speed=2.5, steady=1.1),
    'artillerie': dict(melee=0.35, fire=1.0, speed=1.5, steady=1.0),
    'mitrailleuses': dict(melee=0.3, fire=1.0, speed=1.5, steady=1.0),
    'general': dict(melee=0.8, fire=0.2, speed=3.0, steady=1.5),
    'chariot': dict(melee=0.2, fire=0.0, speed=1.3, steady=0.7),
}
WAGON_RANGE = 150.0      # le chariot de munitions recomplète les régiments à moins de 150 m…
WAGON_RATE = 0.04        # … de 4 % de leur dotation par minute…
WAGON_LOAD = 50.0        # … et se vide de 50 % quand il recomplète toute l'armée (deux pleins par chariot)
FORMS = dict(inf=('ligne', 'colonne', 'carre', 'tirailleurs'), cavalerie=('ligne', 'colonne'),
             artillerie=('attelee', 'batterie'), general=('colonne',), chariot=('colonne',))
FRONT = dict(ligne=1.0, tirailleurs=0.6, colonne=0.25, carre=0.25)   # part des hommes qui tirent
FORM_SPEED = dict(ligne=0.8, colonne=1.1, carre=0.4, tirailleurs=1.0, attelee=1.0, batterie=0.0)
FORM_LABEL = dict(ligne='Ligne', colonne='Colonne', carre='Carré', tirailleurs='Tirailleurs', attelee='Attelée',
                  batterie='En batterie')
STATE_LABEL = dict(repos='Au repos', marche='En marche', feu='Feu', recharge='Recharge', charge='Charge',
                   melee='Mêlée', deroute='Déroute', ralliement='Ralliement', hors='Hors de combat')


def cls_of(typ):
    if typ in ('general', 'chariot'):
        return typ
    if typ == 'milice':
        return 'inf'
    return R.UNITS[typ]['cls'] if typ in R.UNITS else 'inf'


def ranges(reg):
    """Portées d'un régiment (dict de campagne ou unité tactique) : (efficace, maximale, mitraille ou None), en mètres.
    Dérivées du type et de la génération d'armes `arm` ; rien n'est stocké."""
    typ = reg['type'] if isinstance(reg, dict) else reg.type
    arm = (reg.get('arm') if isinstance(reg, dict) else reg.arm) or 0
    cls = cls_of(typ)
    if typ == 'mitrailleuses':
        return MIT_RANGE[0], MIT_RANGE[1], None
    if cls == 'artillerie':
        e, m, g = ART_RANGE[max(0, min(arm, len(ART_RANGE) - 1))]
        return e, m, g
    if cls in ('cavalerie', 'general', 'chariot'):
        return CAV_RANGE[0], CAV_RANGE[1], None
    e, m = INF_RANGE[max(0, min(arm, len(INF_RANGE) - 1))]
    return e, m, None


def precision(u, d):
    """Part des coups qui portent à d mètres, rapportée au bout portant (1 à 0 m, moitié à D50)."""
    if u.type == 'mitrailleuses':
        h = MIT_D50
    elif u.cls == 'inf':
        h = INF_D50[max(0, min(u.arm, len(INF_D50) - 1))]
    else:
        h = CAV_D50
    return 1 / (1 + (d / h) ** 2)


def reload_time(u):
    if u.type == 'mitrailleuses':
        base = MIT_RELOAD
    elif u.cls == 'artillerie':
        base = ART_RELOAD[max(0, min(u.arm, len(ART_RELOAD) - 1))]
    elif u.cls == 'inf':
        base = INF_RELOAD[max(0, min(u.arm, len(INF_RELOAD) - 1))]
    else:
        base = CAV_RELOAD
    return base * (1.1 - 0.25 * u.xp / 100) * (1 + 0.25 * u.fat / 100)


def ammo0_of(cls):
    return AMMO0.get(cls, 20)


def pieces(u):
    return max(1, int(math.ceil(PIECES * u.men / ART_MEN - 0.2)))


def footprint(u):
    """(largeur, profondeur) en mètres de l'unité dans sa formation."""
    k = max(0.25, u.men / max(1.0, u.men_nom))
    f = u.form
    if u.cls == 'artillerie':
        p = pieces(u) / PIECES
        return (80 * p + 10, 30) if f == 'batterie' else (30, 30 + 40 * p)
    if u.cls == 'general':
        return 16, 16
    if u.cls == 'chariot':
        return 12, 24
    if u.cls == 'cavalerie':
        return (100 * k, 15) if f == 'ligne' else (30, 60 * k)
    if f == 'colonne':
        return 40, 50 * k
    if f == 'carre':
        s = 45 * math.sqrt(k)
        return s, s
    if f == 'tirailleurs':
        return 220 * k, 30
    return 120 * k, 12


SLOTS = ('id', 'side', 'owner', 'type', 'cls', 'light', 'name', 'men', 'men0', 'men_nom', 'xp', 'xp0', 'morale',
         'morale0', 'fat', 'ammo', 'ammo0', 'arm', 'x', 'y', 'dir', 'form', 'state', 'order', 'seen', 'target',
         'path', 'goal', 'reload', 'busy', 'next_form', 'fire_mode', 'fired_t', 'melee_with', 'rally_t', 'lost',
         'killed', 'captured', 'fought', 'army', 'src', 'nid', 'gen', 'ctrl', 'charge_v', 'spotted_t', 'stuck',
         'rout_seen', 'hit_t', 'wounded', 'group', 'gname', 'halt', 'shot', 'prio', 'still_t')


class Unit:
    __slots__ = SLOTS

    def __init__(self, **kw):
        self.light = False
        self.men_nom = 300.0
        self.xp0 = 0.0
        self.morale0 = 80.0
        self.fat = 0.0
        self.arm = 0
        self.dir = 0.0
        self.state = 'repos'
        self.order = None
        self.seen = False
        self.target = None
        self.path = []
        self.goal = None
        self.reload = 0.0
        self.busy = 0.0
        self.next_form = None
        self.fire_mode = 'free'
        self.fired_t = -999.0
        self.still_t = 0.0      # dernier instant où elle a bougé (retranchements)
        self.melee_with = None
        self.rally_t = 0.0
        self.lost = 0.0
        self.killed = 0.0
        self.captured = 0.0
        self.fought = 0.0
        self.army = None
        self.src = 'reg'
        self.nid = None
        self.gen = None
        self.ctrl = 'ia'
        self.charge_v = 0.0
        self.spotted_t = -999.0
        self.stuck = 0
        self.rout_seen = False
        self.hit_t = -999.0
        self.wounded = False
        self.group = None
        self.gname = None
        self.halt = False      # en déroute : les fuyards se sont arrêtés pour se reformer (près du général, au calme)
        self.shot = 'auto'     # artillerie : projectile ordonné ('auto', 'boulet', 'mitraille')
        self.prio = None       # artillerie : cible de prédilection ('artillerie' : contre-batterie)
        for k, v in kw.items():
            setattr(self, k, v)

    # ------------------------------------------------------------------ état
    @property
    def alive(self):
        return self.state != 'hors' and self.men >= 1

    @property
    def valid(self):
        """En état de combattre (ni en déroute, ni hors de combat) ; l'état-major ne compte pas."""
        return self.state not in ('hors', 'deroute') and self.men >= 1 and self.cls not in ('general', 'chariot')

    def size(self):
        return footprint(self)

    def to_dict(self):
        d = {k: getattr(self, k) for k in SLOTS}
        d['path'] = [[round(p[0], 1), round(p[1], 1)] for p in self.path]
        return d

    @classmethod
    def from_dict(cls, d):
        u = cls()
        for k in SLOTS:
            if k in d:
                setattr(u, k, d[k])
        u.path = [tuple(p) for p in (d.get('path') or [])]
        if u.goal is not None:
            u.goal = list(u.goal)
        return u

    def view(self, mine, seen_by_foe):
        """Ce que le client reçoit de cette unité (contrat, § 6)."""
        w, d = footprint(self)
        e, m, g = ranges(self)
        out = dict(id=self.id, side=self.side, type=self.type, cls=self.cls, name=self.name, men=int(round(self.men)),
                   men0=int(round(self.men0)), x=round(self.x, 1), y=round(self.y, 1), dir=round(self.dir, 3),
                   form=self.form, state=self.state, morale=int(round(self.morale)), fat=int(round(self.fat)),
                   xp=int(round(self.xp)), ammo=round(self.ammo, 1), ammo0=self.ammo0, arm=self.arm,
                   range=[e, m] + ([g] if g else []), w=round(w, 1), d=round(d, 1), owner=self.owner,
                   group=self.group, gname=self.gname)
        if self.cls == 'artillerie':
            out['pieces'] = pieces(self)
        if mine:
            out['seen'] = bool(seen_by_foe)
            out['fire'] = self.fire_mode
            if self.cls == 'artillerie':
                out['shot'] = self.shot
                out['prio'] = self.prio
            if self.target:
                out['target'] = self.target
            if self.order:
                out['order'] = self.order.get('kind')
            if self.busy > 0:
                out['busy'] = round(self.busy)
            if self.path:
                out['path'] = [[round(p[0]), round(p[1])] for p in self.path[:12]]
            if self.state == 'deroute':
                out['halt'] = bool(self.halt)   # (les fuyards se sont arrêtés : on les rallie)
        if self.gen:
            out['gen'] = self.gen
        return out


# de 1760 à 1860, les régiments de cavalerie sont tour à tour dragons (habit vert : web/js/battle/formes.js, uniform),
# chasseurs à cheval et hussards
CAV_NAMES = ('dragons', 'ch. à cheval', 'hussards')


def unit_name(g, owner, typ, idx):
    """Nom affiché : « 3e Ligne », « 1er dragons », « Milice d'Agen »…"""
    if typ == 'general':
        return 'État-major'
    if g is not None and owner in getattr(g, 'factions', {}):
        short = g.unit_name(owner, typ)[1]
    else:
        short = R.UNITS[typ]['short'] if typ in R.UNITS else 'Milice'
    if typ == 'cavalerie' and g is not None and 1760 <= g.date().year < 1860:
        short = CAV_NAMES[(idx - 1) % len(CAV_NAMES)]
    return f"{idx}{'er' if idx == 1 else 'e'} {short}"


def from_reg(reg, side, owner, name, army=None, src='reg', nid=None, ctrl='ia'):
    """Unité tactique tirée d'un régiment de campagne (munitions et fatigue reprises de la campagne)."""
    typ = reg['type']
    cls = cls_of(typ)
    a0 = ammo0_of(cls)
    nom = float(R.UNITS[typ]['men']) if typ in R.UNITS else 300.0
    form = 'attelee' if cls == 'artillerie' else ('tirailleurs' if R.UNITS.get(typ, {}).get('light') else 'ligne')
    return Unit(id=reg['id'], side=side, owner=owner, type=typ, cls=cls, light=bool(R.UNITS.get(typ, {}).get('light')),
                name=name, men=float(reg['n']), men0=float(reg['n']), men_nom=nom, xp=float(reg.get('xp', 0)),
                xp0=float(reg.get('xp', 0)), morale=float(reg.get('morale', 70)), morale0=float(reg.get('morale', 70)),
                fat=float(reg.get('fat', 0.0)), ammo=a0 * reg.get('ammo', 100.0) / 100.0, ammo0=a0,
                arm=int(reg.get('arm') or 0), x=0.0, y=0.0, form=form, army=army, src=src, nid=nid, ctrl=ctrl)


def milice(uid, side, owner, men, morale, arm, name, nid, ctrl='ia'):
    a0 = AMMO0['inf']
    return Unit(id=uid, side=side, owner=owner, type='milice', cls='inf', name=name, men=float(men), men0=float(men),
                men_nom=300.0, xp=10.0, xp0=10.0, morale=float(morale), morale0=float(morale), ammo=float(a0),
                ammo0=a0, arm=arm, form='ligne', src='milice', nid=nid, ctrl=ctrl)


def general(uid, side, owner, gen, army, ctrl='ia'):
    return Unit(id=uid, side=side, owner=owner, type='general', cls='general', name=f"État-major {gen.get('name', '')}".strip(),
                men=30.0, men0=30.0, men_nom=30.0, xp=50.0, xp0=50.0, morale=90.0, morale0=90.0, ammo=20.0, ammo0=20,
                arm=0, form='colonne', src='general', army=army, ctrl=ctrl,
                gen=dict(name=gen.get('name'), trait=gen.get('trait'), lvl=gen.get('lvl', 1),
                         rank=R.GENERAL_RANKS[max(0, min(2, gen.get('lvl', 1) - 1))]))


def wagon(uid, side, owner, army, name, ctrl='ia'):
    """Chariot de munitions d'une armée : recomplète les régiments proches ; se capture ou se détruit.
    ammo : chargement restant, en % (100 = plein)."""
    return Unit(id=uid, side=side, owner=owner, type='chariot', cls='chariot', name=name, men=20.0, men0=20.0,
                men_nom=20.0, xp=0.0, xp0=0.0, morale=60.0, morale0=60.0, ammo=100.0, ammo0=100, arm=0,
                form='colonne', src='chariot', army=army, ctrl=ctrl)
