"""Moteur de simulation de Conquête, campagne Aquitaine 1790 (temps réel, piloté par le serveur)."""
import datetime
import heapq
import math
import random

from . import rules as R
from . import events as EV
from . import army_actions as AA
from . import battle_log as BL
from . import cities as CT
from . import crue as CR
from . import rails as RL
from . import turns as TT
from .tactics import bridge as TB
from .geo import TERRAIN, T_LANDE, T_MARAIS, T_PLAINE

SUBSTEP = 0.05  # jours
ATTRITION_STEP = 0.25   # jours : pas de l'usure, des désertions et du ravitaillement des armées
CONTACT_KM = 2.6
AMBUSH_KM = 5.0
BASE_DETECT = 2.5
SITE_DAYS = 120   # jours qu'un champ de bataille reste sur la carte (Game.sites)
START_DATE = datetime.date(1790, 3, 4)
START_ORD = START_DATE.toordinal()
PROD_KEYS = ('livres', 'vivres', 'recrues', 'industrie', 'fer', 'bois')


def ordinal(n):
    return '1re' if n == 1 else f'{n}e'


def curve_at(pts, y):
    """Valeur d'une courbe [(année, valeur, …)] interpolée à l'année y, et l'étiquette du segment en cours."""
    if y <= pts[0][0]:
        return pts[0][1], (pts[0][2] if len(pts[0]) > 2 else None)
    for a, b in zip(pts, pts[1:]):
        if y < b[0]:
            return a[1] + (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0]), (a[2] if len(a) > 2 else None)
    return pts[-1][1], (pts[-1][2] if len(pts[-1]) > 2 else None)


class Game:
    # caches de calcul (jamais sauvegardés) : date du jour, année et croissance séculaire du jour, chefs-lieux
    _cache_date = None
    _cache_year = None
    _cache_era = None
    _cache_cap = None
    _cache_ns = None
    _cache_rel = None

    # ================================================================== création
    def __init__(self, geo, player, difficulty='normal', seed=None, scenario='1790'):
        self.geo = geo
        self.player = player
        self.scenario = scenario if scenario in R.SCENARIOS else '1790'
        self.start_ord = datetime.date(*R.SCENARIOS[self.scenario]['date']).toordinal()
        self.difficulty = difficulty if difficulty in R.DIFFICULTY else 'normal'
        self.seed = seed if seed is not None else random.randrange(1 << 30)
        self.rng = random.Random(self.seed)
        self.t = 0.0
        self.speed_idx = 0
        self.uid = 1
        self.seq = 0
        self.events = []
        self.proposals = []
        self.armies = {}
        self.battles = {}
        self.sites = []   # champs de bataille récents, pour la carte (blessés, tombes) : dict(x, y, t, l, o, w, p)
        self.spies = []
        self._blockade = set()
        self.over = None
        self.flood_until = -1
        self.diplo = {}
        self.market = dict(R.MARKET_BASE)
        self._dirty_income = True
        self._last_day = -1
        self._ai_clock = {}
        self.weather = {z: dict(kind='soleil', left=2) for z in R.ZONES}
        self.y_mont = geo.xy(43.2, 0)[1]
        self.x_cote = geo.xy(44, -0.95)[0]

        self.factions = {}
        for code, f in R.FACTIONS.items():
            self.factions[code] = dict(
                code=code, alive=True, res=dict(livres=500, vivres=400, fer=80, bois=120, armes=160, outils=40, recrues=900),
                income={r: 0.0 for r in R.RESOURCES}, slider=0.5, research={b: None for b in R.BRANCHES}, techs=[],
                rel={o: self.rng.randint(-15, 25) for o in R.FACTIONS if o != code}, trade={}, truce={},
                overlord=None, war_since={}, mods={}, army_count=0, stats=dict(won=0, lost=0, captured=0, killed=0),
                start_nodes=0, alerts={}, tax=0.5, intel={}, prisoners={}, weary=0.0, prestige=0.0, treaties={},
                last_war=-2 * 365.0, refu=0.0)   # au départ, de vieilles rancunes : les premières guerres viennent vite
        for a in R.FACTIONS:
            for b in R.FACTIONS:
                if a < b:
                    self.diplo[(a, b)] = 'paix'

        self.nodes = []
        for n in geo.nodes:
            typ = n['type']
            base = R.NODE_BASE[typ]
            owner = n['dept'] if typ in ('capitale', 'ville') else R.NEUTRAL
            fort0 = max(n['fort'], 2) if typ == 'capitale' else n['fort']
            mm = base['milice'] + 40 * fort0
            milice = mm if owner != R.NEUTRAL else int(mm * self.rng.uniform(0.55, 1.0))
            self.nodes.append(dict(id=n['id'], owner=owner, milice=float(milice), milice_max=mm, fort=fort0, dev=0,
                                   pop=float(n['pop0']) * self.pop_trend(n['id']), assim=1.0,
                                   stab=1.0, garrison=[], queue=[], siege=None, last_seen={}, depot=0, rf=0))
            self.nodes[-1]['ph'] = [int(self.nodes[-1]['pop'])]   # population des douze derniers mois
            if owner != R.NEUTRAL:
                self.factions[owner]['start_nodes'] += 1
        sc = R.SCENARIOS[self.scenario]
        if sc.get('techs_before'):
            for f in self.factions.values():
                # avec leurs prérequis, même datés après (le gemmage de 1740 suppose les semis de pins)
                known = {t for t in R.TECH if R.TECH_YEAR[t] <= sc['techs_before']}
                while (missing := {q for t in known for q in R.TECH[t]['req']} - known):
                    known |= missing
                f['techs'] = [t for t in R.TECH if t in known]
        # (les techniques de l'époque d'abord : les premières troupes en ont les armes)
        for code in R.FACTIONS:
            cap = self.capital_of(code)
            self.nodes[cap]['garrison'] = [self.new_reg('ligne', code=code), self.new_reg('ligne', code=code),
                                           self.new_reg('cavalerie', code=code)]
            gx, gy = geo.nodes[cap]['x'], geo.nodes[cap]['y']
            self.create_army(code, gx, gy, [self.new_reg(t, code=code) for t in ('ligne', 'legere', 'cavalerie')], node=cap)
            self.recompute_mods(code)
        self.era_id = self.era()['id']
        TB.ensure(self)        # batailles tactiques : réglage, bataille en cours
        self.pending_ev = []   # décisions qui attendent le joueur
        self.tour = TT.new_state()   # tour par tour, mois par mois (game/turns.py)
        self.rails = {}        # voies ferrées : {tronçon: dict(done, cut[, by, left, total])} (game/rails.py)
        # une partie qui commence tard trouve ouvertes les lignes de son époque (en 1870 : Bordeaux–Bayonne, –Sète…)
        if sc.get('techs_before'):
            for sid, sec in RL.sections(self.geo).items():
                if 0 < sec['year'] < sc['date'][0]:
                    self.rails[sid] = dict(done=True, cut=None)
        self.ev_done = []      # événements datés déjà passés
        if self.scenario == '1790':
            self.log('info', f"4 mars 1790 : l'Assemblée crée les départements. Vous gouvernez {self.fname(player)}.",
                     important=True)
        else:
            self.log('info', f"{self.date_str()} — {self.era()['name']}. Vous gouvernez {self.fname(player)}.", important=True)
        self.log('info', f"Objectif : prendre tous les chefs-lieux (ou obtenir la soumission de leurs {self.dept_word()}s), "
                         f"ou être le plus prestigieux à la fin de 1899.")
        from .ai import AI
        self.ais = {c: AI(self, c) for c in R.FACTIONS if c != player}
        self.compute_income()

    # ================================================================== utilitaires
    def nid(self, prefix):
        self.uid += 1
        return f'{prefix}{self.uid}'

    def new_reg(self, typ, n=None, code=None):
        u = R.UNITS[typ]
        reg = dict(id=self.nid('r'), type=typ, n=float(u['men'] if n is None else n), max=u['men'],
                   xp=float(u.get('xp0', 0)), morale=80.0 + u.get('morale0', 0), ammo=100.0, fat=0.0)
        if u['cls'] in R.ARMS:
            reg['arm'] = self.arm_level(code, u['cls']) if code else 0   # les armes du moment, gardées jusqu'au réarmement
        reg['man'] = self.known_man(code, u['cls'])   # et les manœuvres du moment
        return reg

    # ------------------------------------------------------------------ armement et noms d'époque
    def arm_level(self, code, cls):
        """Meilleure génération d'armes que ce camp sait fabriquer (0 = mousquet et piques, canons de bronze)."""
        if code not in self.factions:
            # villages insurgés : les armes d'une génération déjà répandue (une dizaine d'années de retard)
            y = self.date().year - 10
            return max(i for i, (t, _, _) in enumerate(R.ARMS[cls]) if t is None or R.TECH_YEAR.get(t, 0) <= y)
        techs = self.factions[code]['techs']
        return max(i for i, (t, _, _) in enumerate(R.ARMS[cls]) if t is None or t in techs)

    def arm_k(self, code, cls, level=None):
        return R.ARMS[cls][self.arm_level(code, cls) if level is None else min(level, len(R.ARMS[cls]) - 1)][2]

    def known_man(self, code, cls):
        """Manœuvres de cette classe de troupe que le camp connaît."""
        techs = self.factions[code]['techs'] if code in self.factions else ()
        return [t for t, c in R.MANEUVERS.items() if c == cls and t in techs]

    def reg_lag(self, code, r):
        """Technologies du camp qui ne servent pas encore à ce régiment : manœuvres pas apprises, armes plus récentes
        que les siennes. (La Garde nationale a toujours celles de son camp, comme la milice.)"""
        u = R.UNITS.get(r['type'])
        if code not in self.factions or not u or u['garrison_only']:
            return []
        techs, cls, man = self.factions[code]['techs'], u['cls'], r.get('man', ())
        lag = [t for t, c in R.MANEUVERS.items() if c == cls and t in techs and t not in man]
        if cls in R.ARMS and not u['arm_name']:
            lag += [t for i, (t, _, _) in enumerate(R.ARMS[cls]) if t in techs and i > r.get('arm', 0)]
        return lag

    def reg_mods(self, code, r):
        """Effets de technologie de ce régiment : ceux du camp, moins les effets de régiment (R.REG_KEYS) de ce qui ne
        lui sert pas encore (reg_lag)."""
        md = self.factions[code]['mods'] if code in self.factions else {}
        out = md
        for t in self.reg_lag(code, r):
            for k, v in R.TECH[t]['fx'].items():
                if k in R.REG_KEYS:
                    if out is md:
                        out = dict(md)
                    out[k] = out.get(k, 0.0) - v
        return out

    def milice_k(self, code):
        """La milice se rééquipe à l'arsenal de sa ville : elle a toujours les armes de son camp."""
        return self.arm_k(code, 'inf')

    def unit_name(self, code, typ):
        """(nom, nom court) de ce type de troupe pour ce camp, selon l'époque et ses technologies."""
        u = R.UNITS[typ]
        name, short = u['name'], u['short']
        techs = self.factions[code]['techs'] if code in self.factions else []
        y = self.date().year
        for y0, tech, nm, sh in R.UNIT_NAMES.get(typ, []):
            if y >= y0 and (tech is None or tech in techs):
                name, short = nm, sh
        return name, short

    def modernize_cost(self, code, regs):
        """Prix de « Moderniser » ces régiments (SPEC-ARBRE.md) : les armes du moment (armes, fer pour l'artillerie) et
        MAN_COST livres par homme et par manœuvre à apprendre. Les régiments déjà à l'exercice ne comptent pas."""
        need = {}
        for r in regs:
            lag = [] if r.get('drill') else self.reg_lag(code, r)
            if any(t not in R.MANEUVERS for t in lag):   # une arme plus récente
                for k, v in R.REARM[R.UNITS[r['type']]['cls']].items():
                    need[k] = need.get(k, 0) + v * r['max']
            nm = sum(1 for t in lag if t in R.MANEUVERS)
            if nm:
                need['livres'] = need.get('livres', 0) + R.MAN_COST * r['max'] * nm
        return {k: int(round(v)) for k, v in need.items() if round(v)}

    def modernize(self, code, army_id=None, nid=None):
        """Les régiments d'une armée au repos dans une place amie, ou d'une garnison, prennent les armes et apprennent
        les manœuvres du moment : MAN_DAYS jours d'exercice (drill_tick), payés d'avance ; partir les interrompt."""
        f = self.factions[code]
        if army_id is not None:
            a = self.armies.get(army_id)
            if not a or a['owner'] != code:
                return False, "Armée introuvable."
            if a['state'] != 'idle' or a['at_node'] is None or self.nodes[a['at_node']]['owner'] != code \
                    or self.nodes[a['at_node']]['siege']:
                return False, "Il faut un arsenal : l'armée doit être au repos dans une de vos places, hors siège."
            regs, where = a['regs'], self.geo.nodes[a['at_node']]['name']
        else:
            n = self.nodes[nid]
            if n['owner'] != code or n['siege']:
                return False, "Place indisponible."
            regs, where = n['garrison'], self.geo.nodes[nid]['name']
        cost = self.modernize_cost(code, regs)
        if not cost:
            return False, "Ces régiments ont déjà les armes et les manœuvres du moment."
        if any(f['res'][k] < v for k, v in cost.items()):
            return False, "Pas assez " + ' ni '.join(R.de(k) for k, v in cost.items() if f['res'][k] < v) + " pour moderniser."
        for k, v in cost.items():
            f['res'][k] -= v
        cnt = 0
        for r in regs:
            lag = [] if r.get('drill') else self.reg_lag(code, r)
            if lag:
                cls = R.UNITS[r['type']]['cls']
                r['drill'] = dict(t=self.t + R.MAN_DAYS, man=[t for t in lag if t in R.MANEUVERS],
                                  arm=self.arm_level(code, cls) if any(t not in R.MANEUVERS for t in lag) else None)
                cnt += 1
        self._dirty_income = True
        return True, f"{R.pl(cnt, 'régiment', 'régiments')} à l'exercice à {where} pour un tiers de tour (" + \
            ', '.join(f"{v} {k}" for k, v in cost.items()) + ") : partir avant la fin l'interrompt."

    def drill_tick(self):
        """Chaque jour : les régiments qui ont fini leur exercice prennent leurs armes (et perdent un peu d'expérience
        à réapprendre à tirer) et leurs manœuvres ; une armée qui a quitté sa place abandonne le sien (sans
        remboursement)."""
        for a in list(self.armies.values()):
            if any('drill' in r for r in a['regs']):
                n = a['at_node']
                gone = a['state'] in ('move', 'retreat', 'siege') or n is None or self.nodes[n]['owner'] != a['owner']
                self._drill_end(a['owner'], a['regs'], a['name'], a['x'], a['y'], gone)
        for n in self.nodes:
            if any('drill' in r for r in n['garrison']):
                gn = self.geo.nodes[n['id']]
                self._drill_end(n['owner'], n['garrison'], f"La garnison de {gn['name']}", gn['x'], gn['y'], False)

    def _drill_end(self, code, regs, who, x, y, gone):
        done = 0
        for r in regs:
            d = r.get('drill')
            if not d or (not gone and self.t < d['t']):
                continue
            del r['drill']
            if gone:
                continue
            if d['arm'] is not None and d['arm'] > r.get('arm', 0):
                r['arm'] = d['arm']
                r['xp'] *= 0.85   # il faut réapprendre à tirer
            r['man'] = r.get('man', []) + [t for t in d['man'] if t not in r.get('man', [])]
            done += 1
        if code == self.player and (done or gone):
            self.log('armee', f"{who} a quitté sa place : modernisation abandonnée." if gone else
                     f"{who} : {R.pl(done, 'régiment modernisé', 'régiments modernisés')}.", x, y, who=code)

    def has_sapeurs(self, a):
        return any(r['type'] == 'sapeurs' for r in a['regs'])

    def can_recruit(self, code, nid, typ):
        """(possible, raison) : ce lieu peut-il lever ce régiment (sans compter le coût) ?"""
        u = R.UNITS.get(typ)
        if not u:
            return False, "Unité inconnue."
        gn = self.geo.nodes[nid]
        if gn['type'] == 'village' and typ != 'garde':
            return False, "Un village ne lève que la Garde nationale."
        if gn['type'] == 'fort' and u['cls'] != 'inf':
            return False, "Un fort ne lève que de l'infanterie."
        if R.UNIT_YEAR.get(typ, 0) > self.date().year:
            return False, f"N'existe pas encore (vers {R.UNIT_YEAR[typ]})."
        if u['req'] and u['req'] not in self.factions[code]['techs']:
            return False, f"Technologie requise : {R.TECH[u['req']]['name']}."
        if u.get('where') and gn['dept'] not in u['where']:
            return False, "Se lève seulement en Pays basque et en Béarn."
        return True, ''

    def capital_of(self, code):
        # la carte ne change pas : le chef-lieu de chaque camp n'est cherché qu'une fois
        c = self._cache_cap
        if c is None or c[0] is not self.geo:
            c = self._cache_cap = (self.geo, {})
        if code not in c[1]:
            c[1][code] = next((n['id'] for n in self.geo.nodes if n['dept'] == code and n['type'] == 'capitale'), None)
        return c[1][code]

    def date(self, t=None):
        if t is not None:
            return datetime.date.fromordinal(getattr(self, 'start_ord', START_ORD) + int(t))
        # la date du jour, très demandée (saisons, courbes de population…) : calculée une fois par jour
        o = getattr(self, 'start_ord', START_ORD) + int(self.t)
        c = self._cache_date
        if c is not None and c[0] == o:
            return c[1]
        d = datetime.date.fromordinal(o)
        self._cache_date = (o, d)
        return d

    def date_str(self, t=None):
        d = self.date(t)
        return f"{d.day if d.day > 1 else '1er'} {R.MONTHS[d.month - 1]} {d.year}"

    def year(self):
        d = self.date()
        c = self._cache_year
        if c is not None and c[0] == d:
            return c[1]
        y = d.year + (d.timetuple().tm_yday - 1) / 365.25
        self._cache_year = (d, y)
        return y

    def era(self):
        y = self.date().year
        return [e for e in R.ERAS if e['year'] <= y][-1] if y >= R.ERAS[0]['year'] else R.ERAS[0]

    def pop_era(self, year=None):
        """Croissance séculaire de l'économie à cette date, par rapport à 1790."""
        if year is not None:
            return curve_at(R.POP_ERA, year)[0]
        y = self.year()
        c = self._cache_era
        if c is not None and c[0] == y:
            return c[1]
        v = curve_at(R.POP_ERA, y)[0]
        self._cache_era = (y, v)
        return v

    def _pop_curves(self):
        """Trajectoires de population de tous les lieux à la date du jour (recalculées une fois par mois) :
        multiplicateurs de 1790, croissance annuelle et sa raison, et la moyenne qui sert à normaliser la production."""
        d = self.date()
        key = d.year * 12 + d.month
        c = getattr(self, '_pcache', None)
        if c is None or c['key'] != key:
            y = self.year()
            mult, rate, why = [], [], []
            num = den = 0.0
            for gn in self.geo.nodes:
                cv = R.pop_curve(gn)
                m, w = curve_at(cv, y)
                mult.append(m)
                rate.append(curve_at(cv, y + 1)[0] / m - 1)
                why.append(w)
                # poids : ce que la place produit d'ordinaire (de base, ses spécialités et sa spécialité phare)
                k = sum(R.NODE_BASE[gn['type']][r] for r in ('livres', 'vivres', 'industrie'))
                k += sum(v for s in gn['spec'] for r, v in R.SPEC[s].items() if r != 'label')
                if gn.get('star'):
                    k += sum(v for r, v in R.SPECIALTY[gn['star'][0]].items() if r in ('livres', 'vivres', 'industrie')) \
                        * (R.SPECIALTY_CAPITAL if gn['type'] == 'capitale' else 1)
                num += k * m ** R.POP_TREND_K
                den += k
            c = self._pcache = dict(key=key, mult=mult, rate=rate, why=why, mean_k=num / den)
        return c

    def pop_trend(self, nid, year=None):
        """Population « normale » d'un lieu à cette date, en multiple de celle de 1790 (sa trajectoire propre)."""
        if year is not None:
            return curve_at(R.pop_curve(self.geo.nodes[nid]), year)[0]
        return self._pop_curves()['mult'][nid]

    def pop_norm(self, n):
        return self.geo.nodes[n['id']]['pop0'] * self.pop_trend(n['id'])

    def departements(self):
        return self.date() >= datetime.date(*R.DEPT_DATE)

    def dept_word(self):
        return 'département' if self.departements() else 'province'

    def faction_name(self, code):
        return R.FACTIONS[code]['name'] if self.departements() else R.PROVINCES[code]['name']

    def alert_pause(self, big=False):
        """Aux vitesses rapides, une guerre, une bataille ou une proposition arrête le temps ; un grand moment
        de l'histoire l'arrête toujours."""
        if big or self.speed_idx >= R.FAST_SPEED:
            self.speed_idx = 0

    def season(self):
        return R.SEASONS[self.date().month - 1]

    def flooded(self):
        """La grande crue de la Garonne et de la Dordogne : tirée un printemps sur cinq environ (monthly), 3 à 6 semaines."""
        return self.t < self.flood_until

    def cut_edges(self):
        """Les routes que la crue coupe en ce moment ({arête : tronçons noyés}), vide hors crue."""
        return CR.spans(self.geo) if self.flooded() else {}

    def zone_of(self, x, y):
        if y > self.y_mont:
            return 'montagne'
        if x < self.x_cote:
            return 'cote'
        return 'interieur'

    def wx(self, x, y):
        return R.WEATHER[self.weather[self.zone_of(x, y)]['kind']]

    def log(self, kind, text, x=None, y=None, who=None, important=False, extra=None):
        self.seq += 1
        ev = dict(seq=self.seq, t=round(self.t, 2), date=self.date_str(), kind=kind, text=text, x=x, y=y, who=who,
                  important=important)
        if extra:
            ev.update(extra)
        self.events.append(ev)
        if len(self.events) > 400:
            self.events = self.events[-300:]

    def status(self, a, b):
        if a == b:
            return 'self'
        if a == R.NEUTRAL or b == R.NEUTRAL:
            return 'neutre'
        return self.diplo.get((min(a, b), max(a, b)), 'paix')

    def set_status(self, a, b, s):
        self.diplo[(min(a, b), max(a, b))] = s
        self._dirty_income = True  # un blocus fluvial dépend de l'état de guerre

    def at_war(self, a, b):
        return self.status(a, b) == 'guerre'

    def friendly(self, a, b):
        return a == b or self.status(a, b) == 'alliance'

    def hostile(self, a, b):
        """Deux camps qui peuvent se battre : en guerre, ou l'un des deux est la milice d'une place indépendante."""
        return a != b and (R.NEUTRAL in (a, b) or self.at_war(a, b))

    def valid_node(self, nid):
        return isinstance(nid, int) and 0 <= nid < len(self.nodes)

    def fort_max(self, code, nid):
        """Niveau de fortification le plus haut qu'on peut bâtir ici : bastions à la Vauban réservés aux grandes places."""
        if self.geo.nodes[nid]['type'] in R.BASTION_TYPES and code in self.factions and 'vauban' in self.factions[code]['techs']:
            return R.BASTION_LEVEL
        return R.FORT_MAX

    def lose_fort_level(self, nid):
        n = self.nodes[nid]
        if n['fort'] <= 0:
            return False
        n['fort'] -= 1
        n['milice_max'] = max(20.0, n['milice_max'] - 40)
        n['milice'] = min(n['milice'], n['milice_max'])
        return True

    def node_xy(self, nid):
        n = self.geo.nodes[nid]
        return n['x'], n['y']

    def owned_nodes(self, code):
        return [n for n in self.nodes if n['owner'] == code]

    def mod(self, code, key, default=0.0):
        return self.factions[code]['mods'].get(key, default)

    def recompute_mods(self, code):
        f = self.factions[code]
        m = dict(R.FACTIONS[code]['mods'])
        for t in f['techs']:
            for k, v in R.TECH[t]['fx'].items():
                m[k] = m.get(k, 0) + v
        # effets des événements : durables (classement de 1855…) ou temporaires (blocus, phylloxéra…)
        for k, v in f.get('emods', {}).items():
            m[k] = m.get(k, 0) + v
        for e in f.get('tmods', []):
            if e['until'] > self.t:
                # (blocus, phylloxéra… atténués par les technologies du camp)
                m[e['k']] = m.get(e['k'], 0) + EV.tmod_value(e, m)
        if code != self.player:
            d = R.DIFFICULTY[self.difficulty]
            m['ai_income'] = d['ai_income'] - 1
        f['mods'] = m
        self._dirty_income = True

    # ================================================================== boucle
    def advance(self, real_dt):
        if TB.frozen(self):
            return   # bataille en attente du choix du joueur, ou bataille tactique en cours : campagne figée
        if self.tour['on']:
            return TT.advance(self, real_dt)   # tour par tour : jusqu'au 1er du mois suivant ou à une alerte
        if self.over or self.speed_idx == 0:
            return
        days = R.SPEEDS[self.speed_idx] * real_dt
        while days > 1e-9 and not self.over and self.speed_idx:
            sub = SUBSTEP if (self.battles or self.speed_idx < R.FAST_SPEED) else SUBSTEP * 2
            dt = min(sub, days)
            self.step(dt)
            days -= dt

    def step(self, dt):
        self.t += dt
        day = int(self.t)
        if day != self._last_day:
            self._last_day = day
            self.new_day()
            self.drill_tick()
        if self._dirty_income:
            self.compute_income()
        self.economy(dt)
        self.update_queues(dt)
        self.move_armies(dt)
        self.land_check(dt)
        self.river_fire(dt)
        self.update_spies()
        self.update_hidden()
        self.detect_contacts()
        self.settle_conflicts()
        self.update_sieges(dt)
        AA.tick(self, dt)
        self.update_battles(dt)
        # l'usure varie de quelques millièmes par jour : réglée par quarts de jour (40 % du coût d'un mois sinon)
        self._att_dt = getattr(self, '_att_dt', 0.0) + dt
        if self._att_dt >= ATTRITION_STEP - 1e-9:
            self.attrition(self._att_dt)
            self._att_dt = 0.0
        for code, ai in self.ais.items():
            if not self.factions[code]['alive']:
                continue
            nxt = self._ai_clock.get(code, 0.3 + 0.25 * len(self._ai_clock))
            if self.t >= nxt:
                self._ai_clock[code] = self.t + 1.5
                ai.step()

    # ================================================================== jours, météo, événements
    def new_day(self):
        self._dirty_income = True
        for f in self.factions.values():
            acc = f.get('_acc')
            if acc and acc['dt'] > 0.5:
                f['_measured'] = {k: acc[k] / acc['dt'] for k in ('fer', 'bois', 'armes', 'outils')}
                f['_acc'] = dict(dt=0.0, fer=0.0, bois=0.0, armes=0.0, outils=0.0)
        season = self.season()
        for z, w in self.weather.items():
            w['left'] -= 1
            if w['left'] <= 0:
                weights = dict(R.WEATHER_W[season])
                if z == 'montagne':
                    if 'neige' in weights:
                        weights['neige'] *= 3
                    elif season in ('printemps', 'automne'):
                        weights['neige'] = 8
                    weights.pop('canicule', None)
                elif z == 'cote':
                    weights['tempete'] = weights.get('tempete', 2) * 2
                    weights.pop('canicule', None) if self.rng.random() < 0.5 else None
                if season != 'hiver' and z != 'montagne':
                    weights.pop('neige', None)
                kinds, ws = zip(*weights.items())
                w['kind'] = self.rng.choices(kinds, ws)[0]
                w['left'] = self.rng.randint(1, 4)
        d = self.date()
        self.check_era(d)
        for code, f in self.factions.items():
            if f.get('tmods') and any(e['until'] <= self.t for e in f['tmods']):
                f['tmods'] = [e for e in f['tmods'] if e['until'] > self.t]
                self.recompute_mods(code)
        if not self.over:
            EV.tick(self, d)
            EV.expire(self)
        CT.daily(self, d)   # emplacements, collèges, événements locaux
        if d.day == 1 and int(self.t) > 0:   # (pas au premier jour de la partie : aucun mois n'a encore été joué)
            self.grow_population()
            self.monthly(d)
        for f in self.factions.values():
            if not f['alive']:
                continue
            for o in list(f['truce']):
                if f['truce'][o] < self.t:
                    del f['truce'][o]
        # propositions expirées : on le dit au joueur au lieu de les laisser disparaître
        for p in self.proposals:
            if p['expires'] <= self.t:
                self.log('diplo', f"La proposition de {R.FACTIONS[p['frm']]['name']} est restée sans réponse et a expiré.",
                         who=p['frm'])
        self.proposals = [p for p in self.proposals if p['expires'] > self.t]
        # prix du marché
        for r in self.market:
            base = R.MARKET_BASE[r]
            if r == 'vivres':
                base *= {'hiver': 1.5, 'printemps': 1.1, 'été': 0.85, 'automne': 0.8}[season]
            p = self.market[r] * (1 + self.rng.uniform(-0.04, 0.04))
            self.market[r] = round(max(base * 0.6, min(base * 1.6, p * 0.9 + base * 0.1)), 3)

    def monthly(self, d):
        season = self.season()
        RL.sabotage(self)   # armées ennemies posées sur une voie ferrée
        for code, f in self.factions.items():
            if not f['alive']:
                continue
            if f['res']['livres'] > 0:
                f['res']['livres'] *= 1 + self.mod(code, 'interest') / 12   # caisse d'épargne : tant l'an, au mois
            mine = self.owned_nodes(code)
            if d.month == 1 and self.mod(code, 'strikes'):
                self.strikes(code, mine)
            if d.month in (9, 10):
                vin = sum(1 for n in mine if 'vin' in self.geo.nodes[n['id']]['spec'])
                vin += sum(R.VIN_KINDS.get((self.geo.nodes[n['id']].get('star') or [''])[0], 0) for n in mine)
                if vin:
                    gain = 18 * vin * (1 + self.mod(code, 'vin'))
                    f['res']['livres'] += gain
                    if code == self.player:
                        self.log('eco', f"Vendanges : vos {R.pl(vin, 'vignoble')} rapportent {int(gain)} livres.", important=True)
            if season == 'été' and self.rng.random() < 0.10:
                loss = f['res']['vivres'] * 0.12
                f['res']['vivres'] -= loss
                if code == self.player:
                    self.log('meteo', f"Orage de grêle : {int(loss)} vivres perdus dans les champs.", important=True)
            held = {a['at_node'] for a in self.armies.values() if a['owner'] == code and a['at_node'] is not None}
            for n in mine:
                gn = self.geo.nodes[n['id']]
                if gn['type'] == 'capitale' or n['garrison'] or n['id'] in held or n['siege']:
                    continue
                if n['stab'] < 0.45 and self.rng.random() < (0.45 - n['stab']) * 0.5 * (1 + self.mod(code, 'revolt')):
                    home = gn['dept']
                    back = home != code and home in self.factions and self.factions[home]['alive']
                    n['owner'] = home if back else R.NEUTRAL
                    n['assim'] = 1.0
                    n['depot'] = 0
                    n['milice'] = n['milice_max'] * 0.6
                    n['stab'] = 0.8
                    n['queue'] = []
                    self._dirty_income = True
                    if back:
                        # attachement régional : la ville se donne à sa province d'origine
                        self.log('revolte', f"Révolte à {gn['name']} : fidèle à son pays, la ville chasse les autorités "
                                            f"({self.fname(code)}) et retourne à {self.fname(home)}.",
                                 gn['x'], gn['y'], who=home, important=self.player in (code, home))
                    else:
                        why = "écrasée d'impôts" if f.get('tax', 0.5) > 0.6 else "lasse de l'occupant"
                        self.log('revolte', f"Révolte à {gn['name']} : la population, {why}, chasse les autorités "
                                            f"({self.fname(code)}).",
                                 gn['x'], gn['y'], who=code, important=code == self.player)
                elif n['stab'] < 0.5 and code == self.player and self.rng.random() < 0.3:
                    cure = 'une garnison ou des impôts plus légers' if f.get('tax', 0.5) > 0.05 else 'une garnison'
                    if f.get('famine'):
                        cure = 'des vivres et ' + cure
                    self.log('revolte', f"Agitation à {gn['name']} (ordre public {int(n['stab'] * 100)} %) : "
                                        f"{cure} calmeraient la population.",
                             gn['x'], gn['y'], who=code)
            if f.get('banqueroute'):
                forts = [n for n in mine if n['fort'] > 0 and not n['siege']]
                if forts:
                    n = max(forts, key=lambda x: (x['fort'], -self.geo.nodes[x['id']]['type'].startswith('cap')))
                    self.lose_fort_level(n['id'])
                    self._dirty_income = True
                    if code == self.player:
                        gn = self.geo.nodes[n['id']]
                        self.log('eco', f"Trésor vide : faute d'entretien, les remparts de {gn['name']} se délabrent "
                                        f"(niveau {n['fort']}).", gn['x'], gn['y'], who=code, important=True)
            for k in [k for k, v in f.get('intel', {}).items() if v < self.t]:
                del f['intel'][k]
            # prisonniers : quelques évasions, davantage quand le grenier est vide ; les IA enrôlent
            pr = f.setdefault('prisoners', {})
            for o in list(pr):
                pr[o] = int(pr[o] * (0.88 if f.get('famine') else 0.97))
                if pr[o] <= 0:
                    del pr[o]
            if code != self.player and pr:
                for o in list(pr):
                    if o == R.NEUTRAL or f['res']['recrues'] < 500 or pr[o] > 300:
                        self.enroll(code, o)
        # une génération pour faire sienne une place conquise
        for n in self.nodes:
            if n['owner'] != R.NEUTRAL and n.get('assim', 1.0) < 1.0:
                n['assim'] = min(1.0, n['assim'] + 1 / (12 * R.ASSIM_YEARS))
        # lassitude de la guerre : chaque mois de guerre et chaque homme perdu pèsent, la paix apaise
        for code, f in self.factions.items():
            if not f['alive']:
                continue
            wars = sum(1 for o in self.factions if o != code and self.factions[o]['alive'] and self.at_war(code, o))
            before = f.get('weary', 0.0)
            delta = (R.WEARY_PER_WAR * wars + f.get('_lost_m', 0.0) * R.WEARY_PER_LOSS) if wars else -R.WEARY_PEACE
            # surextension : tenir des pays qui ne vous aiment pas épuise
            delta += R.WEARY_PER_UNRULY * sum(1 for n in self.nodes if n['owner'] == code and n.get('assim', 1.0) < 0.5)
            if delta > 0:
                delta *= 1 + self.mod(code, 'weariness')   # suffrage universel
            f['weary'] = max(0.0, min(100.0, before + delta))
            f['_lost_m'] = 0.0
            if code == self.player and any(before < s_ <= f['weary'] for s_ in (60, 80)):
                self.log('revolte', f"Le pays est las de la guerre (lassitude {int(f['weary'])} %) : l'ordre public "
                                    f"se dégrade partout. Songez à la paix.", important=True)
        # prestige : chaque année, le rayonnement de chacun s'ajoute à sa gloire
        if d.month == 1:
            for code, f in self.factions.items():
                if f['alive']:
                    f['prestige'] = f.get('prestige', 0.0) + self.prestige_now(code) / 10
            self.uprisings()
        # désertions du mois écoulé
        for a in self.armies.values():
            des = int(a.get('des', 0))
            if des >= 10 and a['owner'] == self.player:
                f = self.factions[a['owner']]
                why = a.get('des_why') or 'moral au plus bas'
                self.log('armee', f"Désertions dans la {a['name']} : {des} hommes ont quitté les rangs ({why}).",
                         a['x'], a['y'], who=a['owner'], important=des >= 50)
            a['des'] = 0.0
            a['des_why'] = None
        if d.month == 3 and self.rng.random() < 0.2:   # une grande crue un printemps sur cinq environ
            self.flood_until = self.t + self.rng.randint(21, 42)
            self.log('meteo', 'Grande crue de la Garonne et de la Dordogne : bacs ralentis et routes coupées pendant quelques semaines.', important=True)
            CT.grande_crue(self)
        if self.factions[self.player]['alive']:
            f = self.factions[self.player]
            inc = f['income']
            self.log('eco', f"Bilan {R.de(R.MONTHS[d.month - 2] if d.month > 1 else 'décembre')} : "
                            f"{R.num(inc['livres'] * TT.TOUR_DAYS)} livres et {R.num(inc['vivres'] * TT.TOUR_DAYS)} vivres par tour.",
                     extra=dict(coins=True))

    # ================================================================== économie
    def tools_bonus(self, code):
        f = self.factions[code]
        nn = max(1, len(self.owned_nodes(code)))
        cov = min(1.0, f['res']['outils'] / (3.0 * nn))
        return 1 + (0.30 + self.mod(code, 'tools_max')) * cov, cov

    def node_static(self, nid):
        """Ce qui ne change jamais d'une place (la carte est fixe), relevé une fois : production de base de son
        type, quai, terrain (landes et marais, collines et montagnes)."""
        c = self._cache_ns
        if c is None or c[0] is not self.geo:
            c = self._cache_ns = (self.geo, {})
        st = c[1].get(nid)
        if st is None:
            gn = self.geo.nodes[nid]
            base = R.NODE_BASE[gn['type']]
            ter = self.geo.terrain_at(gn['x'], gn['y'])
            st = c[1][nid] = (gn, {k: base.get(k, 0) for k in PROD_KEYS}, nid in self.geo.ports and gn['type'] != 'fort',
                              ter in (T_LANDE, T_MARAIS), TERRAIN[ter][0] in ('Montagne', 'Collines', 'Haute montagne'))
        return st

    def strikes(self, code, mine):
        """Syndicats : en janvier, chaque ville à l'ordre bas fait grève et perd un tour d'industrie."""
        for n in mine:
            gn = self.geo.nodes[n['id']]
            if gn['type'] in ('ville', 'capitale') and n['stab'] < R.STRIKE_STAB:
                n.setdefault('tm', []).append(dict(k='industrie', v=-1.0, until=TT.deadline(self, 1, code)))
                self._dirty_income = True
                if code == self.player:
                    self.log('revolte', f"Grève à {gn['name']} (ordre public {int(n['stab'] * 100)} %) : les ateliers "
                                        f"sont presque arrêtés pour un tour.", gn['x'], gn['y'], important=True)

    def node_output(self, n, code):
        gn, b0, quai, lande, mont = self.node_static(n['id'])
        out = dict(b0)
        trade = 0.0
        for s in gn['spec']:
            for k, v in R.SPEC[s].items():
                if k != 'label':
                    bonus = 1.0
                    if s == 'vin':
                        bonus += self.mod(code, 'vin')
                    if s == 'port':
                        bonus += self.mod(code, 'port')
                        trade += v * bonus
                    out[k] = out.get(k, 0) + v * bonus
        star = gn.get('star')
        if star:
            sp = R.SPECIALTY[star[0]]
            k = (1 + (self.mod(code, sp['boost']) if sp.get('boost') else 0)) * (R.SPECIALTY_CAPITAL if gn['type'] == 'capitale' else 1)
            for r in ('livres', 'vivres', 'recrues', 'industrie', 'fer', 'bois'):
                if r in sp:
                    out[r] += sp[r] * k
            if sp.get('boost') == 'port':
                trade += sp.get('livres', 0) * k
        if quai:
            out['livres'] += R.QUAI_LIVRES
            trade += R.QUAI_LIVRES
        trade = CT.node_extra(self, n, code, out, trade)   # bâtiments, politique, événements de la ville
        if gn['type'] in ('ville', 'capitale'):
            out['livres'] *= 1 + self.mod(code, 'city_livres')   # éclairage au gaz : les villes travaillent le soir
        rb = RL.town_bonus(self, n['id'])   # voies ferrées ouvertes : industrie et commerce
        if rb:
            out['industrie'] *= 1 + rb
            out['livres'] *= 1 + rb
        if n['id'] in self._blockade:
            out['livres'] -= trade * (1 - R.BLOCKADE_K)
        mult = self.pop_factor(n) * max(0.3, n['stab']) * (0.7 + 0.3 * self.assim(n))
        mult *= 1 - R.DEG_PROD * n.get('deg', 0.0)   # maisons en ruine : moins de bras et d'ateliers
        if n['siege']:
            mult = 0
        mult *= AA.output_k(self, n)   # bourgeois sous les armes
        if lande:
            mult *= 1 + self.mod(code, 'lande_prod')
        if mont:
            mult *= 1 + self.mod(code, 'mountain_prod')
        return {k: v * mult for k, v in out.items()}

    def compute_income(self):
        self._dirty_income = False
        season = self.season()
        self.compute_blockades()
        for code, f in self.factions.items():
            if not f['alive']:
                continue
            tb, cov = self.tools_bonus(code)
            ai = 1 + self.mod(code, 'ai_income')
            tot = dict(livres=0.0, vivres=0.0, recrues=0.0, industrie=0.0, fer=0.0, bois=0.0)
            own = self.owned_nodes(code)
            food0 = R.SEASON_FOOD[season]
            if season == 'hiver':
                food0 += self.mod(code, 'winter_food')
            for n in own:
                gn = self.geo.nodes[n['id']]
                o = self.node_output(n, code)
                food = food0 * self.wx(gn['x'], gn['y'])['food']
                tot['livres'] += o['livres'] * tb
                tot['vivres'] += o['vivres'] * food * tb
                tot['recrues'] += o['recrues']
                tot['industrie'] += o['industrie'] * tb
                tot['fer'] += o['fer']
                tot['bois'] += o['bois']
            tax = f.get('tax', 0.5)
            tot['livres'] *= (1 + self.mod(code, 'livres')) * ai * (0.6 + 0.8 * tax)
            tot['vivres'] *= (1 + self.mod(code, 'vivres')) * ai
            tot['recrues'] *= 1 + self.mod(code, 'recrues') + 0.3 * (0.5 - tax)
            tot['industrie'] *= (1 + self.mod(code, 'industrie')) * ai
            tot['fer'] *= 1 + self.mod(code, 'fer')
            tot['bois'] *= 1 + self.mod(code, 'bois')
            # minimum garanti par le département (tant que le chef-lieu tient)
            f['_floor'] = {}
            if self.nodes[self.capital_of(code)]['owner'] == code:
                food = R.SEASON_FOOD[season] + (self.mod(code, 'winter_food') if season == 'hiver' else 0)
                traits = R.FACTIONS[code]['mods']
                for k, v in R.FLOOR.items():
                    mn = v * (1 + traits.get(k, 0)) * (food if k == 'vivres' else 1)
                    f['_floor'][k] = dict(min=round(mn, 2), add=round(max(0.0, mn - tot[k]), 2))
                    tot[k] = max(tot[k], mn)
            # commerce
            trade_l, trade_s = 0.0, {}
            for o in f['trade']:
                of = self.factions.get(o)
                if not of or not of['alive']:
                    continue
                m = 1 + self.mod(code, 'trade')
                trade_l += 0.06 * max(0, of.get('_gross_livres', 0)) * m + 1.0 * m
                sp = R.FACTIONS[o]['specialty']
                trade_s[sp] = trade_s.get(sp, 0) + 0.05 * max(0, of.get('_gross_' + sp, 0)) * m
            f['_gross_livres'] = tot['livres']
            for k in ('vivres', 'fer', 'bois', 'recrues'):
                f['_gross_' + k] = tot[k]
            tot['livres'] += trade_l
            for k, v in trade_s.items():
                tot[k] = tot.get(k, 0) + v
            # tribut de vassal
            if f['overlord']:
                trib = tot['livres'] * 0.15
                tot['livres'] -= trib
                f['_tribute'] = trib
            else:
                f['_tribute'] = 0
            tot['livres'] += sum(v['_tribute'] for v in self.factions.values() if v['overlord'] == code and v['alive'])
            # entretien
            up_v = up_l = 0.0
            for reg in self.all_regs(code):
                u = R.UNITS[reg['type']]
                up_v += u['upkeep_v'] * reg['n'] / 100
                up_l += u['upkeep_l'] * reg['n'] / 100
            up_v += AA.extra_food(self, code)   # armées en quartiers
            k_up = 1 + self.mod(code, 'upkeep')
            tot['vivres'] -= up_v * k_up
            tot['livres'] -= up_l * k_up
            up_f = sum(R.FORT_UPKEEP[min(n['fort'], R.BASTION_LEVEL)] for n in own)
            tot['livres'] -= up_f
            up_b = CT.upkeep(self, code)   # bâtiments d'emplacement
            tot['livres'] -= up_b
            up_p = sum(f.get('prisoners', {}).values()) * R.PRISONER_FOOD
            tot['vivres'] -= up_p
            # industrie
            cap = tot['industrie']
            s = f['slider']
            f['_arm_rate'] = cap * s * (1 + self.mod(code, 'armes_eff')) * 0.5
            f['_tool_rate'] = cap * (1 - s) * 0.5
            f['_cap'] = cap
            f['_cov'] = cov
            f['_upkeep'] = dict(vivres=up_v * k_up, livres=up_l * k_up, forts=up_f, prisoners=up_p, batiments=up_b)
            f['_trade'] = dict(trade_s)
            f['_trade']['livres'] = f['_trade'].get('livres', 0) + trade_l
            f['income'] = dict(livres=tot['livres'], vivres=tot['vivres'], fer=tot['fer'] - f['_arm_rate'] - 0.5 * f['_tool_rate'] * (1 + self.mod(code, 'tools_cost')),
                               bois=tot['bois'] - 0.5 * f['_arm_rate'] - f['_tool_rate'] * (1 + self.mod(code, 'tools_cost')),
                               armes=f['_arm_rate'], outils=f['_tool_rate'], recrues=tot['recrues'], industrie=cap)
            if f.get('_measured'):
                f['income'].update(f['_measured'])

    def economy(self, dt):
        # places tenues par chacun (plafond des casernes, voir recruit_cap) : un seul passage sur la carte
        held_n = {}
        for n in self.nodes:
            held_n[n['owner']] = held_n.get(n['owner'], 0) + 1
        for code, f in self.factions.items():
            if not f['alive']:
                continue
            r = f['res']
            inc = f['income']
            r['livres'] += inc['livres'] * dt
            r['vivres'] += inc['vivres'] * dt
            # au-delà du plafond des casernes, plus de nouvelles recrues (mais on ne perd pas celles reçues par échange)
            r['recrues'] = min(r['recrues'] + inc['recrues'] * dt, max(3000 + 250 * held_n.get(code, 0), r['recrues']))
            kc = 1 + self.mod(code, 'tools_cost')
            gross_fer = inc['fer'] + f['_arm_rate'] + 0.5 * f['_tool_rate'] * kc
            gross_bois = inc['bois'] + 0.5 * f['_arm_rate'] + f['_tool_rate'] * kc
            r['fer'] += gross_fer * dt
            r['bois'] += gross_bois * dt
            # fabrication limitée par les stocks
            want_a = f['_arm_rate'] * dt
            want_t = f['_tool_rate'] * dt
            ka = min(1.0, r['fer'] / max(1e-9, want_a * 1.0 + want_t * 0.5 * kc), r['bois'] / max(1e-9, want_a * 0.5 + want_t * kc)) \
                if (want_a + want_t) > 0 else 0
            ka = max(0.0, ka)
            r['armes'] += want_a * ka
            r['outils'] += want_t * ka
            r['fer'] -= (want_a + want_t * 0.5 * kc) * ka
            r['bois'] -= (want_a * 0.5 + want_t * kc) * ka
            acc = f.setdefault('_acc', dict(dt=0.0, fer=0.0, bois=0.0, armes=0.0, outils=0.0))
            acc['dt'] += dt
            acc['fer'] += gross_fer * dt - (want_a + want_t * 0.5 * kc) * ka
            acc['bois'] += gross_bois * dt - (want_a * 0.5 + want_t * kc) * ka
            acc['armes'] += want_a * ka
            acc['outils'] += want_t * ka
            r['outils'] -= r['outils'] * 0.004 * (1 + self.mod(code, 'tools_wear')) * dt
            self._granary_dirty(code)
            cap = self.granary_cap(code)
            if r['vivres'] > cap:
                r['vivres'] -= (r['vivres'] - cap) * min(1.0, 0.5 * dt)
            for k in ('vivres', 'fer', 'bois'):
                if r[k] < 0:
                    r[k] = 0.0
            f['famine'] = r['vivres'] <= 0.5 and inc['vivres'] < 0
            f['banqueroute'] = r['livres'] < 0
            # recherche
            for b, cur in f['research'].items():
                if cur:
                    cur['left'] -= TT.work(self, dt) * (1 + self.mod(code, 'research_speed'))
                    if cur['left'] <= 0:
                        f['research'][b] = None
                        f['techs'].append(cur['tech'])
                        f.setdefault('tech_dates', {})[cur['tech']] = [self.date_str(), round(self.t, 2)]   # (la frise des découvertes)
                        self.recompute_mods(code)
                        if code == self.player:
                            arm = next((R.ARMS[c][i][1] for c in R.ARMS for i in range(len(R.ARMS[c]))
                                        if R.ARMS[c][i][0] == cur['tech']), None)
                            self.log('tech', f"Découverte : {R.TECH[cur['tech']]['name']}." +
                                     (f" Nouvel armement ({arm}) pour les régiments levés désormais ; réarmez les anciens "
                                      f"dans vos places (bouton « Réarmer »)." if arm else ''), important=True,
                                     extra=dict(tech=cur['tech']))
                        elif cur['tech'] in R.NOTABLE_TECHS:
                            # une découverte d'une IA qui se voit (sur la carte, en bataille) : un bandeau, sans arrêter le jeu
                            self.log('tech_ia', f"{self.faction_name(code)} découvre : {R.TECH[cur['tech']]['name']}.",
                                     who=code, extra=dict(tech=cur['tech']))
        # milice et stabilité (l'ordre public tend vers une cible : impôts, famine, banqueroute, garnison) :
        # évolutions lentes, calculées par paquets d'un quart de jour pour ménager les petites machines
        self._slow_dt = getattr(self, '_slow_dt', 0.0) + dt
        if self._slow_dt < 0.25:
            return
        dt, self._slow_dt = self._slow_dt, 0.0
        targets = self.stab_targets()
        held = {}
        for a in self.armies.values():
            if a['at_node'] is not None:
                held.setdefault(a['at_node'], set()).add(a['owner'])
        per = {}   # ce qui ne dépend que du maître de la place (rien ne le change dans cette boucle)
        for n in self.nodes:
            if n['siege']:
                continue
            code = n['owner']
            pc = per.get(code)
            if pc is None:
                if code == R.NEUTRAL:
                    pc = (1 + 0, 1.0, 0, 1.0, 1 + 0)
                else:
                    fc = self.factions[code]
                    pc = (1 + self.mod(code, 'milice'), targets.get(code, 1.0), fc.get('weary', 0) / 250,
                          1 + max(0.0, 0.5 - fc.get('tax', 0.5)) * 2, 1 + self.mod(code, 'stab'))
                per[code] = pc
            k, tgt0, weary, boost0, kstab = pc
            mm = n['milice_max'] * k
            if n['milice'] < mm:
                n['milice'] = min(mm, n['milice'] + mm * 0.012 * dt)
            if code == R.NEUTRAL:
                tgt, boost = 1.0, 1.0
            else:
                tgt = tgt0
                tgt -= 0.2 * (1 - self.assim(n)) + weary
                friends = any(self.friendly(code, o) for o in held.get(n['id'], ()))
                if n['garrison'] or friends or self.geo.nodes[n['id']]['type'] == 'capitale':
                    tgt += 0.15
                tgt += AA.stab_bonus(self, n)
                tgt += CT.stab_bonus(self, n)   # hospices, politique de la ville
                tgt = max(0.1, min(1.0, tgt))
                boost = boost0
            if n['stab'] < tgt:
                rate = 0.012 * boost * kstab
                n['stab'] = min(tgt, n['stab'] + rate * dt)
            elif n['stab'] > tgt:
                n['stab'] = max(tgt, n['stab'] - 0.01 * dt)
            # renfort des garnisons
            if code != R.NEUTRAL and n['garrison']:
                self.replenish(code, n['garrison'], dt, 0.04)

    def assim(self, n):
        """Attachement à son nouveau maître : 1 dans sa province d'origine, de 0 à 1 en une génération ailleurs."""
        if n['owner'] == self.geo.nodes[n['id']]['dept'] or n['owner'] == R.NEUTRAL:
            return 1.0
        return n.get('assim', 1.0)

    def pop_factor(self, n):
        """Multiplicateur de production d'une place : il suit sa population."""
        if 'pop' not in n:
            return 1 + 0.25 * n['dev']
        # remplissage de la place (au plus 110 %, réfugiés compris), multiplié par ce que ses faubourgs font produire
        # (30 % de la production de 1790 par agrandissement) ; la croissance séculaire n'en donne que la racine
        # (les métiers suivent), et une place qui grandit plus vite que les autres n'en tire qu'un peu plus
        # (racine quatrième de sa trajectoire, moyenne normalisée à 1 sur toute la carte)
        c = self._pop_curves()
        r = self._cache_rel
        if r is None or r[0] is not c:
            # part de chaque place dans la croissance (ne change qu'avec les courbes, une fois par mois)
            r = self._cache_rel = (c, [m ** R.POP_TREND_K / c['mean_k'] for m in c['mult']])
        rel = r[1][n['id']]
        era = self.pop_era()
        fill = min(1.1, n['pop'] / max(1.0, self.pop_cap(n)))
        return fill * (1 + (R.POP_NATURAL + R.DEV_PROD * n['dev']) / era) * era ** 0.5 * rel

    def pop_cap(self, n):
        """Population que la place peut loger : sa normale de l'époque, plus 10 % par agrandissement."""
        return self.pop_norm(n) * (1 + R.POP_NATURAL + R.POP_PER_LEVEL * n['dev'])

    def pop_growth(self, n):
        """Part de la place libre comblée en un mois (négative : part des habitants qui s'en vont)."""
        o = n['owner']
        s = n['siege']
        if s:
            if s.get('occupy'):
                return 0.0    # ralliement : on attend de voir
            # plus le siège dure, plus on fuit (ou on meurt de faim derrière les remparts)
            months = int((self.t - s.get('since', self.t)) / 30)
            return -min(0.05, R.POP_SIEGE + 0.01 * months) if self.pop_above_floor(n) else 0.0
        f = self.factions.get(o)
        if f and (f.get('famine') or n['stab'] < R.POP_UNREST):
            if not self.pop_above_floor(n):
                # la place a touché le fond : les familles reviennent peu à peu, malgré tout
                return R.POP_RETURN if n['pop'] < self.pop_norm(n) * R.POP_FLOOR else 0.0
            return -R.POP_FAMINE if f.get('famine') else -R.POP_UNREST_RATE
        rate = R.POP_RATE * max(0.0, min(1.0, (n['stab'] - 0.3) / 0.7))
        if f and f.get('tax', 0.5) > 0.6:
            rate *= max(0.0, 1 - (f['tax'] - 0.6) * 2.5)
        rate *= CT.growth_k(self, n)   # hospices, politique de la ville
        if n['pop'] < self.pop_norm(n) * R.POP_FLOOR:
            rate = max(rate, R.POP_RETURN)
        return rate

    def pop_above_floor(self, n):
        """Reste-t-il des habitants à faire fuir ? (plancher : 50 % de la normale, 30 % sous un siège)"""
        return n['pop'] > self.pop_norm(n) * (R.POP_FLOOR_SIEGE if n['siege'] else R.POP_FLOOR) + 1

    def grow_population(self):
        """Chaque mois, chaque place tend vers sa population normale (sa trajectoire, plus la place gagnée par ses
        agrandissements). Sièges et désordre font fuir les habitants vers les places sûres du même camp ;
        la disette les chasse au loin."""
        fled = {}
        for n in self.nodes:
            n['rf'] = 0
            cap = self.pop_cap(n)
            g = self.pop_growth(n)
            if g < 0:
                # la fuite ralentit à l'approche du plancher : une disette qui dure ne vide pas tout le pays
                floor = self.pop_norm(n) * (R.POP_FLOOR_SIEGE if n['siege'] else R.POP_FLOOR)
                lost = max(0.0, min(n['pop'] * -g, n['pop'] - floor))
                n['pop'] -= lost
                f = self.factions.get(n['owner'])
                if f and not f.get('famine'):
                    fled[n['owner']] = fled.get(n['owner'], 0.0) + lost * R.POP_REFUGE
            elif n['pop'] < cap:
                n['pop'] += (cap - n['pop']) * g
            else:
                # trop de monde pour la place (campagne qui se vide, réfugiés) : le surplus s'en va peu à peu
                n['pop'] -= (n['pop'] - cap) * R.POP_EXCESS
        for code, f in self.factions.items():
            k = fled.get(code, 0.0) + f.get('refu', 0.0)
            f['refu'] = 0.0
            if k >= 1 and f['alive']:
                self.shelter(code, k)
        for n in self.nodes:
            ph = n.setdefault('ph', [])
            ph.append(int(n['pop']))
            del ph[:-13]
        self._dirty_income = True

    def shelter(self, code, k):
        """Des réfugiés gagnent les places sûres de leur camp, au prorata de la place libre ; les autres s'exilent."""
        room = [(n, max(0.0, self.pop_cap(n) * 1.1 - n['pop'])) for n in self.owned_nodes(code)
                if not n['siege'] and n['stab'] >= R.POP_SAFE_STAB]
        tot = sum(r for _, r in room)
        if tot < 1:
            return 0
        k = min(k, tot)
        for n, r in room:
            add = k * r / tot
            n['pop'] += add
            n['rf'] = n.get('rf', 0) + int(add)
        return k

    def pop_year(self, nodes):
        """Population de ces places aujourd'hui et il y a un an (ou au plus loin dont on se souvienne)."""
        now = sum(n.get('pop', 0) for n in nodes)
        before = sum((n.get('ph') or [n.get('pop', 0)])[0] for n in nodes)
        return now, before

    def recruit_cap(self, code):
        return 3000 + 250 * len(self.owned_nodes(code))

    def add_recrues(self, code, n):
        """Recrues venues d'ailleurs (échange, prisonniers) : pas au-delà de ce que les casernes peuvent loger."""
        r = self.factions[code]['res']
        room = max(0.0, self.recruit_cap(code) - r['recrues'])
        got = min(float(n), room)
        r['recrues'] += got
        return got

    def _granary_dirty(self, code):
        f = self.factions[code]
        if f.get('_nn_t', -1) != int(self.t):
            f['_nn_t'] = int(self.t)
            f['_nn'] = max(1, len(self.owned_nodes(code)))
        return False

    def granary_cap(self, code):
        return (600 + 70 * self.factions[code].get('_nn', 1)) * (1 + self.mod(code, 'granary'))

    def replenish(self, code, regs, dt, rate):
        top = 100 + self.mod(code, 'morale')
        for reg in regs:
            if reg['n'] < reg['max']:
                k = R.REPL_MONTE if AA.monte(reg) else 1.0
                self.reinforce(code, reg, min(reg['max'] - reg['n'], reg['max'] * rate * k * dt))
            reg['morale'] = min(top, reg['morale'] + 6 * dt)

    def reinforce(self, code, reg, add):
        """Verse add recrues au régiment s'il y a de quoi les armer ; les conscrits diluent l'expérience des anciens."""
        r = self.factions[code]['res']
        if add <= 0 or r['recrues'] < add or r['armes'] < add * R.REPL_ARMES:
            return False
        r['recrues'] -= add
        r['armes'] -= add * R.REPL_ARMES
        reg['xp'] = (reg['xp'] * reg['n'] + R.UNITS[reg['type']].get('xp0', 0) * add) / (reg['n'] + add)
        reg['n'] += add
        return True

    def prune(self, a):
        """Retire de l'armée les régiments réduits à rien (moins de 5 hommes), en gardant leur souvenir (bury)."""
        if any(r['n'] < 5 for r in a['regs']):
            ro = [[r['id'], r['type']] for r in a['regs']]
            a['regs'] = [r for r in a['regs'] if r['n'] >= 5]
            self.bury(a, ro)

    def bury(self, a, ro):
        """Régiments de la liste ro ([id, type], dans l'ordre de l'armée) qui n'y sont plus : on note leur rang, donc leur
        numéro, pour pouvoir les relever (army_actions.relever) ; les plus anciens sont oubliés."""
        ids = {r['id'] for r in a['regs']}
        old = [m for m in a.get('morts') or [] if m[3] > self.t - AA.MORTS_JOURS and m[2] not in ids]
        seen = {m[2] for m in old}
        a['morts'] = old + [[i, typ, rid, self.t] for i, (rid, typ) in enumerate(ro) if rid not in ids and rid not in seen]
        if not a['morts']:
            del a['morts']

    def all_regs(self, code):
        for n in self.nodes:
            if n['owner'] == code:
                yield from n['garrison']
        for a in self.armies.values():
            if a['owner'] == code:
                yield from a['regs']

    # ================================================================== recrutement & construction
    def unit_cost(self, code, typ):
        c = dict(R.UNITS[typ]['cost'])
        k = 1 + self.mod(code, 'recruit_cost')
        if typ == 'artillerie':
            k += self.mod(code, 'art_cost')
        if typ == 'cavalerie':
            k += self.mod(code, 'cav_cost')
        c['livres'] = round(c['livres'] * max(0.4, k))
        if typ == 'ligne':
            c['armes'] = round(c['armes'] * (1 + self.mod(code, 'ligne_armes')))
        if typ == 'artillerie':
            c['fer'] = round(c['fer'] * max(0.4, 1 + self.mod(code, 'art_cost')))
        return c

    def unit_days(self, code, typ):
        d = R.UNITS[typ]['days'] * (1 + self.mod(code, 'train'))
        if typ == 'artillerie':
            d *= 1 + self.mod(code, 'art_train')
        if typ == 'cavalerie':
            d *= 1 + self.mod(code, 'cav_train')
        return max(3, d)

    def can_pay(self, code, cost):
        r = self.factions[code]['res']
        return all(r.get(k, 0) >= v for k, v in cost.items())

    def pay(self, code, cost):
        r = self.factions[code]['res']
        for k, v in cost.items():
            r[k] -= v

    def recruit(self, code, nid, typ):
        n = self.nodes[nid]
        gn = self.geo.nodes[nid]
        if n['owner'] != code:
            return False, "Cette ville ne vous appartient pas."
        ok, why = self.can_recruit(code, nid, typ)
        if not ok:
            return False, why
        if n['siege']:
            return False, "La place est assiégée."
        if len(n['queue']) >= 4:
            return False, "File de production pleine (4 maximum)."
        cost = self.unit_cost(code, typ)
        if not self.can_pay(code, cost):
            return False, "Ressources insuffisantes."
        self.pay(code, cost)
        days = self.unit_days(code, typ) * CT.train_k(self, n, typ)   # casernes, place d'armes
        n['queue'].append(dict(kind='unit', what=typ, left=days, total=days))
        return True, f"{self.unit_name(code, typ)[0]} en formation à {gn['name']}."

    def build_cost(self, code, cost):
        """Prix d'une construction pour ce camp (le ciment le réduit) ; l'interface fait le même calcul (ui.js, buildK)."""
        k = 1 + self.mod(code, 'build_cost')
        return {r: math.ceil(v * k) for r, v in cost.items()}

    def build_days(self, code, days):
        return days * (1 + self.mod(code, 'build_cost'))

    def build(self, code, nid, what):
        n = self.nodes[nid]
        gn = self.geo.nodes[nid]
        if n['owner'] != code:
            return False, "Cette ville ne vous appartient pas."
        if what == 'depot':
            return CT.slot_build(self, code, nid, 'depot')   # le magasin aux vivres occupe un emplacement
        if what == 'repar':
            return self.repair(code, nid)
        b = R.BUILD.get(what)
        if not b:
            return False, "Construction inconnue."
        lvl = n['fort'] if what == 'fort' else n['dev']
        pending = sum(1 for q in n['queue'] if q['kind'] == 'build' and q['what'] == what)
        top = self.fort_max(code, nid) if what == 'fort' else b['max']
        if lvl + pending >= top:
            if what == 'fort' and top < R.BASTION_LEVEL and gn['type'] in R.BASTION_TYPES:
                return False, "Niveau maximal : les bastions demandent la technologie « Fortifications à la Vauban »."
            return False, "Niveau maximal atteint."
        if len(n['queue']) >= 4:
            return False, "File de production pleine."
        cost = self.build_cost(code, b['cost'](lvl + pending))
        if not self.can_pay(code, cost):
            return False, "Ressources insuffisantes."
        self.pay(code, cost)
        days = self.build_days(code, b['days'](lvl + pending))
        n['queue'].append(dict(kind='build', what=what, left=days, total=days))
        if what == 'fort' and lvl + pending + 1 == R.BASTION_LEVEL:
            return True, f"Bastions à la Vauban lancés à {gn['name']}."
        if what == 'dev':
            return True, f"Agrandissement de {gn['name']} lancé : {R.DEV_NAMES[gn['type']][lvl + pending + 1].lower()}."
        return True, f"{b['name']} lancées à {gn['name']}."

    # ------------------------------------------------------------------ dégâts des villes
    def damage_town(self, n, x):
        """La ville prend x de dégâts de plus (0 à 1) : les nouveaux tombent sur ce qui reste debout."""
        if x <= 0:
            return
        n['deg'] = round(min(1.0, 1 - (1 - n.get('deg', 0.0)) * (1 - x)), 4)
        self._dirty_income = True

    def repair_quote(self, code, n):
        """Réparations de la ville : (tours, coût), ou None s'il n'y a rien à réparer."""
        deg = n.get('deg', 0.0)
        if deg < 0.02:
            return None
        k = deg * CT.SIZE_COST[self.geo.nodes[n['id']]['type']]
        tours = max(1, math.ceil(deg * R.REPAR_TOURS - 1e-9))
        return tours, self.build_cost(code, {r: v * k for r, v in R.REPAR_COST.items()})

    def repair(self, code, nid):
        n = self.nodes[nid]
        gn = self.geo.nodes[nid]
        q = self.repair_quote(code, n)
        if not q:
            return False, "Il n'y a rien à réparer."
        if n['siege']:
            return False, "On ne rebâtit pas une ville assiégée."
        if any(x['kind'] == 'build' and x['what'] == 'repar' for x in n['queue']):
            return False, "Les réparations sont déjà en chantier."
        if len(n['queue']) >= 4:
            return False, "File de production pleine."
        tours, cost = q
        if not self.can_pay(code, cost):
            return False, "Ressources insuffisantes."
        self.pay(code, cost)
        days = TT.TOUR_DAYS * tours   # (un tour de travail par tour : la file n'en fait pas plus)
        n['queue'].append(dict(kind='build', what='repar', left=days, total=days))
        return True, f"Réparations lancées à {gn['name']} : {tours} tour{'s' if tours > 1 else ''}."

    def update_queues(self, dt):
        w0 = TT.work(self, dt)   # capacité par tour : un mois de travail, quelle que soit sa longueur
        RL.tick(self, w0)   # chantiers des voies ferrées, menés à part (game/rails.py)
        for n in self.nodes:
            if not n['queue'] or n['siege'] or n['owner'] == R.NEUTRAL:
                continue
            w = w0
            while w > 1e-9 and n['queue']:
                q = n['queue'][0]
                q['left'] -= w
                if q['left'] > 1e-6:
                    break
                w = max(0.0, -q['left'])   # le surplus passe à l'élément suivant de la file
                n['queue'].pop(0)
                gn = self.geo.nodes[n['id']]
                if q['kind'] == 'unit':
                    reg = self.new_reg(q['what'], code=n['owner'])
                    reg['morale'] = 70 + R.UNITS[q['what']].get('morale0', 0) + self.mod(n['owner'], 'morale')
                    reg['xp'] += CT.train_xp(self, n)   # école militaire, place d'armes
                    n['garrison'].append(reg)
                    if n['owner'] == self.player:
                        self.log('armee', f"Régiment levé à {gn['name']} : {self.unit_name(n['owner'], q['what'])[0].lower()}.",
                                 gn['x'], gn['y'])
                elif q['kind'] == 'slot':
                    CT.finish(self, n, q)   # bâtiment d'emplacement
                else:
                    if q['what'] == 'fort':
                        n['fort'] = min(R.BASTION_LEVEL, n['fort'] + 1)
                        n['milice_max'] += 40
                    elif q['what'] == 'repar':
                        n['deg'] = 0.0
                        self._dirty_income = True
                        if n['owner'] == self.player:
                            self.log('eco', f"{gn['name']} est rebâtie : la ville retrouve toute sa production.", gn['x'], gn['y'])
                        continue
                    elif q['what'] == 'depot':
                        n['depot'] = 1
                        if n['owner'] == self.player:
                            self.log('eco', f"Magasin aux vivres construit à {gn['name']}.", gn['x'], gn['y'])
                        continue
                    else:
                        n['dev'] = min(3, n['dev'] + 1)
                        n['milice_max'] += R.NODE_BASE[gn['type']]['milice'] * 0.15
                        self._dirty_income = True
                        if n['owner'] == self.player:
                            self.log('eco', f"{gn['name']} s'agrandit ({R.DEV_NAMES[gn['type']][n['dev']].lower()}) : "
                                            f"de nouveaux habitants vont venir s'y installer.", gn['x'], gn['y'])
                        continue
                    self._dirty_income = True
                    if n['owner'] == self.player:
                        self.log('eco', f"{R.BUILD[q['what']]['name']} terminées à {gn['name']}.", gn['x'], gn['y'])

    def research(self, code, tech):
        f = self.factions[code]
        t = R.TECH.get(tech)
        if not t:
            return False, "Technologie inconnue."
        if tech in f['techs']:
            return False, "Déjà connue."
        if f['research'][t['branch']]:
            return False, "Une recherche est déjà en cours dans cette branche."
        if any(r not in f['techs'] for r in t['req']):
            return False, "Prérequis manquants."
        if f['res']['livres'] < t['cost']:
            return False, "Livres insuffisantes."
        f['res']['livres'] -= t['cost']
        f['research'][t['branch']] = dict(tech=tech, left=t['days'], total=t['days'])
        return True, f"Recherche lancée : {t['name']}."

    # ================================================================== armées
    def create_army(self, code, x, y, regs, node=None, name=None):
        f = self.factions[code]
        f['army_count'] += 1
        aid = self.nid('a')
        a = dict(id=aid, owner=code, name=name or f"{ordinal(f['army_count'])} Armée",
                 regs=regs, x=float(x), y=float(y), at_node=node, path=[], target=None, state='idle', stance='normal',
                 mode='route', supply=1.0, battle=None, grace=0.0, hidden=False, onroad=node is not None, edge=None,
                 assault=False, ai=None, viol=0.0, gen=self.new_general(code), fm='ligne', pl='frontal', fm_t=-9.0,
                 tac_auto=True, landing=False, boat=False, rx=True, des=0.0, depot=None, tr=False, hold=False, qrt=False,
                 mp=None)   # mp : jours de marche qui restent ce tour (None : tout le mois), en tour par tour
        self.armies[aid] = a
        return a

    def army_men(self, a):
        return sum(r['n'] for r in a['regs'])

    def army_speed(self, a):
        sp = min(R.UNITS[r['type']]['speed'] * (1 + (self.reg_mods(a['owner'], r).get('art_speed', 0.0) if r['type'] == 'artillerie' else 0))
                 for r in a['regs']) if a['regs'] else 20
        if a['supply'] < 0.35:
            sp *= 0.9
        sp *= R.FORMATION_SPEED.get(a.get('fm', 'ligne'), 1.0)
        if self.gen_trait(a) == 'cavalier':
            sp *= 1.1
        return sp * TB.march_k(a)   # des troupes fourbues marchent moins vite

    # ------------------------------------------------------------------ généraux
    def new_general(self, code):
        traits = list(R.GENERAL_TRAITS)
        w = [1.0] * len(traits)
        fav = R.GENERAL_FAVORITE.get(code)
        if fav:
            w[traits.index(fav)] = 3.0
        used = {a['gen']['name'] for a in self.armies.values() if a.get('gen')}
        names = [s for s in R.SURNAMES if s not in used] or R.SURNAMES
        return dict(name=self.rng.choice(names), trait=self.rng.choices(traits, w)[0], lvl=1, xp=0)

    @staticmethod
    def gen_title(g):
        return f"{R.GENERAL_RANKS[g['lvl'] - 1]} {g['name']}"

    def general_xp(self, a, n):
        g = a.get('gen')
        if not g:
            return
        g['xp'] += n
        lvl = 3 if g['xp'] >= 7 else (2 if g['xp'] >= 3 else 1)
        if lvl > g['lvl']:
            g['lvl'] = lvl
            if a['owner'] == self.player:
                self.log('armee', f"{g['name']} est promu {R.GENERAL_RANKS[lvl - 1].lower()} ({a['name']}).",
                         a['x'], a['y'], who=a['owner'], important=True)

    def army_power(self, a, terrain_name='Plaine'):
        return sum(self.reg_power(a['owner'], r, terrain_name, a=a) for r in a['regs'])

    def reg_power(self, code, r, tname, wx_fire=1.0, cover=False, a=None):
        u = R.UNITS[r['type']]
        md = self.reg_mods(code, r)   # ce que le régiment a appris (SPEC-ARBRE.md)
        p = r['n'] * u['power'] * u['terrain'].get(tname, 1.0)
        k = 1 + md.get('all_power', 0.0)
        cls = u['cls']
        if cls in R.ARMS:
            p *= R.ARMS[cls][min(r.get('arm', 0), len(R.ARMS[cls]) - 1)][2]
        p *= TB.reg_k(r, cls)   # fatigue et munitions (effet modéré)
        if cls == 'inf':
            k += md.get('inf_power', 0.0)
            p *= 1 - (1 - wx_fire) * (1 - md.get('rain', 0.0))   # l'amorce à percussion ne craint plus la pluie
        elif cls == 'artillerie':
            k += md.get('art_power', 0.0)
            p *= wx_fire
        else:
            k += md.get('cav_power', 0.0)
            p *= (1 + wx_fire) / 2
        if u['light'] and cover:
            k += md.get('legere_cover', 0.0)
        mountain = tname in ('Montagne', 'Collines', 'Haute montagne')
        if mountain:
            k += md.get('mountain', 0.0)
        if a is not None and a.get('gen'):
            tr = a['gen']['trait']
            if tr == 'cavalier' and r['type'] == 'cavalerie':
                k += 0.20
            elif tr == 'artilleur' and r['type'] == 'artillerie':
                k += 0.25
            elif tr == 'montagnard' and mountain:
                k += 0.15
            elif tr == 'eclaireur' and u['light']:
                k += 0.10
            k *= self.gen_level_k(a)
        p *= k * (0.55 + 0.45 * r['morale'] / 100) * (1 + r['xp'] / 250)
        return max(0.0, p)

    # ------------------------------------------------------------------ canons des remparts
    def fort_guns(self, n):
        """Batteries fixes d'une place forte : une par niveau de fortification (au plus rules.FORT_MAX)."""
        return max(0, min(R.FORT_MAX, int(n['fort'])))

    def fort_gun_reg(self, n, i):
        """Une batterie du rempart, comme un régiment (pour la bataille commandée et le calcul de puissance)."""
        men = float(R.UNITS['artillerie']['men'])
        return dict(id=f"c{n['id']}-{i + 1}", type='artillerie', n=men, max=men, xp=30.0, morale=75.0, ammo=100.0,
                    fat=0.0, arm=self.arm_level(n['owner'], 'artillerie'), man=self.known_man(n['owner'], 'artillerie'))

    def fort_guns_power(self, n, tname, wx_fire=1.0):
        k = self.fort_guns(n)
        if not k:
            return 0.0
        r = self.fort_gun_reg(n, 0)
        if n['owner'] in self.factions:
            return k * self.reg_power(n['owner'], r, tname, wx_fire)
        return k * r['n'] * R.UNITS['artillerie']['power'] * R.ARMS['artillerie'][r['arm']][2] * wx_fire

    def node_defense_power(self, nid, include_armies=True):
        n = self.nodes[nid]
        code = n['owner']
        gn = self.geo.nodes[nid]
        fort_eff = AA.fort_eff(self, n)   # remparts moins la brèche, et ouvrages de fortune
        fb = 1 + 0.35 * fort_eff + (self.mod(code, 'fort_bonus') if code != R.NEUTRAL else 0)
        tname = TERRAIN[self.geo.terrain_at(gn['x'], gn['y'])][0]
        p = n['milice'] * R.MILICE_POWER * self.milice_k(code)
        if code != R.NEUTRAL:
            p += sum(self.reg_power(code, r, tname) * (R.GARDE_HOME if r['type'] == 'garde' else 1) for r in n['garrison'])
        p *= fb
        p += self.fort_guns_power(n, tname) * R.FORT_GUNS_AUTO   # les canons du rempart
        if include_armies:
            for a in self.armies.values():
                if a['at_node'] == nid and a['state'] in ('idle',) and self.friendly(a['owner'], code):
                    p += self.army_power(a, tname) * fb
        return p

    def hegemon(self):
        """La puissance qui domine l'Aquitaine (plus de 40 % des places tenues), contre laquelle les autres se liguent."""
        cnt = {}
        for n in self.nodes:
            if n['owner'] in self.factions:
                cnt[n['owner']] = cnt.get(n['owner'], 0) + 1
        if len(cnt) < 3:
            return None
        top = max(cnt, key=cnt.get)
        return top if cnt[top] > 0.4 * sum(cnt.values()) else None

    def faction_power(self, code):
        p = 0.0
        for a in self.armies.values():
            if a['owner'] == code:
                p += self.army_power(a)
        mk = None
        for n in self.nodes:
            if n['owner'] == code:
                if mk is None:
                    mk = self.milice_k(code)   # les armes de la milice : les mêmes dans toutes ses places
                p += n['milice'] * R.MILICE_POWER * mk * 0.5 + sum(self.reg_power(code, r, 'Plaine') for r in n['garrison'])
        return p

    def army_pos_node(self, a):
        if a['at_node'] is not None:
            return a['at_node']
        return None

    # ------------------------------------------------------------------ chemins
    def passable_node(self, code, nid, target, tr=0, block=None):
        """block : propriétaires dont les terres sont fermées (voir AA.closed_owners) ; None : comme avant, selon tr."""
        o = self.nodes[nid]['owner']
        if block is not None:
            return o not in block
        if o == code or o == R.NEUTRAL:
            return True
        st = self.status(code, o)
        if st in ('guerre', 'alliance'):
            return True
        # en traversant : avec un droit de passage
        return bool(tr) and AA.has_passage(self, code, o)

    def edge_cost(self, code, e, frm=None, speed=22.0):
        """Coût d'un tronçon en « km de route équivalents » pour une armée marchant à `speed` km/j."""
        if e.get('kind') == 'water':
            return e['len'] * 22.0 / max(5.0, self.water_speed(e, frm, estimate=True, code=code))
        sp = 1.15 if e['royal'] else 1.0
        c = e['len'] / sp
        if e['id'] in self.cut_edges():
            c += max(5.0, speed) * CR.DELAY   # route coupée par la crue : un jour de plus
        if e['rrank'] == 1 and not self.mod(code, 'bridges'):
            c += 8 if not e['ferry'] else 20
        return c * 22.0 / max(5.0, speed)

    def water_speed(self, e, frm, x=None, y=None, estimate=False, code=None):
        """Vitesse des gabares (km/j) : courant, crues, basses eaux d'été, tempêtes sur la côte."""
        k = 1 + (self.mod(code, 'river_speed') if code else 0)
        return k * self._water_speed(e, frm, x, y, estimate, bool(code and self.mod(code, 'upstream')))

    def _water_speed(self, e, frm, x=None, y=None, estimate=False, steam=False):
        way = self.geo.ways[e['way']]
        if e['sea']:
            sp = R.SEA_SPEED
            kind = self.weather['cote']['kind']
            if not estimate:
                sp *= {'tempete': 0.12, 'orage': 0.5, 'brouillard': 0.7, 'pluie': 0.9}.get(kind, 1.0)
            return sp
        sp = R.WATER_SPEED
        if e['down'] is not None and frm is not None:
            downstream = (e['down'] != frm) or steam   # le bateau à vapeur remonte aussi vite qu'il descend
            flood = self.t < self.flood_until
            if downstream:
                sp *= 1.25 * (1.2 if flood else 1.0)
            else:
                sp *= 0.75 * (0.5 if flood else 1.0)
        season = self.season()
        if way['low_water'] and season == 'été':
            sp *= 0.75
        if season == 'hiver':
            sp *= 0.9
        if not estimate and x is not None:
            sp *= 0.5 + 0.5 * self.wx(x, y)['move']
        return sp

    def road_route(self, code, start_nodes, goal, speed=22.0, boat=False, tr=0, block=None, afloat=False, rail=False,
                   modes=None):
        """Plus court chemin par les routes et les voies d'eau.
        start_nodes : dict nœud -> coût initial. Retourne (coût, [nœuds], [arêtes]).
        L'état « à bord » est suivi : embarquer et débarquer prennent du temps.
        block : propriétaires dont les terres sont fermées (None : places traversables selon passable_node).
        Leurs places ne se franchissent qu'à bord, devant le quai, sans y débarquer ni embarquer ; partie de
        l'une d'elles, une armée peut d'abord sortir par les routes de ce même département.
        rail : l'armée est déjà dans un train. modes : liste remplie avec le mode de chaque arête du chemin (0 à pied,
        1 à bord, 2 en train : « Chemins de fer militaires », sur les tronçons utilisables ; monter coûte RAIL_EMBARK)."""
        if block is not None and self.nodes[goal]['owner'] in block:
            return None
        b0 = 1 if boat else 2 if rail else 0
        rails = RL.rail_edges(self, code)
        dist = {}
        prev = {}
        pq = []
        for s, c0 in start_nodes.items():
            dist[(s, b0)] = c0
            heapq.heappush(pq, (c0, s, b0))
        best_goal = None
        while pq:
            d, u, b = heapq.heappop(pq)
            if d > dist.get((u, b), 1e18):
                continue
            if u == goal:
                best_goal = (u, b)
                break
            ou = self.nodes[u]['owner']
            if u not in start_nodes and ou != code and not self.friendly(code, ou):
                # on peut traverser un nœud hostile/neutre mais on s'y arrêtera : coût dissuasif
                # (en traversant, on ne s'arrête qu'aux places ennemies ; chez un voisin en paix, on passe)
                if (ou == R.NEUTRAL and not tr) or (ou != R.NEUTRAL and self.at_war(code, ou)):
                    d += 25
            # place fermée : de passage seulement (une armée à flot n'y débarque pas, même au premier quai)
            ub = block is not None and ou in block and (afloat or u not in start_nodes)
            if ub and not b:
                d += 30   # en sortant de ses terres par la route, au plus court
            for eid in self.geo.adj[u]:
                e = self.geo.edges[eid]
                v = e['b'] if e['a'] == u else e['a']
                water = e.get('kind') == 'water'
                if block is not None:
                    if ub and b == 1 and not water:
                        continue   # à bord devant des terres fermées : pas de débarquement
                    ov = self.nodes[v]['owner']
                    if ov in block and not water and not (ov == ou and (u in start_nodes or ub)):
                        continue   # on n'y entre pas par la route (sauf pour sortir de chez lui)
                elif not self.passable_node(code, v, goal, tr):
                    continue
                nb = 1 if water else 0
                nd = d + self.edge_cost(code, e, u, speed)
                if water and b != 1:
                    nd += R.EMBARK_DAYS * 22.0
                elif b == 1 and not water:
                    nd += R.DISEMBARK_DAYS * 22.0
                if nd < dist.get((v, nb), 1e18):
                    dist[(v, nb)] = nd
                    prev[(v, nb)] = ((u, b), eid)
                    heapq.heappush(pq, (nd, v, nb))
                if eid in rails:   # en train : le même tronçon, bien plus vite, après l'embarquement en gare
                    nd = d + e['len'] * 22.0 / R.RAIL_SPEED + (0.0 if b == 2 else R.RAIL_EMBARK * 22.0) \
                        + (R.DISEMBARK_DAYS * 22.0 if b == 1 else 0.0)
                    if nd < dist.get((v, 2), 1e18):
                        dist[(v, 2)] = nd
                        prev[(v, 2)] = ((u, b), eid)
                        heapq.heappush(pq, (nd, v, 2))
        if best_goal is None:
            return None
        nodes, eids, ms = [best_goal[0]], [], []
        cur = best_goal
        while cur in prev:
            p, eid = prev[cur]
            eids.append(eid)
            ms.append(cur[1])
            nodes.append(p[0])
            cur = p
        nodes.reverse()
        eids.reverse()
        if modes is not None:
            modes[:] = ms[::-1]
        return dist[best_goal], nodes, eids

    def nearest_node(self, x, y, pred=None, maxd=1e9):
        best, bi = maxd, None
        for gn in self.geo.nodes:
            if pred and not pred(gn['id']):
                continue
            d = math.hypot(gn['x'] - x, gn['y'] - y)
            if d < best:
                best, bi = d, gn['id']
        return bi

    def edge_between(self, a, b):
        for eid in self.geo.adj[a]:
            e = self.geo.edges[eid]
            if (e['a'] == a and e['b'] == b) or (e['a'] == b and e['b'] == a):
                return e
        return None

    def plan_route(self, a, goal, block=None):
        """block : propriétaires dont les terres sont fermées (None : comme avant, selon passable_node)."""
        code = a['owner']
        tr = AA.route_level(self, a)
        legs = []
        afloat = False
        if a['at_node'] is not None:
            starts = {a['at_node']: 0.0}
        elif a['edge']:
            e = self.geo.edges[a['edge']['e']]
            frm, pos = a['edge']['frm'], a['edge']['pos']
            to = e['b'] if e['a'] == frm else e['a']
            here = AA.land_owner(self, a['x'], a['y']) if block else None
            # à bord, sur le fleuve ou la côte : l'eau est libre, on peut repartir par un bout comme par l'autre,
            # même devant une place fermée (sans y débarquer) ; sinon l'armée resterait immobilisée entre deux
            afloat = bool(block) and bool(a.get('boat')) and e.get('kind') == 'water'
            starts = {}
            # sur la route d'une place fermée, là où l'on se trouve : on peut toujours en repartir pour sortir
            if self.passable_node(code, frm, goal, tr, block) or (block and self.nodes[frm]['owner'] == here) or afloat:
                starts[frm] = pos
            if self.passable_node(code, to, goal, tr, block) or (block and self.nodes[to]['owner'] == here) or afloat:
                starts[to] = e['len'] - pos
            if not starts:
                return None
        else:
            near = self.nearest_node(a['x'], a['y'], lambda i: self.passable_node(code, i, goal, tr, block), 60)
            if near is None:
                return None
            nx, ny = self.node_xy(near)
            pts = self.geo.astar(a['x'], a['y'], nx, ny, block=AA.cell_mask(self, block))
            if not pts:
                return None
            legs.append(dict(kind='off', pts=[list(p) for p in pts], i=1))
            starts = {near: 0.0}
        modes = []
        r = self.road_route(code, starts, goal, self.army_speed(a), bool(a.get('boat')), tr, block,
                            afloat=afloat, rail=bool(a.get('rail')), modes=modes)
        if not r:
            return None
        _, nodes, eids = r
        if a['edge'] and a['at_node'] is None:
            e = self.geo.edges[a['edge']['e']]
            frm, pos = a['edge']['frm'], a['edge']['pos']
            to = e['b'] if e['a'] == frm else e['a']
            first = nodes[0]
            # (dans un train, il finit le tronçon en train s'il le peut encore)
            on = {'rail': True} if a.get('rail') and e['id'] in RL.rail_edges(self, code) else {}
            if first == to:
                legs.append(dict(kind='road', e=e['id'], frm=frm, to=to, pos=pos, **on))
            else:
                legs.append(dict(kind='road', e=e['id'], frm=to, to=frm, pos=e['len'] - pos, **on))
        for u, v, eid, m in zip(nodes, nodes[1:], eids, modes):
            legs.append(dict(kind='road', e=eid, frm=u, to=v, pos=0.0, **({'rail': True} if m == 2 else {})))
        return legs

    def boat_prefix(self, a):
        """Une armée à bord, au milieu d'une voie d'eau, doit d'abord gagner le prochain quai."""
        if not a.get('boat') or not a['edge'] or a['at_node'] is not None:
            return []
        e = self.geo.edges[a['edge']['e']]
        frm, pos = a['edge']['frm'], a['edge']['pos']
        to = e['b'] if e['a'] == frm else e['a']
        return [dict(kind='road', e=e['id'], frm=frm, to=to, pos=pos)]

    def edge_xy(self, e, frm, pos):
        """Position (x, y) à `pos` km du nœud `frm` le long d'une arête (tracé de la route ou voie d'eau)."""
        pts = e['pts']
        cum = self.geo.edge_cum[e['id']]
        L = e['len']
        s = pos if frm == e['a'] else L - pos
        s = max(0.0, min(L, s))
        lo, hi = 0, len(cum) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if cum[mid] <= s:
                lo = mid
            else:
                hi = mid
        seg = cum[hi] - cum[lo] or 1e-9
        f = (s - cum[lo]) / seg
        return pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f

    def order_move(self, code, aid, x=None, y=None, node=None, mode=None, tr=None, force=False):
        """tr : traverser (True) ou conquérir en chemin (False), None pour garder le choix de l'armée ;
        force : le joueur, prévenu, passe en force sur des terres fermées (déclaration de guerre). Retourne
        (None, question) quand il faut d'abord sa confirmation."""
        a = self.armies.get(aid)
        if not a or a['owner'] != code:
            return False, "Armée introuvable."
        if a['state'] == 'battle':
            return False, "Cette armée est engagée dans une bataille (ordonnez la retraite)."
        if mode not in (None, 'route', 'champs'):
            return False, "Itinéraire inconnu."
        if node is not None:
            node = int(node)
            if not self.valid_node(node):
                return False, "Lieu inconnu."
            o = self.nodes[node]['owner']
            if o not in (code, R.NEUTRAL) and self.status(code, o) == 'paix' and not (a.get('tr') if tr is None else tr) \
                    and not AA.closed_to(self, code, o):
                return False, f"{self.geo.nodes[node]['name']} appartient à {self.fname(o)} (en paix) : on n'y entre qu'en traversant."
        elif x is None or y is None or not (math.isfinite(x) and math.isfinite(y)):
            return False, "Destination invalide."
        # un ordre refusé ne doit ni lever le siège en cours ni changer l'itinéraire choisi
        old = a['mode'], a.get('tr', False)
        if mode:
            a['mode'] = mode
        if tr is not None:
            a['tr'] = bool(tr)
        ok, msg = self._order_move(code, a, x, y, node, force)
        if not ok:
            a['mode'], a['tr'] = old
        return ok, msg

    def plan_legs(self, a, x, y, node, block=None):
        """Itinéraire selon le mode de marche de l'armée : (étapes, destination, None) ou (None, None, raison).
        block : propriétaires dont les terres sont fermées (None : comme avant)."""
        code = a['owner']
        mask = AA.cell_mask(self, block)
        if a['mode'] == 'route':
            if node is None:
                node_near = self.nearest_node(x, y, maxd=6)
                if node_near is not None:
                    node = node_near
            if node is not None:
                if node == a['at_node']:
                    return None, None, "L'armée y est déjà."
                legs = self.plan_route(a, node, block)
                if not legs:
                    return None, None, f"Aucun chemin par les routes (territoire {'d’un département' if self.departements() else 'd’une province'} en paix ?). Essayez à travers champs."
                return legs, dict(node=node), None
            # route jusqu'au nœud le plus proche puis hors route
            near = self.nearest_node(x, y, lambda i: self.passable_node(code, i, None, block=block), 40)
            legs = self.plan_route(a, near, block) if near is not None and near != a['at_node'] else self.boat_prefix(a)
            if legs is None:
                return None, None, "Aucun chemin praticable."
            if near is not None:
                sx, sy = self.node_xy(near)
            elif legs:
                sx, sy = self.node_xy(legs[-1]['to'])
            else:
                sx, sy = a['x'], a['y']
            pts = self.geo.astar(sx, sy, x, y, block=mask)
            if not pts:
                return None, None, "Destination inaccessible (eau, montagne ou hors de la région)."
            legs.append(dict(kind='off', pts=[list(p) for p in pts], i=1))
            return legs, dict(x=x, y=y), None
        if node is not None:
            x, y = self.node_xy(node)
        pre = self.boat_prefix(a)
        sx, sy = self.node_xy(pre[0]['to']) if pre else (a['x'], a['y'])
        pts = self.geo.astar(sx, sy, x, y, block=mask)
        if not pts:
            return None, None, "Destination inaccessible à travers champs (fleuve sans pont, eau ou hors région)."
        return (pre + [dict(kind='off', pts=[list(p) for p in pts], i=1)],
                dict(node=node) if node is not None else dict(x=x, y=y), None)

    def start_land(self, a, block):
        """Terres fermées où se trouve l'armée (elle peut toujours en sortir), sinon None."""
        o = self.nodes[a['at_node']]['owner'] if a['at_node'] is not None else AA.land_owner(self, a['x'], a['y'])
        return o if o in block else None

    def _order_move(self, code, a, x, y, node, force=False):
        block = AA.closed_owners(self, code)
        here = self.start_land(a, block)
        ask = code == self.player and code not in self.ais   # le joueur : contournement signalé, passage en force proposé
        legs, target, err = self.plan_legs(a, x, y, node, block)
        detour, war = [], ''
        if block and ask and err != "L'armée y est déjà.":
            # le même ordre, terres fermées comprises : contourne-t-on, ou faut-il passer en force ?
            fl, ft, _ = self.plan_legs(a, x, y, node, frozenset())
            who = AA.crossed(self, fl, ft, block, here) if fl else []
            if legs is None and who:
                if not force:
                    return None, AA.force_question(self, who)
                ok, war = AA.force_passage(self, code, who)
                if not ok:
                    return False, war
                block = AA.closed_owners(self, code)
                here = self.start_land(a, block)
                legs, target, err = self.plan_legs(a, x, y, node, block)
            elif legs is None and fl:
                legs, target = fl, ft   # rien de fermé en chemin (seulement les terres d'où l'on sort)
            elif legs is not None:
                detour = who
        elif legs is None and block and err != "L'armée y est déjà.":
            err = f"{err} Terres fermées (sans droit de passage) : {AA.names_of(self, sorted(block))}."
        if legs is None:
            return False, f"{war} {err}" if war else err
        if a['state'] == 'siege':
            self.end_siege_for(a)
        a['path'], a['target'] = legs, target
        a['ex'] = here          # terres fermées dont on sort (le délai de grâce court, sans détour imposé)
        a['dt'] = detour        # terres fermées contournées
        a['hold'] = a['qrt'] = False
        a['state'] = 'move'
        a['assault'] = False
        if a['stance'] == 'embuscade':
            a['stance'] = 'normal'
        if a['at_node'] is not None:
            a['at_node'] = None
        msg = war or "En marche."
        if detour:
            msg = f"En marche, en contournant les terres {R.de(AA.names_of(self, detour))} (sans droit de passage)."
        if here:
            msg += f" L'armée sort d'abord des terres {R.de(self.fname(here))}."
        return True, msg

    def reroute(self, a):
        """Même destination, par un itinéraire qui évite les terres fermées (en sortant de celles où l'on se trouve)."""
        tgt = a.get('target') or {}
        node, x, y = tgt.get('node'), tgt.get('x'), tgt.get('y')
        if node is None and x is None:
            return False
        block = AA.closed_owners(self, a['owner'])
        legs, target, _ = self.plan_legs(a, x, y, node, block)
        if not legs:
            return False
        a['path'], a['target'] = legs, target
        a['ex'] = self.start_land(a, block)
        return True

    def exit_path(self, a, o):
        """Sortie au plus court des terres fermées de o, vers les terres les plus proches où l'armée a le droit d'être."""
        mask = AA.cell_mask(self, AA.closed_owners(self, a['owner']))
        if mask is None:
            return False
        pts = self.geo.nearest_open(a['x'], a['y'], mask) or self.geo.nearest_open(a['x'], a['y'], mask, strict=False)
        if not pts or len(pts) < 2:
            return False
        a['path'] = [dict(kind='off', pts=[list(p) for p in pts], i=1)]
        a['target'] = dict(x=pts[-1][0], y=pts[-1][1])
        a['ex'] = o
        a['dt'] = []
        a['state'] = 'move'
        a['at_node'] = None
        a['hold'] = a['qrt'] = False
        a['assault'] = False
        if a['stance'] == 'embuscade':
            a['stance'] = 'normal'
        return True

    def order_path(self, code, aid, pts, tr=None, force=False):
        """Itinéraire tracé au doigt ou au stylet : l'armée passe par les points dessinés, à travers champs, en
        contournant les terres fermées. force : le joueur, prévenu, passe en force (déclaration de guerre)."""
        a = self.armies.get(aid)
        if not a or a['owner'] != code:
            return False, "Armée introuvable."
        if a['state'] == 'battle':
            return False, "Cette armée est engagée dans une bataille (ordonnez la retraite)."
        pts = [(float(p[0]), float(p[1])) for p in pts if isinstance(p, (list, tuple)) and len(p) >= 2][:400]
        pts = [p for p in pts if math.isfinite(p[0]) and math.isfinite(p[1])]
        if not pts:
            return False, "Tracé vide."
        pre = self.boat_prefix(a)
        way = [self.node_xy(pre[0]['to']) if pre else (a['x'], a['y'])]
        for p in pts:
            if math.dist(p, way[-1]) >= 3.0:
                way.append(p)
        if math.dist(pts[-1], way[-1]) > 0.4:
            way.append(pts[-1])
        way = way[:45]

        def trace(mask):
            full, skipped = [way[0]], 0
            for p in way[1:]:
                seg = self.geo.astar(full[-1][0], full[-1][1], p[0], p[1], max_nodes=40000, block=mask)
                if not seg:
                    skipped += 1
                    continue
                full += seg[1:]
            return full, skipped
        block = AA.closed_owners(self, code)
        here = self.start_land(a, block) if not pre else None
        full, skipped = trace(AA.cell_mask(self, block))
        # le tracé dessiné passe-t-il sur des terres fermées ?
        who = AA.crossed(self, [dict(kind='off', pts=way)], dict(x=way[-1][0], y=way[-1][1]), block, here)
        war = ''
        if who and (len(full) < 2 or math.dist(full[-1], way[-1]) > 2.0):
            # impossible d'arriver au bout sans y passer
            if code != self.player or code in self.ais:
                return False, AA.closed_msg(self, who)
            if not force:
                return None, AA.force_question(self, who)
            ok, war = AA.force_passage(self, code, who)
            if not ok:
                return False, war
            block = AA.closed_owners(self, code)
            here = self.start_land(a, block) if not pre else None
            who = []
            full, skipped = trace(AA.cell_mask(self, block))
        if len(full) < 2:
            return False, "Tracé impraticable (eau, fleuve sans pont ou hors de la région)."
        ex, ey = full[-1]
        node = self.nearest_node(ex, ey, maxd=1.6)
        if node is not None:
            o = self.nodes[node]['owner']
            if o not in (code, R.NEUTRAL) and self.status(code, o) == 'paix':
                node = None
        path = pre + [dict(kind='off', pts=[list(p) for p in full], i=1)]
        target = dict(node=node) if node is not None else dict(x=ex, y=ey)
        if tr is not None:
            a['tr'] = bool(tr)
        if a['state'] == 'siege':
            self.end_siege_for(a)
        a['hold'] = a['qrt'] = False
        a['path'] = path
        a['target'] = target
        a['ex'] = here
        a['dt'] = who
        a['state'] = 'move'
        a['assault'] = False
        if a['stance'] == 'embuscade':
            a['stance'] = 'normal'
        a['at_node'] = None
        msg = war or "En marche le long du tracé."
        if who:
            msg += f" Le tracé contourne les terres {R.de(AA.names_of(self, who))} (sans droit de passage)."
        if skipped:
            msg += " Les passages impossibles ont été contournés."
        return True, msg

    def move_armies(self, dt):
        for a in list(self.armies.values()):
            if self.paused(a):
                continue
            self.move_army(a, dt)

    def paused(self, a):
        """Tour par tour, pendant le tour des IA : les armées du joueur ont déjà marché à leur tour, elles restent en place
        (sauf une retraite forcée)."""
        return a['owner'] == self.player and (a['state'] != 'retreat' or a.get('rt')) and not a.get('cl') \
            and self.tour['on'] and self.tour['end'] is not None   # (sauf pour sortir de terres fermées : délai de grâce)

    def marching(self, a):
        return a['state'] in ('move', 'retreat') and not self.paused(a)

    def rail_switch(self, a, on):
        """Monter dans le train (une journée en gare) ou en descendre (moral −5 : l'armée se reforme sur le quai)."""
        a['rail'] = on
        if on:
            a['emb'] = a.get('emb', 0.0) + R.RAIL_EMBARK   # (après le débarquement d'une gabare, s'il y en a un)
        elif a.get('emb', 0.0) > 0:
            a['emb'] = 0.0   # (descendu avant le départ : pas de voyage, pas de désordre)
        else:
            for r in a['regs']:
                r['morale'] = max(0.0, r['morale'] - 5)

    def move_army(self, a, dt):
        """Fait marcher une armée pendant dt jours. Renvoie ce qu'il reste de ce temps (armée arrivée ou arrêtée)."""
        season = self.season()
        if a['state'] not in ('move', 'retreat') or not a['path']:
            if a['state'] in ('move', 'retreat') and not a['path']:
                a['state'] = 'idle'
            if not a['path'] and a.get('rail'):
                self.rail_switch(a, False)   # trajet annulé ailleurs (bataille, diplomatie, IA) : on descend du train
            return dt
        budget = dt
        base = self.army_speed(a)
        if a['state'] == 'retreat':
            base *= 1.15
        wx = self.wx(a['x'], a['y'])
        rails = None
        while budget > 1e-9 and a['path']:
            leg = a['path'][0]
            is_water = leg['kind'] == 'road' and self.geo.edges[leg['e']].get('kind') == 'water'
            if is_water != bool(a.get('boat')):
                # embarquement sur les gabares / débarquement sur le quai
                a['boat'] = is_water
                a['emb'] = R.EMBARK_DAYS if is_water else R.DISEMBARK_DAYS
                if a['at_node'] is not None and 'port' in self.geo.nodes[a['at_node']]['spec']:
                    a['emb'] *= 0.6
            # le train : on monte en gare (une journée), on descend un peu désorganisé ; un tronçon devenu inutilisable
            # en route (coupé, pris) fait finir à pied
            if leg.get('rail'):
                if rails is None:
                    rails = RL.rail_edges(self, a['owner'])   # (une fois par appel : tout le pas se joue sur le même réseau)
                if leg['e'] not in rails:
                    leg.pop('rail')
            if bool(leg.get('rail')) != bool(a.get('rail')):
                self.rail_switch(a, bool(leg.get('rail')))
            if a.get('emb', 0) > 0:
                use = min(budget, a['emb'])
                a['emb'] -= use
                budget -= use
                continue
            if is_water:
                e = self.geo.edges[leg['e']]
                sp = max(1.0, self.water_speed(e, leg['frm'], a['x'], a['y'], code=a['owner']))
                remaining = e['len'] - leg['pos']
                step = sp * budget
                if step >= remaining:
                    budget -= remaining / sp
                    leg['pos'] = e['len']
                    a['path'].pop(0)
                    a['x'], a['y'] = self.node_xy(leg['to'])
                    a['edge'] = None
                    a['onroad'] = True
                    a['landing'] = True
                    stop = self.arrive_node(a, leg['to'])
                    if a['state'] not in ('move', 'retreat'):
                        a['boat'] = False
                    if a['state'] != 'battle':
                        a['landing'] = False
                    if stop:
                        break
                else:
                    leg['pos'] += step
                    budget = 0
                    a['x'], a['y'] = self.edge_xy(e, leg['frm'], leg['pos'])
                    a['edge'] = dict(e=e['id'], frm=leg['frm'], pos=leg['pos'])
                    a['onroad'] = True
                    a['at_node'] = None
                continue
            if leg['kind'] == 'road':
                e = self.geo.edges[leg['e']]
                sp = base * (1.15 if e['royal'] else 1.0) * R.SEASON_ROAD[season] * wx['move'] \
                    * (1 + self.mod(a['owner'], 'road_speed'))
                if self.wx(a['x'], a['y']) is R.WEATHER['neige'] and self.zone_of(a['x'], a['y']) == 'montagne':
                    sp *= 0.6
                if e['id'] in self.cut_edges():
                    sp = e['len'] / (e['len'] / sp + CR.DELAY)   # route coupée par la crue : un jour de plus sur l'arête (à gué ou par un détour ; jamais bloquée)
                if a.get('rail'):
                    sp = R.RAIL_SPEED   # (le train passe les fleuves sur ses ponts)
                zone_end = e['len']
                if e['rrank'] == 1 and not self.mod(a['owner'], 'bridges') and not self.has_sapeurs(a) and not a.get('rail'):
                    if e['ferry']:
                        sp *= 0.35  # bac sur l'estuaire : toute la traversée est lente
                    else:
                        # attente au bac : seul le passage du fleuve est lent (~0,3 jour pour l'infanterie)
                        cp = self.cross_pos(e, leg['frm'])
                        c0, c1 = max(0.0, cp - 0.8), min(e['len'], cp + 0.8)
                        if leg['pos'] < c0:
                            zone_end = c0
                        elif leg['pos'] < c1:
                            zone_end = c1
                            sp *= 0.22 * (0.5 if self.t < self.flood_until else 1.0)
                step = sp * budget
                if zone_end < e['len'] - 1e-9 and step >= zone_end - leg['pos']:
                    budget -= (zone_end - leg['pos']) / sp
                    leg['pos'] = zone_end + 1e-6
                    A, B = self.node_xy(leg['frm']), self.node_xy(leg['to'])
                    f = leg['pos'] / e['len']
                    a['x'], a['y'] = A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f
                    a['edge'] = dict(e=e['id'], frm=leg['frm'], pos=leg['pos'])
                    a['onroad'] = True
                    a['at_node'] = None
                    continue
                remaining = e['len'] - leg['pos']
                if step >= remaining:
                    budget -= remaining / sp
                    leg['pos'] = e['len']
                    a['path'].pop(0)
                    a['x'], a['y'] = self.node_xy(leg['to'])
                    a['edge'] = None
                    a['onroad'] = True
                    if self.arrive_node(a, leg['to']):
                        break
                else:
                    leg['pos'] += step
                    budget = 0
                    A, B = self.node_xy(leg['frm']), self.node_xy(leg['to'])
                    f = leg['pos'] / e['len']
                    a['x'], a['y'] = A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f
                    a['edge'] = dict(e=e['id'], frm=leg['frm'], pos=leg['pos'])
                    a['onroad'] = True
                    a['at_node'] = None
            else:
                pts = leg['pts']
                if leg['i'] >= len(pts):
                    a['path'].pop(0)
                    continue
                tx, ty = pts[leg['i']]
                d = math.hypot(tx - a['x'], ty - a['y'])
                ter = self.geo.terrain_at(a['x'], a['y'])
                tname = TERRAIN[ter][0]
                mult = TERRAIN[ter][1] or 0.3
                for r in a['regs']:
                    if r['type'] == 'cavalerie' and tname in ('Forêt', 'Marais'):
                        mult *= 0.85
                        break
                if any(self.arm_class(r['type']) == 'artillerie' for r in a['regs']) and tname in ('Forêt', 'Marais', 'Montagne', 'Haute montagne', 'Dunes'):
                    mult *= 0.6
                if tname in ('Montagne', 'Haute montagne', 'Collines'):
                    mult *= 1 + self.mod(a['owner'], 'mountain')
                    if self.gen_trait(a) == 'montagnard':
                        mult *= 1.3
                rv = self.geo.river[self.geo.cell(a['x'], a['y'])] if self.geo.cell(a['x'], a['y']) >= 0 else 0
                if rv:
                    mult *= 0.5 if rv >= 2 else 0.75
                sp = base * mult * R.SEASON_OFF[season] * wx['move']
                if season == 'hiver' and tname in ('Montagne', 'Haute montagne'):
                    sp *= 0.5
                sp = max(sp, 1.0)
                step = min(sp * budget, 1.0)
                if step >= d:
                    budget -= d / sp
                    a['x'], a['y'] = tx, ty
                    leg['i'] += 1
                    if leg['i'] >= len(pts):
                        a['path'].pop(0)
                        # arrivée sur un nœud ?
                        tgt = a['target'] or {}
                        if not a['path'] and tgt.get('node') is not None:
                            if self.arrive_node(a, tgt['node']):
                                break
                else:
                    a['x'] += (tx - a['x']) / d * step
                    a['y'] += (ty - a['y']) / d * step
                    budget -= step / sp
                a['onroad'] = False
                a['edge'] = None
                a['at_node'] = None
        if not a['path'] and a.get('boat') and a['at_node'] is not None:
            a['boat'] = False
            a['emb'] = 0.0
        if not a['path'] and a.get('rail'):
            self.rail_switch(a, False)   # terminus
        if not a['path'] and a['state'] in ('move', 'retreat'):
            a['state'] = 'idle' if a['state'] != 'battle' else a['state']
            if a['ai'] and a['ai'].get('then') == 'embuscade':
                a['stance'] = 'embuscade'
                a['ai']['then'] = None
        return budget

    def land_check(self, dt):
        """Terres fermées : délai de grâce, chemin de sortie, puis incidents (voir AA.land_tick)."""
        for a in list(self.armies.values()):
            AA.land_tick(self, a, dt)

    def arrive_node(self, a, nid, ask=True):
        """Retourne True si l'armée doit s'arrêter (combat, siège...)."""
        n = self.nodes[nid]
        code = a['owner']
        a['at_node'] = nid
        a['x'], a['y'] = self.node_xy(nid)
        a['edge'] = None
        o = n['owner']
        if o == code or self.friendly(code, o):
            if not a['path']:
                a['state'] = 'idle' if a['state'] != 'retreat' else 'idle'
            return False
        fled = a['state'] == 'retreat'
        stop = AA.arrive(self, a, nid, ask)   # chez un voisin en paix, ou en traversant : on passe, ou l'on fait halte
        if stop is not None:
            return stop
        if a['state'] == 'retreat':
            a['path'] = []
            a['state'] = 'idle'
        # une bataille s'y livre déjà : on rejoint les assaillants s'ils sont des nôtres, sinon on attend
        bt = next((b for b in self.battles.values() if b['node'] == nid), None)
        if bt:
            a['path'] = []
            if self.friendly(code, bt['sides'][0]['owner']) and self.hostile(code, bt['sides'][1]['owner']):
                self.join_battle(a, bt, 0)
            else:
                a['state'] = 'idle'
            return True
        # nœud hostile ou neutre : combat ou siège
        defense = self.node_defense_power(nid)
        gn = self.geo.nodes[nid]
        if defense < 1:
            self.capture(nid, code)
            return False if a['path'] else True
        if n['siege'] and n['siege']['by'] != code:
            a['path'] = []
            a['state'] = 'idle'
            if code == self.player:
                self.log('siege', f"{gn['name']} est déjà investie par {self.fname(n['siege']['by'])}.", gn['x'], gn['y'])
            return True
        if ask and not fled and not (n['siege'] and n['siege']['by'] == code) and AA.asks(self, a):
            AA.pose(self, a, nid)   # le joueur choisit : assaut, ralliement, siège… (army_actions)
            return True
        if o == R.NEUTRAL and (AA.strong(self, a, nid) or (n['siege'] and n['siege'].get('occupy') and n['siege']['by'] == code)):
            if code == self.player and TT.planning(self):
                # tour du joueur : la place se rallie tout de suite, et l'armée finit là sa marche du tour (comme une
                # prise de ville dans Total War) ; elle reprend sa route au tour suivant
                self.log('capture', f"{gn['name']} se rallie à {self.fname(code)}.", gn['x'], gn['y'], who=code,
                         important=True)
                self.capture(nid, code, peaceful=True)
                a['took'] = True
                return True
            if not n['siege']:
                n['siege'] = dict(by=code, dmg=0.0, since=self.t, occupy=True)
                if code == self.player:
                    self.log('siege', f"Vos troupes occupent {gn['name']} : ralliement en cours…", gn['x'], gn['y'], who=code)
            a['state'] = 'siege'
            return True
        if AA.walled(n) and not a['assault'] and n['siege'] is None and (o != R.NEUTRAL or n['fort'] >= 2):
            self.begin_siege(a, nid)
            return True
        if n['siege'] and n['siege']['by'] == code and not a['assault']:
            a['state'] = 'siege'
            return True
        self.start_battle([a], [], gx=gn['x'], gy=gn['y'], node=nid)
        return True

    def begin_siege(self, a, nid):
        """L'armée met le siège devant une place à remparts (journal ; alerte si la place est au joueur)."""
        n, gn, code = self.nodes[nid], self.geo.nodes[nid], a['owner']
        o = n['owner']
        n['siege'] = dict(by=code, dmg=0.0, since=self.t)
        a['state'] = 'siege'
        if code == self.player or o == self.player:
            if o == self.player:
                self.alert_pause()
            txt = f"Siège {R.de(gn['name'])} par {self.fname(code)}."
            if code == self.player and TT.planning(self):
                # (votre tour : pas de bataille avant la brèche, au tour des IA, sauf assaut ordonné)
                txt = (f"{gn['name']} a des remparts : siège commencé. « Donner l’assaut » pour l’attaquer tout de "
                       f"suite ; sinon l’assaut partira de lui-même à la brèche.")
            self.log('siege', txt, gn['x'], gn['y'], who=code, important=True)

    def cross_pos(self, e, frm):
        """Distance (km, le long de la route) entre le nœud de départ et le passage du fleuve."""
        A, B = self.node_xy(e['a']), self.node_xy(e['b'])
        dx, dy = B[0] - A[0], B[1] - A[1]
        L2 = dx * dx + dy * dy or 1.0
        f = ((e['cx'] - A[0]) * dx + (e['cy'] - A[1]) * dy) / L2
        f = max(0.0, min(1.0, f))
        return (f if frm == e['a'] else 1 - f) * e['len']

    def end_siege_for(self, a):
        nid = a['at_node']
        if nid is None:
            return
        n = self.nodes[nid]
        if n['siege'] and n['siege']['by'] == a['owner']:
            others = [b for b in self.armies.values() if b is not a and b['at_node'] == nid and b['owner'] == a['owner']
                      and b['state'] == 'siege']
            if not others:
                n['siege'] = None
        a['state'] = 'idle'

    def besiegers(self, n):
        s = n['siege']
        return [a for a in self.armies.values() if a['at_node'] == n['id'] and a['state'] == 'siege' and a['owner'] == s['by']]

    def siege_rate(self, n, bes):
        """Avancée de la brèche par jour (assaut à 0,85) : artillerie, sapeurs, remparts, général artilleur."""
        by = n['siege']['by']
        art = sum(1 + self.reg_mods(by, r).get('art_power', 0.0) for a in bes for r in a['regs'] if r['type'] == 'artillerie')
        n_sap = sum(1 for a in bes for r in a['regs'] if r['type'] == 'sapeurs')
        rate = (0.02 + 0.06 * art + R.SAPEUR_SIEGE * n_sap) / max(1, n['fort']) * AA.siege_k(n)
        if any(self.gen_trait(a) == 'artilleur' for a in bes):
            rate *= 1.4
        return rate * (1 + self.mod(by, 'siege_speed'))

    def update_sieges(self, dt):
        for n in self.nodes:
            s = n['siege']
            if not s:
                continue
            nid = n['id']
            bes = self.besiegers(n)
            if not bes:
                # assiégeants occupés à repousser une armée de secours : le siège est suspendu, pas levé
                if not any(a['at_node'] == nid and a['owner'] == s['by'] and a['state'] == 'battle' for a in self.armies.values()):
                    n['siege'] = None
                continue
            if s.get('blocus'):
                AA.blockade_tick(self, n, bes, dt)   # ni bombardement ni assaut : la faim
                continue
            if s.get('occupy'):
                gtyp = self.geo.nodes[nid]['type']
                s['dmg'] = min(1.0, s['dmg'] + dt / {'village': 3.0, 'fort': 5.0}.get(gtyp, 5.0))
                if s['dmg'] >= 1.0:
                    n['siege'] = None
                    gn = self.geo.nodes[nid]
                    self.log('capture', f"{gn['name']} se rallie à {self.fname(s['by'])}.", gn['x'], gn['y'], who=s['by'],
                             important=s['by'] == self.player)
                    self.capture(nid, s['by'], peaceful=True)
                    for a in bes:
                        a['state'] = 'move' if a['path'] else 'idle'
                continue
            d0 = s['dmg']
            s['dmg'] = min(1.0, s['dmg'] + self.siege_rate(n, bes) * dt)
            self.damage_town(n, (s['dmg'] - d0) * R.DEG_SIEGE)   # le bombardement touche aussi les maisons
            n['milice'] = max(0.0, n['milice'] - n['milice'] * 0.015 * dt)
            for r in n['garrison']:
                r['morale'] = max(10, r['morale'] - 2 * dt)
            if s['dmg'] >= 0.85 or any(a['assault'] for a in bes):
                gn = self.geo.nodes[nid]
                if self.node_defense_power(nid) < 1:
                    n['siege'] = None
                    self.capture(nid, s['by'])
                    for a in bes:
                        a['state'] = 'idle'
                    continue
                for a in bes:
                    a['state'] = 'idle'
                    a['assault'] = True
                self.start_battle(bes, [], gx=gn['x'], gy=gn['y'], node=nid)

    # ------------------------------------------------------------------ visibilité
    def update_hidden(self):
        for a in self.armies.values():
            if a['state'] in ('battle', 'siege') or a['onroad'] or a['at_node'] is not None:
                a['hidden'] = False
                continue
            ter = self.geo.terrain_at(a['x'], a['y'])
            cover = TERRAIN[ter][2]
            fog = self.weather[self.zone_of(a['x'], a['y'])]['kind'] == 'brouillard'
            has_art = any(r['type'] == 'artillerie' for r in a['regs'])
            stealth = self.mod(a['owner'], 'stealth') > 0
            if cover and (a['stance'] == 'embuscade' or not has_art or stealth):
                a['hidden'] = True
            elif fog and not has_art:
                a['hidden'] = True
            elif stealth and ter in (T_LANDE, T_MARAIS) and a['stance'] == 'embuscade':
                a['hidden'] = True
            else:
                a['hidden'] = False

    def vision_sources(self, code):
        srcs = []
        side = {c for c in self.factions if self.friendly(code, c) or self.factions[c]['overlord'] == code
                or self.factions[code]['overlord'] == c}
        side.add(code)
        nv = self.mod(code, 'node_vision')
        av = self.mod(code, 'vision')
        for n in self.nodes:
            if n['owner'] in side:
                gn = self.geo.nodes[n['id']]
                r = R.NODE_BASE[gn['type']]['vision'] + nv
                srcs.append((gn['x'], gn['y'], r * self.wx(gn['x'], gn['y'])['vision']))
        for a in self.armies.values():
            if a['owner'] in side:
                r = 15 + av + (8 if any(rg['type'] == 'cavalerie' for rg in a['regs']) else 0)
                srcs.append((a['x'], a['y'], r * self.wx(a['x'], a['y'])['vision']))
        for k, until in self.factions[code].get('intel', {}).items():
            if until > self.t:
                x, y = self.node_xy(int(k))
                srcs.append((x, y, 14.0))
        return side, srcs

    def visible_armies(self, code):
        side, srcs = self.vision_sources(code)
        det = BASE_DETECT + self.mod(code, 'detect') + 1.5
        scouts = [(b['x'], b['y']) for b in self.armies.values() if b['owner'] in side and self.gen_trait(b) == 'eclaireur']
        vis = set()
        for a in self.armies.values():
            if a['owner'] in side:
                vis.add(a['id'])
                continue
            for x, y, r in srcs:
                d2 = (a['x'] - x) ** 2 + (a['y'] - y) ** 2
                rr = det if a['hidden'] else r
                if d2 <= rr * rr:
                    vis.add(a['id'])
                    break
            else:
                if a['hidden'] and any((a['x'] - x) ** 2 + (a['y'] - y) ** 2 <= (det + 2) ** 2 for x, y in scouts):
                    vis.add(a['id'])
        return vis, srcs

    # ------------------------------------------------------------------ contacts et batailles
    def detect_contacts(self, only=None):
        """only : n'examine que les rencontres de cette armée (marche instantanée du joueur, tour par tour)."""
        # les armées à bord des gabares ne livrent pas bataille en chemin (elles essuient le feu des berges : river_fire)
        arr = [a for a in self.armies.values() if a['state'] not in ('battle',) and self.t >= a['grace'] and a['regs']
               and not (a.get('boat') and a['at_node'] is None)]
        n = len(arr)
        outer = n
        if only is not None:
            # l'armée examinée en tête, et elle seule contre toutes les autres (n paires au lieu de n²/2)
            arr.sort(key=lambda x: x['id'] != only)
            outer = 1 if arr and arr[0]['id'] == only else 0
        for i in range(outer):
            a = arr[i]
            if a['state'] == 'battle':
                continue
            for j in range(i + 1, n):
                b = arr[j]
                if b['state'] == 'battle' or a['state'] == 'battle':
                    continue
                if not self.at_war(a['owner'], b['owner']):
                    continue
                dx, dy = a['x'] - b['x'], a['y'] - b['y']
                d2 = dx * dx + dy * dy
                if d2 > AMBUSH_KM * AMBUSH_KM:
                    continue
                amb = None
                for x, y in ((a, b), (b, a)):
                    if x['stance'] == 'embuscade' and x['hidden'] and x['state'] == 'idle' and y['state'] in ('move', 'retreat') \
                            and not y['hidden']:
                        det = BASE_DETECT + self.mod(y['owner'], 'detect') + (2.0 if self.gen_trait(y) == 'eclaireur' else 0)
                        if d2 > det * det or d2 <= CONTACT_KM * CONTACT_KM:
                            amb = (x, y)
                if amb:
                    x, y = amb
                    self.start_battle([x], [y], gx=y['x'], gy=y['y'], ambush=True)
                elif d2 <= CONTACT_KM * CONTACT_KM:
                    if a['state'] == 'siege' and b['state'] == 'siege':
                        continue
                    if self.behind_walls(a, b) or self.behind_walls(b, a):
                        continue
                    surprise = a['hidden'] or b['hidden']
                    att, de = (a, b) if (a['state'] == 'move' or a['hidden']) else (b, a)
                    self.start_battle([att], [de], gx=(a['x'] + b['x']) / 2, gy=(a['y'] + b['y']) / 2,
                                      surprise=surprise and att['hidden'])
        # renforts : armées proches d'une bataille en cours
        for bt in self.battles.values():
            for a in self.armies.values():
                if only is not None and a['id'] != only:
                    continue
                if a['state'] == 'battle' or not a['regs'] or self.t < a['grace'] or (a.get('boat') and a['at_node'] is None):
                    continue
                if (a['x'] - bt['x']) ** 2 + (a['y'] - bt['y']) ** 2 > 9:
                    continue
                for si, side in enumerate(bt['sides']):
                    other = bt['sides'][1 - si]
                    if self.friendly(a['owner'], side['owner']) and self.hostile(a['owner'], other['owner']):
                        self.join_battle(a, bt, si)
                        break

    def behind_walls(self, d, s):
        """d est retranchée dans une place amie que s assiège ou devant laquelle s attend : on ne sort pas se battre,
        les défenseurs combattront avec la garnison et les remparts quand l'assaut viendra."""
        nid = d['at_node']
        if nid is None or d['state'] not in ('idle', 'siege') or s['state'] in ('move', 'retreat'):
            return False
        n = self.nodes[nid]
        return self.friendly(d['owner'], n['owner']) and s['at_node'] == nid

    def join_battle(self, a, bt, si):
        side = bt['sides'][si]
        if a['id'] in side['armies']:
            return
        side['armies'].append(a['id'])
        side['men0'] += self.army_men(a)
        a['ro'] = [[r['id'], r['type']] for r in a['regs']]
        a['state'] = 'battle'
        a['battle'] = bt['id']
        if a['owner'] != self.player or a.get('tac_auto', True):
            self.choose_tactics(a, bt, si)
        if a['owner'] == self.player:
            self.log('battle', f"{a['name']} rejoint la bataille {self.place_name(bt['x'], bt['y'])}.",
                     bt['x'], bt['y'], who=a['owner'])

    def square_reflex(self, bt, phase, cav_share, dt):
        """Réflexe du carré : une infanterie commandée à la main forme d'elle-même le carré quand les escadrons chargent.
        Les vétérans le forment vite ; les conscrits tardent, et la manœuvre est le moment le plus dangereux."""
        if phase == 'canonnade':
            return
        for si in (0, 1):
            if cav_share[1 - si] < 0.3:
                continue
            for aid in bt['sides'][si]['armies']:
                a = self.armies.get(aid)
                if not a or a.get('tac_auto', True) or not a.get('rx', True) or a.get('fm') == 'carre':
                    continue
                inf = [r for r in a['regs'] if self.arm_class(r['type']) == 'inf']
                if not inf:
                    continue
                men = sum(r['n'] for r in inf) or 1.0
                xp = sum(r['n'] * r['xp'] for r in inf) / men
                mor = sum(r['n'] * r['morale'] for r in inf) / men
                if self.rng.random() < dt * 4 * (0.5 + xp / 100 + mor / 200):
                    a['fm'] = 'carre'
                    a['fm_t'] = self.t - 0.1 * min(0.8, xp / 100)   # les vétérans se forment plus vite
                    if a['owner'] == self.player and a.get('_rx_bt') != bt['id']:
                        a['_rx_bt'] = bt['id']
                        self.log('battle', f"Les escadrons chargent : l'infanterie de la {a['name']} forme le carré !",
                                 bt['x'], bt['y'], who=a['owner'])

    def dissolve_battle(self, bt):
        """Fin sans vainqueur : paix signée, capitulation ou place passée à un autre camp en cours de combat."""
        for side in bt['sides']:
            for aid in side['armies']:
                a = self.armies.get(aid)
                if a and a['battle'] == bt['id']:
                    a['battle'] = None
                    a['assault'] = False
                    a['state'] = 'move' if a['path'] else 'idle'
                    a['grace'] = self.t + 1.0
        self.battles.pop(bt['id'], None)

    def settle_conflicts(self):
        """Remet d'aplomb batailles, sièges et armées que la diplomatie ou une prise ont laissés sans objet."""
        for bt in list(self.battles.values()):
            s0, s1 = bt['sides']
            if not self.hostile(s0['owner'], s1['owner']) or \
                    (s1['node'] is not None and self.nodes[s1['node']]['owner'] != s1['owner']):
                self.dissolve_battle(bt)
        for n in self.nodes:
            s = n['siege']
            if s and (s['by'] not in self.factions or not self.factions[s['by']]['alive'] or not self.hostile(s['by'], n['owner'])):
                n['siege'] = None
        battle_nodes = {bt['node'] for bt in self.battles.values() if bt['node'] is not None}
        for a in list(self.armies.values()):
            nid = a['at_node']
            if nid is None or a['state'] not in ('idle', 'siege') or a['battle'] or not a['regs'] or a.get('boat'):
                continue
            n = self.nodes[nid]
            if n['siege'] and n['siege']['by'] == a['owner'] and a['state'] == 'siege':
                continue
            if a['state'] == 'idle' and not self.hostile(a['owner'], n['owner']):
                if not self.friendly(a['owner'], n['owner']) and self.t >= a.get('grace', 0) \
                        and not AA.may_stay(self, a, n['owner']):
                    self.retreat(a)   # la paix (ou un traité) l'a laissée chez un voisin : elle rentre chez elle
                continue
            if nid in battle_nodes or (n['siege'] and n['siege']['by'] != a['owner']) or self.t < a.get('grace', 0):
                a['state'] = 'idle'
                continue
            # armée restée sur une place hostile sans siège (relève battue, siège levé...) : on reprend comme à l'arrivée
            # (sans fenêtre de choix : ce n'est pas une arrivée en marche)
            a['state'] = 'idle'
            self.arrive_node(a, nid, ask=False)
            if a['state'] == 'siege' or a['battle']:
                battle_nodes.update(bt['node'] for bt in self.battles.values() if bt['node'] is not None)

    def start_battle(self, att, de, gx, gy, node=None, ambush=False, surprise=False):
        bid = self.nid('b')
        code_a = att[0]['owner']
        if node is not None:
            code_d = self.nodes[node]['owner']
            for a in self.armies.values():
                if a['at_node'] == node and a['state'] in ('idle',) and a['owner'] != code_a and self.friendly(a['owner'], code_d) \
                        and a not in de:
                    de.append(a)
        else:
            code_d = de[0]['owner']
        ter = self.geo.terrain_at(gx, gy)
        c = self.geo.cell(gx, gy)
        bt = dict(id=bid, x=gx, y=gy, node=node, t0=self.t, ambush=ambush, surprise=surprise,
                  terrain=TERRAIN[ter][0], cover=TERRAIN[ter][2], defbonus=TERRAIN[ter][3],
                  river=self.geo.river[c] if c >= 0 else 0,
                  sides=[dict(owner=code_a, armies=[a['id'] for a in att], men0=0.0, lost=0.0, node=None),
                         dict(owner=code_d, armies=[a['id'] for a in de], men0=0.0, lost=0.0, node=node)],
                  recent=[0.0, 0.0])
        for side, lst in ((bt['sides'][0], att), (bt['sides'][1], de)):
            for a in lst:
                a['state'] = 'battle'
                a['battle'] = bid
                a['ro'] = [[r['id'], r['type']] for r in a['regs']]   # ordre de bataille, pour les régiments anéantis (bury)
                a['path'] = [] if a in de or ambush else a['path']
                side['men0'] += self.army_men(a)
            if side['node'] is not None:
                n = self.nodes[side['node']]
                side['men0'] += n['milice'] + sum(r['n'] for r in n['garrison'])
        if ambush:
            for a in de:
                for r in a['regs']:
                    r['morale'] = max(5, r['morale'] - 25 * (1 + self.mod(code_a, 'ambush')))
        bt['landing'] = any(a.get('landing') for a in att)
        for si, lst in ((0, att), (1, de)):
            for a in lst:
                if self.gen_trait(a) == 'inspirant':
                    for r in a['regs']:
                        r['morale'] = min(100 + self.mod(a['owner'], 'morale'), r['morale'] + 10)
        bt['phase'] = self.battle_phase(bt)
        bt['mor'] = [100, 100]
        for si, lst in ((0, att), (1, de)):
            for a in lst:
                if a['owner'] != self.player or a.get('tac_auto', True):
                    self.choose_tactics(a, bt, si)
        self.battles[bid] = bt
        bt['log0'] = BL.snapshot(self, bt)   # forces au début, pour le journal des batailles (logs/)
        TB.on_battle_start(self, bt)   # bataille du joueur : elle attend son choix (sur ordres ou automatique)
        gname = self.place_name(gx, gy)
        if code_a == self.player or code_d == self.player or self.player in (code_a, code_d):
            self.alert_pause()
            kind = 'Embuscade' if ambush else ('Assaut' if node is not None else 'Bataille')
            self.log('battle', f"{kind} {gname} : {self.fname(code_a)} attaque {self.fname(code_d)}.", gx, gy,
                     who=code_a, important=True)

    def fname(self, code):
        return 'les insurgés' if code == R.NEUTRAL else self.faction_name(code)

    def place_name(self, x, y):
        nid = self.nearest_node(x, y)
        gn = self.geo.nodes[nid]
        d = math.hypot(gn['x'] - x, gn['y'] - y)
        if d < 3:
            return f"de {gn['name']}" if gn['name'][0] not in 'AEIOUÉÈH' else f"d'{gn['name']}"
        return f"près de {gn['name']}"

    def side_units(self, bt, si):
        side = bt['sides'][si]
        units = []
        for aid in side['armies']:
            a = self.armies.get(aid)
            if a:
                for r in a['regs']:
                    units.append((a['owner'], r, a))
        return units

    # ------------------------------------------------------------------ tactique
    @staticmethod
    def arm_class(typ):
        return R.UNITS[typ]['cls'] if typ in R.UNITS else 'inf'

    def battle_phase(self, bt):
        age = self.t - bt['t0']
        mor = bt.get('mor', [100, 100])
        if age < 0.25 and not bt['ambush']:
            return 'canonnade'
        # une armée surtout montée n'attend pas : elle charge dès que les canons se sont tus
        if age < 1.0 and min(mor) > 45 and not (age >= 0.4 and max(bt.get('cav', [0, 0])) >= 0.55):
            return 'fusillade'
        return 'charge'

    def gen_trait(self, a):
        g = a.get('gen') if a else None
        return g['trait'] if g else None

    def gen_level_k(self, a):
        g = a.get('gen') if a else None
        return 1 + 0.05 * ((g['lvl'] if g else 1) - 1)

    def unit_vul(self, cls_att, typ, fm, protected, phase='charge'):
        """Vulnérabilité d'une unité cible face à une arme donnée."""
        if typ == 'artillerie':
            v = 0.6 if protected else (1.6 if cls_att == 'cavalerie' else 1.2)
        elif typ == 'cavalerie':
            v = 0.9 if phase == 'charge' else 0.5  # tenue en réserve, hors de portée, jusqu'à la charge
        elif typ == 'milice':
            v = 1.1
        else:
            v = 1.0
            if fm == 'ligne':
                v *= 1.3 if cls_att == 'cavalerie' else 1.0
            elif fm == 'colonne':
                v *= 1.35 if cls_att == 'artillerie' else 1.0
            elif fm == 'carre':
                v *= {'artillerie': 1.6, 'cavalerie': 0.35, 'inf': 1.1}[cls_att]
            elif fm == 'carre_forme':
                # surprise pendant qu'elle forme le carré : l'infanterie est à la merci des cavaliers
                v *= {'artillerie': 1.3, 'cavalerie': 1.7, 'inf': 1.2}[cls_att]
            elif fm == 'tirailleurs':
                v *= {'artillerie': 0.75, 'cavalerie': 1.4, 'inf': 0.85}[cls_att]
        return v

    def foe_mix(self, bt, si):
        foe = self.side_units(bt, 1 - si)
        tot = sum(r['n'] for _, r, _ in foe) or 1
        cav = sum(r['n'] for _, r, _ in foe if r['type'] == 'cavalerie') / tot
        art = sum(r['n'] for _, r, _ in foe if r['type'] == 'artillerie') / tot
        return foe, cav, art

    def choose_formation(self, a, bt, si, phase):
        """Formation adaptée à la phase et aux armes de l'ennemi (IA ou général laissé libre)."""
        _, cav, art = self.foe_mix(bt, si)
        if phase == 'canonnade':
            return 'tirailleurs' if art > 0.12 else 'ligne'
        if phase == 'fusillade':
            return 'carre' if cav > 0.4 else ('tirailleurs' if bt['cover'] and art > 0.2 else 'ligne')
        if cav > 0.25:
            return 'carre'
        return 'colonne' if si == 0 else 'ligne'

    def choose_tactics(self, a, bt, si):
        """Formation et plan choisis par l'IA (ou le général) au début d'une bataille."""
        foe, cav, art = self.foe_mix(bt, si)
        mine = sum(r['n'] for r in a['regs']) or 1
        my_art = sum(r['n'] for r in a['regs'] if r['type'] == 'artillerie') / mine
        my_cav = sum(r['n'] for r in a['regs'] if r['type'] == 'cavalerie') / mine
        fm = self.choose_formation(a, bt, si, bt.get('phase') or self.battle_phase(bt))
        my_pow = self.army_power(a, bt['terrain'])
        foe_pow = sum(self.reg_power(o, r, bt['terrain'], 1.0, False, x) for o, r, x in foe) + 1
        if bt['sides'][1 - si]['node'] is not None:
            n = self.nodes[bt['sides'][1 - si]['node']]
            foe_pow += n['milice'] * R.MILICE_POWER * self.milice_k(n['owner']) * (1 + 0.35 * n['fort'])
        if my_pow < 0.5 * foe_pow and bt['sides'][si]['node'] is None:
            pl = 'harcelement'
        elif my_art >= 0.08 and (si == 0 or bt['node'] is not None):
            pl = 'artillerie'
        elif my_cav >= 0.25 and bt['terrain'] in R.OPEN_TERRAIN:
            pl = 'debordement'
        elif si == 1 and my_pow < foe_pow:
            pl = 'tenir'
        else:
            pl = 'frontal'
        a['fm'], a['pl'] = fm, pl

    def update_battles(self, dt, only=None):
        """Résolution automatique (choix « Automatique », batailles sans le joueur), par pas de campagne : pertes typées
        selon la phase, les formations et les plans, puis la fin, recalée sur les batailles jouées sur le champ de
        bataille. En rase campagne, le camp dominé (battle_yield) ou dont le moral casse se retire en bon ordre ; seule une
        armée presque anéantie (moins de 18 % de ses hommes) est mise en déroute et poursuivie. Devant une place,
        l'assaillant dominé décroche, mais un assaut brisé reflue en désordre ; le défenseur ne décroche jamais : il rend
        la place s'il cède. Au bout de 4 jours, le plus puissant l'emporte."""
        K = 0.20
        for bid in list(self.battles):
            if only is not None and bid != only:
                continue
            bt = self.battles.get(bid)
            if not bt or not TB.is_auto(bt):
                continue   # (bataille en attente du choix, ou commandée sur le champ de bataille)
            s0, s1 = bt['sides']
            if not self.hostile(s0['owner'], s1['owner']) or \
                    (s1['node'] is not None and self.nodes[s1['node']]['owner'] != s1['owner']):
                self.dissolve_battle(bt)  # capitulation ou paix survenue pendant ce même pas de temps
                continue
            age = self.t - bt['t0']
            phase = self.battle_phase(bt)
            if phase != bt.get('phase'):
                # les généraux laissés libres adaptent leur formation à la nouvelle phase
                for si in (0, 1):
                    for aid in bt['sides'][si]['armies']:
                        a = self.armies.get(aid)
                        if a and (a['owner'] != self.player or a.get('tac_auto', True)):
                            fm = self.choose_formation(a, bt, si, phase)
                            if fm != a.get('fm'):
                                a['fm'] = fm
                                a['fm_t'] = self.t - 0.05
            bt['phase'] = phase
            TB.auto_battle_tick(self, bt, dt)   # munitions consommées, fatigue
            wxf = self.wx(bt['x'], bt['y'])['fire']
            open_ground = bt['terrain'] in R.OPEN_TERRAIN
            P = [dict(artillerie=0.0, inf=0.0, cavalerie=0.0), dict(artillerie=0.0, inf=0.0, cavalerie=0.0)]
            targets = [[], []]  # (poids, type, formation, protégé, objet, armée)
            men = [0.0, 0.0]
            # part de cavalerie de chaque camp (le carré fusille les escadrons qui le chargent)
            cav_share = []
            for si in (0, 1):
                us = self.side_units(bt, si)
                tot = sum(r['n'] for _, r, _ in us) or 1.0
                cav_share.append(sum(r['n'] for _, r, _ in us if r['type'] == 'cavalerie') / tot)
            bt['cav'] = cav_share
            self.square_reflex(bt, phase, cav_share, dt)
            flank = [False, False]
            for si in (0, 1):
                side = bt['sides'][si]
                side['armies'] = [aid for aid in side['armies'] if aid in self.armies and self.armies[aid]['regs']]
                units = self.side_units(bt, si)
                node = self.nodes[side['node']] if side['node'] is not None else None
                protected = any(self.arm_class(r['type']) != 'artillerie' for _, r, _ in units) or (node is not None and node['milice'] > 0)
                fb, wall = 1.0, 1.0
                if node is not None:
                    o = node['owner']
                    fort_eff = AA.fort_eff(self, node, bt['sides'][1 - si]['owner'])
                    fb = 1 + 0.35 * fort_eff + (self.mod(o, 'fort_bonus') if o != R.NEUTRAL else 0)
                    wall = 1.0 / (1 + 0.55 * fort_eff)  # les remparts abritent les défenseurs
                for owner, r, a in units:
                    cls = self.arm_class(r['type'])
                    fm, pl, tr = a.get('fm', 'ligne'), a.get('pl', 'frontal'), self.gen_trait(a)
                    rp = self.reg_power(owner, r, bt['terrain'], wxf, bt['cover'], a)
                    rm = self.reg_mods(owner, r)
                    rp *= (0.75 + 0.25 * a['supply']) * R.PHASE_W[phase][cls] * fb
                    if cls == 'inf':
                        if fm == 'ligne':
                            rp *= 1.2 + rm.get('ligne_fire', 0.0) if phase == 'fusillade' else 1.05
                        elif fm == 'colonne':
                            rp *= 1.25 + rm.get('colonne_charge', 0.0) if phase == 'charge' else 0.85
                        elif fm == 'carre':
                            rp *= 0.9 * (1 + (0.6 + rm.get('carre_fire', 0.0)) * cav_share[1 - si])
                        elif fm == 'tirailleurs' and bt['cover']:
                            rp *= 1.15
                    elif phase == 'charge':
                        rp *= 1 + rm.get('cav_charge' if cls == 'cavalerie' else 'art_charge', 0.0)
                    if pl == 'artillerie':
                        if cls == 'artillerie' and phase != 'charge':
                            rp *= 1.4
                        elif cls == 'inf' and phase == 'canonnade':
                            rp *= 0.8
                    elif pl == 'debordement':
                        if cls == 'cavalerie' and phase != 'canonnade':
                            rp *= 1.6 if open_ground else 0.8
                            if open_ground and cav_share[si] > cav_share[1 - si] * 1.2:
                                flank[si] = True
                        elif cls == 'inf':
                            rp *= 0.92
                    elif pl == 'tenir':
                        rp *= 0.9 if si == 1 or bt['node'] is not None else 0.65
                    elif pl == 'harcelement':
                        rp *= 0.6
                    if tr == 'audacieux' and si == 0:
                        rp *= 1.12
                    if si == 1:
                        rp *= bt['defbonus'] * (1.2 if a['stance'] == 'retranche' else 1.0)
                    else:
                        if bt['river'] >= 2:
                            rp *= 0.85
                        if bt.get('landing') and age < 0.5:
                            rp *= 0.8
                        if bt['ambush'] and age < 0.35:
                            rp *= 1.8 + self.mod(owner, 'ambush') + (0.25 if tr == 'eclaireur' else 0)
                        elif bt['surprise'] and age < 0.2:
                            rp *= 1.3
                    if self.t - a.get('fm_t', -9) < 0.1 * max(0.2, 1 - self.mod(owner, 'fm_swift')):
                        rp *= 0.6  # réorganisation en cours
                    P[si][cls] += rp
                    men[si] += r['n']
                    recv = 1.0
                    if pl == 'tenir':
                        recv *= 0.8 if si == 1 else 0.9
                    elif pl == 'harcelement':
                        recv *= 0.6
                    elif pl == 'artillerie' and phase == 'canonnade':
                        recv *= 0.85
                    if tr == 'prudent' and si == 1:
                        recv *= 0.88
                    elif tr == 'audacieux':
                        recv *= 1.05
                    fm_t = fm
                    if fm == 'carre' and self.t - a.get('fm_t', -9) < 0.1 * max(0.2, 1 - self.mod(owner, 'fm_swift')):
                        fm_t = 'carre_forme'
                    targets[si].append((r['n'], r['type'], fm_t, protected, r, a, recv * wall))
                if node is not None:
                    o = node['owner']
                    P[si]['inf'] += node['milice'] * R.MILICE_POWER * self.milice_k(o) * fb * R.PHASE_W[phase]['inf'] * 1.05
                    men[si] += node['milice']
                    targets[si].append((node['milice'], 'milice', 'ligne', protected, node, None, wall))
                    if o != R.NEUTRAL:
                        for r in node['garrison']:
                            cls = self.arm_class(r['type'])
                            P[si][cls] += self.reg_power(o, r, bt['terrain'], wxf) * fb * R.PHASE_W[phase][cls] \
                                * (R.GARDE_HOME if r['type'] == 'garde' else 1)
                            men[si] += r['n']
                            targets[si].append((r['n'], r['type'], 'ligne', protected, r, None, wall))
                    # les canons du rempart (servants à l'abri des murs : ils ne comptent pas parmi les pertes)
                    P[si]['artillerie'] += self.fort_guns_power(node, bt['terrain'], wxf) * R.FORT_GUNS_AUTO \
                        * R.PHASE_W[phase]['artillerie']
            # pertes typées : chaque arme frappe selon la vulnérabilité des cibles
            lost_now = [0.0, 0.0]
            for si in (0, 1):
                tg = targets[si]
                W = sum(t[0] for t in tg)
                if W <= 0:
                    continue
                owner_si = bt['sides'][si]['owner']
                cas = 1 + (self.mod(owner_si, 'casualties') if owner_si != R.NEUTRAL else 0)
                dmg_j = [0.0] * len(tg)
                for cls in ('artillerie', 'inf', 'cavalerie'):
                    pw = P[1 - si][cls]
                    if pw <= 0:
                        continue
                    vul = [t[0] * self.unit_vul(cls, t[1], t[2], t[3], phase) for t in tg]
                    V = sum(vul)
                    if V <= 0:
                        continue
                    D = K * pw * dt * (V / W)
                    for j, v in enumerate(vul):
                        dmg_j[j] += D * v / V
                for j, t in enumerate(tg):
                    dmg_j[j] *= t[6] * cas
                lost_now[si] = self.apply_typed_losses(bt, si, tg, dmg_j, max(1.0, men[si]), 1.35 if flank[1 - si] else 1.0)
            bt['mor'] = [self.side_morale(bt, 0), self.side_morale(bt, 1)]
            # fin ?
            res, disengage = None, False
            for si in (0, 1):
                side = bt['sides'][si]
                m_now = self.side_men(bt, si)
                wiped = m_now < 10 or m_now < side['men0'] * 0.18
                if wiped or bt['mor'][si] < 12:
                    res = 1 - si
                    # en rase campagne, une armée ébranlée se retire comme dans les batailles commandées (ses fuyards la
                    # rejoignent) : seuls les débris d'une armée presque anéantie sont poursuivis ; devant une place,
                    # l'assaut brisé reflue en désordre
                    disengage = bt['node'] is None and not wiped
                    break
            if res is None:
                res, disengage = self.battle_yield(bt, P)
            if res is None and age > 1.0:
                for si in (0, 1):
                    side = bt['sides'][si]
                    arms = [self.armies[x] for x in side['armies'] if x in self.armies]
                    if side['node'] is None and arms and all(x.get('pl') == 'harcelement' for x in arms) \
                            and bt['mor'][si] <= bt['mor'][1 - si]:
                        res, disengage = 1 - si, True
                        break
            if res is None and age > 4.0:
                tot = [sum(P[i].values()) for i in (0, 1)]
                res = 0 if tot[0] >= tot[1] else 1
                disengage = bt['sides'][1 - res]['node'] is None
            if res is not None:
                self.end_battle(bt, res, disengage)

    def resolve_battle_now(self, bt):
        """Tour par tour : une bataille automatique du joueur se règle sur-le-champ. Elle se joue en temps virtuel (la
        date de la campagne ne bouge pas), comme les jours qu'elle durerait."""
        bid, t0 = bt['id'], self.t
        try:
            for _ in range(int(8 / SUBSTEP)):
                if bid not in self.battles:
                    break
                self.t += SUBSTEP
                self.update_battles(SUBSTEP, only=bid)
        finally:
            self.restore_clock(t0)

    def restore_clock(self, t0):
        """Fin d'un temps virtuel (marche ou bataille réglée dans le tour du joueur) : la date reprend où elle était."""
        self.t = t0
        for b in self.battles.values():
            b['t0'] = min(b['t0'], t0)
        for a in self.armies.values():
            if a.get('grace', 0.0) > t0 + 1.0:
                a['grace'] = t0 + 1.0
        for n in self.nodes:
            if n.get('siege') and n['siege'].get('since', t0) > t0:
                n['siege']['since'] = t0   # siège commencé en chemin : il commence aujourd'hui

    def battle_yield(self, bt, P):
        """Un camp dominé cède avant la déroute, comme dans les batailles commandées (rules.WD_*) : hors d'une place, il
        décroche en bon ordre ; le défenseur d'une place la rend. P : puissance de chaque camp à cet instant, par arme.
        Renvoie (vainqueur, décrochage), ou (None, False) si le combat continue."""
        tot = [sum(P[0].values()), sum(P[1].values()) * R.WD_DEF]   # (le défenseur tient mieux que sa puissance)
        loss = [s['lost'] / max(1.0, s['men0']) for s in bt['sides']]
        for si in sorted((0, 1), key=lambda i: -loss[i]):   # le plus éprouvé d'abord
            ratio = tot[si] / max(1e-9, tot[1 - si])
            if bt['sides'][si]['node'] is not None:
                if loss[si] > R.WD_PLACE_LOSS and ratio < R.WD_RATIO:
                    return 1 - si, False
                continue
            if (loss[si] > R.WD_LOSS and ratio < R.WD_RATIO) or (loss[si] > R.WD_EVEN_LOSS and ratio < 1.0):
                return 1 - si, True
        return None, False

    def apply_typed_losses(self, bt, si, tg, dmg_j, men_total, shock=1.0):
        side = bt['sides'][si]
        frac_side = sum(dmg_j) / men_total * shock  # pris de flanc, le moral s'effondre plus vite
        total = 0.0
        for (w, typ, fm, prot, obj, a, recv), d in zip(tg, dmg_j):
            if typ == 'milice':
                loss = min(obj['milice'], d)
                obj['milice'] -= loss
            else:
                loss = min(obj['n'], d)
                obj['n'] -= loss
                o = a['owner'] if a is not None else side['owner']   # (un régiment allié : la Croix-Rouge de son camp)
                if o in self.factions:   # Croix-Rouge : une part des blessés rejoindra le régiment (end_battle)
                    obj['wnd'] = obj.get('wnd', 0.0) + loss * self.mod(o, 'wounded')
                k = 230 if a is not None else 150
                if a is not None:
                    if a.get('pl') == 'tenir':
                        k *= 0.7
                    if self.gen_trait(a) == 'inspirant':
                        k *= 0.85
                obj['morale'] = max(0.0, obj['morale'] - frac_side * k)
            total += loss
        side['lost'] += total
        if side['node'] is not None:
            n = self.nodes[side['node']]
            n['garrison'] = [r for r in n['garrison'] if r['n'] >= 5]
        for aid in side['armies']:
            a = self.armies.get(aid)
            if a:
                a['regs'] = [r for r in a['regs'] if r['n'] >= 5]
        return total

    def side_men(self, bt, si):
        m = sum(r['n'] for _, r, _ in self.side_units(bt, si))
        nd = bt['sides'][si]['node']
        if nd is not None:
            n = self.nodes[nd]
            m += n['milice'] + sum(r['n'] for r in n['garrison'])
        return m

    def side_morale(self, bt, si):
        tot = w = 0.0
        for _, r, _ in self.side_units(bt, si):
            tot += r['morale'] * r['n']
            w += r['n']
        nd = bt['sides'][si]['node']
        if nd is not None:
            n = self.nodes[nd]
            for r in n['garrison']:
                tot += r['morale'] * r['n']
                w += r['n']
            fort = AA.fort_eff(self, n)
            mm = min(100, 55 + 15 * fort)
            tot += mm * n['milice']
            w += n['milice']
        return tot / w if w > 0 else 0

    def end_battle(self, bt, winner, disengage=False):
        """Fin d'une bataille, automatique ou commandée (bridge.finish) : prise de la place (sauf décrochage), retraite du
        vaincu (poursuivi s'il est rompu, en bon ordre s'il décroche ; il y perd des traînards : rules.LOSER_STRAGGLE),
        prisonniers (ceux du champ de bataille pour une bataille commandée), lassitude et bilan des deux camps, journal."""
        loser = 1 - winner
        W, L = bt['sides'][winner], bt['sides'][loser]
        nd = next((s['node'] for s in bt['sides'] if s['node'] is not None), None)
        if nd is not None and 'tac' not in bt:
            self.damage_town(self.nodes[nd], R.DEG_ASSAUT)   # (une bataille commandée a compté ses maisons : bridge.finish)
        for aid in W['armies'] + L['armies']:   # régiments restés sur le champ de bataille (bataille commandée ou non)
            a = self.armies.get(aid)
            if a and 'ro' in a:
                self.bury(a, a.pop('ro'))
        for si in (0, 1):   # Croix-Rouge : les blessés soignés reviennent aux régiments (wnd, compté pendant la bataille)
            nd = bt['sides'][si]['node']
            for r in [r for _, r, _ in self.side_units(bt, si)] + (self.nodes[nd]['garrison'] if nd is not None else []):
                if 'wnd' in r:
                    r['n'] = min(r['max'], r['n'] + r.pop('wnd'))
        caught = 0.0   # hommes rattrapés pendant la poursuite
        gname = self.place_name(bt['x'], bt['y'])
        has_cav = any(r['type'] == 'cavalerie' for _, r, _ in self.side_units(bt, winner))
        if not disengage and L['node'] is not None:
            # prise de la place, avant la retraite des vaincus (sinon ils se replieraient dans la place perdue)
            nid = L['node']
            self.nodes[nid]['milice'] = 0
            self.nodes[nid]['garrison'] = []
            self.capture(nid, W['owner'])
            for aid in W['armies']:
                a = self.armies.get(aid)
                if a:
                    a['at_node'] = nid
                    a['x'], a['y'] = self.node_xy(nid)
                    a['edge'] = None
                    a['onroad'] = True
        for si in (0, 1):
            for aid in bt['sides'][si]['armies']:
                a = self.armies.get(aid)
                if not a:
                    continue
                a['battle'] = None
                a['landing'] = False
                if si == winner:
                    for r in a['regs']:
                        r['xp'] = min(100, r['xp'] + 8)
                        r['morale'] = max(r['morale'], 35)
                    a['state'] = 'move' if a['path'] else 'idle'
                    a['assault'] = False
                    # (l'ennemi qui décroche en bon ordre lui laisse aussi le terrain : c'est une victoire)
                    # une vraie bataille rangée compte plus qu'une escarmouche contre la milice d'un village
                    foe_armies = bool(L['armies']) or (L['node'] is not None and self.geo.nodes[L['node']]['type'] in ('capitale', 'ville', 'fort'))
                    self.general_xp(a, 1 if foe_armies and L['men0'] >= 300 else 0.34)
                else:
                    # poursuite d'un vaincu rompu (déjà faite sur le champ de bataille d'une bataille commandée)
                    pursuit = 0.0 if disengage or bt.get('tac') else \
                        (R.PURSUIT_CAV if has_cav else R.PURSUIT_FOOT) * (1 + self.mod(a['owner'], 'retreat'))
                    if self.gen_trait(a) == 'prudent':
                        pursuit *= 0.5
                    # battu, même en bon ordre, il sème des traînards dans la retraite (comptés avec les désertions du mois)
                    gone = 0.0
                    for r in a['regs']:
                        caught += r['n'] * pursuit
                        r['n'] *= 1 - pursuit
                        gone += r['n'] * R.LOSER_STRAGGLE
                        r['n'] *= 1 - R.LOSER_STRAGGLE
                        r['morale'] = max(r['morale'], 18)
                    if gone > 0:
                        a['des'] = a.get('des', 0.0) + gone
                        a['des_why'] = a.get('des_why') or 'traînards de la retraite'
                    self.prune(a)
                    if not a['regs']:
                        del self.armies[aid]
                        continue
                    if not disengage and a.get('gen') and self.rng.random() < 0.12:
                        old = self.gen_title(a['gen'])
                        a['gen'] = self.new_general(a['owner'])
                        if a['owner'] == self.player:
                            self.log('armee', f"Le {old[0].lower() + old[1:]} est tombé au combat. Le colonel {a['gen']['name']} "
                                              f"prend la tête de la {a['name']}.",
                                     a['x'], a['y'], who=a['owner'], important=True)
                    self.retreat(a)
        tac = bt.get('tac')   # bataille menée à la main : ses prisonniers, déjà faits sur le champ de bataille
        if tac:
            for si in (0, 1):
                taker, n_ = bt['sides'][1 - si]['owner'], tac['prisoners'][si]
                if n_ > 0 and taker in self.factions:
                    pr = self.factions[taker].setdefault('prisoners', {})
                    pr[bt['sides'][si]['owner']] = pr.get(bt['sides'][si]['owner'], 0) + n_
        # (dans les rues d'une place, assaillants repoussés ou défenseurs cernés se rendent plus souvent)
        prisoners = tac['prisoners'][loser] if tac else \
            int(L['lost'] * (R.PRISON_LOSS if bt['node'] is None else R.PRISON_ASSAULT) + caught * R.PRISON_CAUGHT)
        if prisoners > 0 and W['owner'] in self.factions and not tac:
            pr = self.factions[W['owner']].setdefault('prisoners', {})
            pr[L['owner']] = pr.get(L['owner'], 0) + prisoners
        # toute bataille lasse le pays et compte au bilan, qu'elle finisse par une déroute ou par un décrochage
        for si, side in ((winner, W), (loser, L)):
            if side['owner'] in self.factions:
                f_ = self.factions[side['owner']]
                f_['_lost_m'] = f_.get('_lost_m', 0.0) + side['lost']
                st = f_['stats']
                st['won' if si == winner else 'lost'] += 1
                st['killed'] += bt['sides'][1 - si]['lost']
                f_['lb'] = [int(si == winner), round(self.t, 2), round(bt['x'], 2), round(bt['y'], 2)]   # dernière bataille et son lieu, pour la carte (estafettes, fêtes, deuil)
        if bt['node'] is None:   # champ de bataille : la carte y montre blessés et tombes (décor seulement)
            self.sites = [x for x in self.sites if self.t - x['t'] < SITE_DAYS]
            self.sites.append(dict(x=round(bt['x'], 2), y=round(bt['y'], 2), t=round(self.t, 2),
                                   l=[int(x['lost']) for x in bt['sides']], o=[x['owner'] for x in bt['sides']],
                                   w=winner, p=int(max(0, prisoners))))   # (le vainqueur et ses prisonniers : la colonne vers l'arrière)
        if W['node'] is not None:
            # la place a tenu : le siège des vaincus est levé (pas celui d'un autre camp)
            n = self.nodes[W['node']]
            if n['siege'] and n['siege']['by'] == L['owner']:
                n['siege'] = None
        self.battles.pop(bt['id'], None)
        BL.campaign_end(self, bt, winner, disengage, prisoners,
                        TB.find(self, bt['id']) if bt.get('tac') else None)   # journal des batailles (logs/)
        if self.player in (W['owner'], L['owner']) or any(
                self.friendly(self.player, s['owner']) for s in (W, L)):
            won = self.friendly(self.player, W['owner'])
            nt = 'nt' if (L if disengage else W)['owner'] == R.NEUTRAL else ''
            if disengage:
                kind = 'Assaut' if bt['node'] is not None else ('Embuscade' if bt['ambush'] else 'Bataille')
                head = (f"{kind} {gname} : {self.fname(L['owner'])} se replie{nt} en bon ordre devant "
                        f"{self.fname(W['owner'])}.")
            else:
                head = f"{'Victoire' if won else 'Défaite'} {gname} — {self.fname(W['owner'])} l'emporte{nt}."
            txt = (f"{head} Pertes : {self.fname(bt['sides'][0]['owner'])} {int(bt['sides'][0]['lost'])}, "
                   f"{self.fname(bt['sides'][1]['owner'])} {int(bt['sides'][1]['lost'])}."
                   + (f" Prisonniers : {prisoners}." if prisoners > 0 else ''))
            self.log('battle_end', txt, bt['x'], bt['y'], who=W['owner'], important=True,
                     extra=dict(win=won, a=bt['sides'][0]['owner'], d=bt['sides'][1]['owner'],
                                la=int(bt['sides'][0]['lost']), ld=int(bt['sides'][1]['lost'])))

    def retreat(self, a):
        code = a['owner']
        a['state'] = 'retreat'
        a['grace'] = self.t + 1.0
        a['stance'] = 'normal'
        a['hold'] = a['qrt'] = False
        a['assault'] = False
        best = None
        for gn in self.geo.nodes:
            n = self.nodes[gn['id']]
            if (n['owner'] == code or self.friendly(code, n['owner'])) and not (n['siege'] and n['siege']['by'] != code):
                d = math.hypot(gn['x'] - a['x'], gn['y'] - a['y'])
                if best is None or d < best[0]:
                    best = (d, gn['id'])
        if best is None:
            del self.armies[a['id']]
            return
        if a['at_node'] == best[1]:
            a['state'] = 'idle'
            return
        a['mode'] = 'route'
        # d'abord sans traverser de terres fermées ; une retraite ne doit jamais piéger l'armée : au besoin, elle
        # passe quand même, et le délai de grâce s'applique
        block = AA.closed_owners(self, code)
        legs = None
        for blk in (block, frozenset()):
            legs = self.plan_route(a, best[1], blk)
            if not legs:
                pts = self.geo.astar(a['x'], a['y'], *self.node_xy(best[1]), block=AA.cell_mask(self, blk))
                legs = [dict(kind='off', pts=[list(p) for p in pts], i=1)] if pts else None
            if legs or not block:
                break
        if not legs:
            for r in a['regs']:
                r['n'] *= 0.6
            a['state'] = 'idle'
            return
        a['path'] = legs
        a['target'] = dict(node=best[1])
        a['at_node'] = None

    def order_retreat(self, code, aid):
        a = self.armies.get(aid)
        if not a or a['owner'] != code:
            return False, "Armée introuvable."
        if a['state'] == 'battle':
            bt = self.battles.get(a['battle'])
            if bt and bt['ambush'] and self.t - bt['t0'] < 0.3:
                return False, "Prise en embuscade, l'armée ne peut pas encore se dégager !"
            if bt:
                for side in bt['sides']:
                    if aid in side['armies']:
                        side['armies'].remove(aid)
                        side['men0'] -= self.army_men(a)
                for r in a['regs']:
                    r['n'] *= 0.9
                a['battle'] = None
                self.retreat(a)
                if bt and bt.get('mode') == 'attente' and not TB.involves_player(self, bt):
                    bt['mode'] = 'auto'   # (elle ne le concerne plus : la campagne ne l'attend plus)
                if bt and (not bt['sides'][0]['armies'] and bt['sides'][0]['node'] is None):
                    self.end_battle(bt, 1)
                elif bt and (not bt['sides'][1]['armies'] and bt['sides'][1]['node'] is None):
                    self.end_battle(bt, 0)
                return True, "Retraite ordonnée."
        if a['state'] == 'siege':
            self.end_siege_for(a)
        here = a['at_node']
        self.retreat(a)
        if aid not in self.armies:
            return True, "L'armée, cernée, se débande."
        if a['state'] == 'idle' and a['at_node'] == here:
            return False, "Aucune place amie libre où se replier : l'armée reste sur place."
        return True, "Retraite ordonnée."

    # ------------------------------------------------------------------ prise d'une place
    def capture(self, nid, code, peaceful=False):
        n = self.nodes[nid]
        gn = self.geo.nodes[nid]
        old = n['owner']
        if old == code:
            return
        AA.on_capture(self, nid)
        n['owner'] = code
        n['assim'] = 1.0 if code == gn['dept'] else (0.3 if peaceful else 0.0)
        n['stab'] = 0.6 if peaceful else 0.35
        n['garrison'] = []
        n['queue'] = []
        n['siege'] = None
        for b in self.armies.values():   # (ses assiégeants ne restent pas en siège devant une place qui n'en est plus)
            if b['at_node'] == nid and b['state'] == 'siege':
                b['state'] = 'move' if b['path'] else 'idle'
        if not peaceful and n['dev'] > 0 and old != R.NEUTRAL and self.rng.random() < 0.35:
            n['dev'] -= 1
            n['milice_max'] = max(20.0, n['milice_max'] - R.NODE_BASE[gn['type']]['milice'] * 0.15)
        lost = 0.0
        if not peaceful and 'pop' in n:
            # pillage : on saccage d'autant plus la ville qu'elle a résisté ; une partie des habitants s'enfuit
            # chez son ancien maître et gagne ses places sûres le mois suivant
            lost = n['pop'] * min(0.15, R.POP_SACK + R.POP_SACK_FORT * n['fort'])
            lost = max(0.0, min(lost, n['pop'] - self.pop_norm(n) * R.POP_FLOOR_SIEGE))
            n['pop'] -= lost
            if old in self.factions and self.factions[old]['alive']:
                fo = self.factions[old]
                fo['refu'] = fo.get('refu', 0.0) + lost * R.POP_REFUGE
        breached = not peaceful and self.lose_fort_level(nid)
        if n.get('depot'):
            n['depot'] = 0
            if code in self.factions:
                self.factions[code]['res']['vivres'] += 150
            if self.player in (code, old):
                self.log('eco', f"Le magasin aux vivres de {gn['name']} est pillé par {self.fname(code)}.", gn['x'], gn['y'],
                         who=code)
        n['milice'] = n['milice_max'] * (0.5 if peaceful else 0.15)
        self._dirty_income = True
        if code in self.factions:
            self.factions[code]['stats']['captured'] += 1
        if old in self.factions:
            self.factions[old]['rel'][code] = max(-100, self.factions[old]['rel'][code] - 12)
        sack = f" Pillage : {R.nb(round(lost, -1))} habitants fuient ou périssent." if lost >= 50 else ''
        if breached and (code == self.player or old == self.player):
            self.log('capture', f"{gn['name']} tombe aux mains {R.de(self.fname(code))} ; ses remparts éventrés retombent au "
                                f"niveau {n['fort']}.{sack}", gn['x'], gn['y'], who=code, important=True)
        elif not peaceful and (code == self.player or old == self.player):
            self.log('capture', f"{gn['name']} tombe aux mains {R.de(self.fname(code))}.{sack}", gn['x'], gn['y'], who=code,
                     important=True)
        elif not peaceful:
            self.log('capture', f"{gn['name']} tombe aux mains {R.de(self.fname(code))}.", gn['x'], gn['y'], who=code)
        # pénalité pour l'expansion près des voisins
        if old == R.NEUTRAL and code in self.factions:
            for o in self.factions:
                if o != code and gn['dept'] == o:
                    self.factions[o]['rel'][code] = max(-100, self.factions[o]['rel'][code] - 3)
        if gn['type'] == 'capitale' and old in self.factions and gn['dept'] == old:
            lf = self.factions[old]
            left = len(self.owned_nodes(old))
            if left <= max(3, lf['start_nodes'] * R.TREATY_CRUSHED) or self.t - lf.get('treaties', {}).get(code, -1e9) < R.TREATY_AGAIN \
                    or code not in self.factions:
                self.capitulate(old, code)
            else:
                self.treaty(old, code, nid)
        self.check_end()

    def treaty(self, loser, winner, cap):
        """Le chef-lieu est tombé : le vaincu signe la paix, cède les places que le vainqueur occupe, paie un tribut
        et récupère son chef-lieu. Il peut se relever ; une seconde défaite face au même vainqueur avant 25 ans lui sera fatale."""
        from . import diplomacy as D
        lf, wf = self.factions[loser], self.factions[winner]
        n = self.nodes[cap]
        gn = self.geo.nodes[cap]
        n['owner'] = loser
        n['assim'] = 1.0
        n['siege'] = None
        n['garrison'] = []
        n['milice'] = n['milice_max'] * 0.4
        for a in list(self.armies.values()):
            if a['at_node'] == cap and a['owner'] != loser and a['state'] != 'battle':
                self.retreat(a)   # l'occupant évacue la ville rendue
        ceded = sum(1 for x in self.nodes if x['owner'] == winner and self.geo.nodes[x['id']]['dept'] == loser)
        pay = int(max(0.0, lf['res']['livres']) * 0.4) + 150
        pay = min(pay, int(max(0.0, lf['res']['livres'])))
        lf['res']['livres'] -= pay
        wf['res']['livres'] += pay
        D.make_peace(self, winner, loser)
        until = TT.deadline(self, R.TREATY_TRUCE, winner, loser)
        lf['truce'][winner] = wf['truce'][loser] = until
        lf.setdefault('treaties', {})[winner] = self.t  # le même vainqueur n'accorde pas deux traités en 25 ans
        lf['weary'] = max(0.0, lf.get('weary', 0) - 40)
        lf['rel'][winner] = max(-100, lf['rel'][winner] - 20)
        # le congrès règle aussi les autres guerres du vaincu : sans cela, ses voisins l'achèvent en quelques semaines
        others = [o for o, f in self.factions.items() if f['alive'] and o not in (loser, winner) and self.at_war(o, loser)]
        for o in others:
            D.make_peace(self, o, loser)
            until = TT.deadline(self, R.TREATY_CONGRESS, o, loser)
            lf['truce'][o] = self.factions[o]['truce'][loser] = max(until, lf['truce'].get(o, 0))
        self._dirty_income = True
        cede = f"cède {R.pl(ceded, 'place')} à {self.fname(winner)} et lui verse" if ceded else f"verse à {self.fname(winner)}"
        self.log('capitulation', f"Traité {R.de(gn['name'])} : {self.fname(loser)} {cede} {pay} livres. Trêve de cinq ans."
                                 + (f" Le congrès rétablit aussi la paix avec {', '.join(self.fname(o) for o in others)} "
                                    f"pour deux ans." if others else ''),
                 gn['x'], gn['y'], who=winner, important=True)
        self.alert_pause(big=True)

    def uprisings(self):
        """Chaque année, un pays absorbé depuis dix ans peut se soulever et recouvrer sa liberté si son ancien
        chef-lieu, mal tenu, n'a pas oublié qui il était."""
        from . import diplomacy as D
        for code, f in self.factions.items():
            if f['alive'] or code == self.player or self.t - f.get('dead_t', self.t) < R.REVIVE_YEARS * 365:
                continue
            cap = next(n for n in self.nodes if self.geo.nodes[n['id']]['type'] == 'capitale'
                       and self.geo.nodes[n['id']]['dept'] == code)
            owner = cap['owner']
            if owner not in self.factions or cap.get('assim', 1.0) >= 0.6:
                continue
            held = {a['at_node'] for a in self.armies.values() if a['owner'] == owner and a['at_node'] is not None}
            ow = self.factions[owner]
            if cap['id'] in held or cap['garrison'] or cap['siege'] \
                    or self.rng.random() > 0.25 + ow.get('weary', 0) / 200:
                continue
            freed = []
            for n in self.nodes:
                if self.geo.nodes[n['id']]['dept'] != code or n['owner'] in (code, R.NEUTRAL) or n.get('assim', 1.0) >= 0.6:
                    continue
                if n['id'] != cap['id'] and (n['id'] in held or n['garrison'] or n['siege']):
                    continue
                o = n['owner']
                n.update(owner=code, assim=1.0, stab=0.8, queue=[], depot=0, milice=n['milice_max'] * 0.6)
                freed.append((o, n))
            f.update(alive=True, overlord=None, trade={}, war_since={}, prisoners={}, weary=0.0, treaties={},
                     last_war=self.t, res=dict(livres=400, vivres=400, fer=60, bois=100, armes=150, outils=30, recrues=800))
            for o, of in self.factions.items():
                if o != code:
                    self.set_status(code, o, 'paix')
                    f['rel'][o] = 0
            until = TT.deadline(self, 36, code, *{o for o, _ in freed})   # (trois ans) l'ancien maître, épuisé, laisse faire... pour un temps
            for o in {o for o, _ in freed}:
                f['truce'][o] = self.factions[o]['truce'][code] = until
                f['rel'][o] = self.factions[o]['rel'][code] = -40
            self._dirty_income = True
            gn = self.geo.nodes[cap['id']]
            self.log('revolte', f"Soulèvement {R.de(gn['name'])} : {self.fname(code)} recouvre sa liberté et chasse "
                                f"{self.fname(owner)} de {R.pl(len(freed), 'place')}. Trêve de trois ans.",
                     gn['x'], gn['y'], who=code, important=True)
            if owner == self.player:
                self.alert_pause(big=True)

    def capitulate(self, loser, winner):
        lf = self.factions[loser]
        if not lf['alive']:
            return
        lf['alive'] = False
        lf['dead_t'] = self.t
        lf['prisoners'] = {}
        for f in self.factions.values():
            f.get('prisoners', {}).pop(loser, None)
        for n in self.nodes:
            if n['owner'] == loser:
                n['owner'] = winner
                if self.geo.nodes[n['id']]['dept'] != winner:
                    n['assim'] = 0.0   # le pays absorbé garde le souvenir de sa liberté
                n['stab'] = 0.4
                n['milice'] = n['milice_max'] * 0.2
                n['garrison'] = []
                n['queue'] = []
                n['siege'] = None
        for aid in [a['id'] for a in self.armies.values() if a['owner'] == loser]:
            a = self.armies.pop(aid)
            if a['battle'] and a['battle'] in self.battles:
                for s in self.battles[a['battle']]['sides']:
                    if aid in s['armies']:
                        s['armies'].remove(aid)
        for o, f in self.factions.items():
            f['trade'].pop(loser, None)
            if f['overlord'] == loser:
                f['overlord'] = None
        lf['trade'] = {}
        for o in self.factions:
            if o != loser:
                self.set_status(loser, o, 'paix')
        self._dirty_income = True
        self.alert_pause(big=True)
        self.log('capitulation', f"{self.fname(loser)} capitule ! Ses villes passent à {self.fname(winner)}.",
                 who=winner, important=True)

    def check_era(self, d):
        if not getattr(self, 'era_id', None):
            self.era_id = self.era()['id']
        if d == datetime.date(*R.DEPT_DATE) and self.t > 0.5:
            self.log('info', "4 mars 1790 : l'Assemblée crée les départements. Les provinces deviennent la Gironde, "
                             "la Dordogne, les Landes, le Lot-et-Garonne et les Basses-Pyrénées.", important=True)
            self.alert_pause(big=True)
        e = self.era()
        if e['id'] != self.era_id:
            self.era_id = e['id']
            self.log('epoque', f"Nouvelle époque : {e['name']}. {e['desc']}", important=True)
            self.alert_pause(big=True)
        if d >= datetime.date(*R.CAMPAIGN_END) and not self.over:
            self.end_campaign()

    def prestige_parts(self, code):
        """Rayonnement actuel d'un camp, par rubrique : la paix et le développement comptent autant que la guerre."""
        f = self.factions[code]
        if not f['alive']:
            return dict(territoire=0, population=0, richesse=0, villes=0, savoir=0, armes=0, histoire=0)
        mine = self.owned_nodes(code)
        caps = sum(1 for n in mine if self.geo.nodes[n['id']]['type'] == 'capitale')
        return dict(
            territoire=len(mine) * 3 + caps * 25,
            population=sum(min(n.get('pop', 0), 25000) for n in mine) / 4000,   # une métropole ne fait pas tout
            richesse=min(40.0, max(0.0, f['res']['livres']) / 1500) + max(0.0, f['income'].get('livres', 0)) * 0.25,
            villes=sum(n['dev'] for n in mine) * 4 + sum(n['fort'] for n in mine) * 2 + CT.prestige(mine),
            savoir=len(f['techs']) * 3,
            armes=f['stats']['won'] * 2 + f['stats']['captured'] * 0.5,
            histoire=f.get('glory', 0.0))

    def prestige_now(self, code):
        return sum(self.prestige_parts(code).values())

    def prestige(self, code):
        """Prestige total : la gloire accumulée année après année, plus le rayonnement présent."""
        f = self.factions[code]
        return int(f.get('prestige', 0.0) + self.prestige_now(code)) if f['alive'] else 0

    def end_campaign(self):
        ranks = sorted(self.factions, key=lambda c: -self.prestige(c))
        first = ranks[0]
        win = first == self.player or self.factions[first]['overlord'] == self.player
        self.over = dict(result='victoire' if win else 'defaite', t=self.t,
                         text=("Le siècle s'achève : votre " + self.dept_word() + " est le plus prestigieux d'Aquitaine."
                               if win else f"Le siècle s'achève : {self.fname(first)} est le plus prestigieux d'Aquitaine."))
        self.speed_idx = 0
        self.log('fin', self.over['text'], important=True)

    def check_end(self):
        if self.over:
            return
        p = self.player
        if not self.factions[p]['alive'] or self.nodes[self.capital_of(p)]['owner'] != p:
            self.over = dict(result='defaite', t=self.t,
                             text=f"Votre {self.dept_word()} a été {'rayé' if self.departements() else 'rayée'} de la carte : la partie est perdue.")
            self.speed_idx = 0
            self.log('fin', self.over['text'], important=True)
            return
        ok = True
        for code in R.FACTIONS:
            cap = self.capital_of(code)
            o = self.nodes[cap]['owner']
            if o == p or (o in self.factions and self.factions[o]['overlord'] == p):
                continue
            ok = False
        if ok:
            years = self.t / 365.25
            self.over = dict(result='victoire', t=self.t,
                             text=f"Toute l'Aquitaine reconnaît votre autorité ({years:.1f} ans de campagne).")
            self.speed_idx = 0
            self.log('fin', self.over['text'], important=True)

    # ------------------------------------------------------------------ usure, ravitaillement
    def depot_near(self, a, depots=None):
        """Magasin aux vivres (à soi ou à un allié) assez proche pour ravitailler l'armée, sinon None.
        depots : les places à magasin hors siège, déjà relevées (même ordre que self.nodes)."""
        best, bd = None, R.DEPOT_KM ** 2
        for n in (self.nodes if depots is None else depots):
            if n.get('depot') and not n['siege'] and self.friendly(a['owner'], n['owner']):
                x, y = self.node_xy(n['id'])
                d = (x - a['x']) ** 2 + (y - a['y']) ** 2
                if d <= bd:
                    best, bd = n['id'], d
        return best

    def attrition(self, dt):
        season = self.season()
        depots = None   # places à magasin hors siège : relevées une fois, si une armée en cherche un
        for a in list(self.armies.values()):
            code = a['owner']
            f = self.factions[code]
            nd = self.geo.node_of_cell(a['x'], a['y'])
            friendly_land = nd is not None and (self.nodes[nd]['owner'] == code or self.friendly(code, self.nodes[nd]['owner']))
            if a.get('boat'):
                friendly_land = True  # les gabares emportent leurs vivres
            logi = self.gen_trait(a) == 'logisticien'
            a['depot'] = None
            if not friendly_land and f['res']['vivres'] > 1:
                if depots is None:
                    depots = [n for n in self.nodes if n.get('depot') and not n['siege']]
                dep = self.depot_near(a, depots)
                if dep is not None:
                    # les charrois du magasin suivent l'armée : ravitaillée, mais aux frais du grenier
                    a['depot'] = dep
                    f['res']['vivres'] = max(0.0, f['res']['vivres'] - self.army_men(a) / 100 * R.DEPOT_FOOD * dt)
            if friendly_land:
                a['supply'] = min(1.0, a['supply'] + 0.3 * dt)
            elif a['depot'] is not None:
                a['supply'] = min(1.0, a['supply'] + 0.15 * dt)
            else:
                k = 1.8 if season == 'hiver' else (0.6 if season in ('été', 'automne') else 1.0)
                near = R.RAIL_STATION_DRAIN if RL.near_station(self, code, a['x'], a['y']) else 0.0   # une gare proche
                a['supply'] = max(0.0, a['supply'] - 0.035 * k * dt * (0.5 if logi else 1.0)
                                  * max(0.2, 1 + self.mod(code, 'supply_drain') + near))
            rate = 0.0
            if not a['onroad'] and a['at_node'] is None:
                ter = self.geo.terrain_at(a['x'], a['y'])
                tname = TERRAIN[ter][0]
                base = {'Marais': 0.006, 'Montagne': 0.004, 'Haute montagne': 0.012, 'Forêt': 0.0015,
                        'Lande': 0.002, 'Dunes': 0.002}.get(tname, 0.0005)
                if tname in ('Marais', 'Lande'):
                    base *= max(0.0, 1 + self.mod(code, 'marsh_attr'))
                if season == 'hiver':
                    base *= 3 if tname in ('Montagne', 'Haute montagne') else 1.6
                if tname in ('Montagne', 'Haute montagne', 'Collines'):
                    men = sum(r['n'] for r in a['regs']) or 1.0
                    share = sum(r['n'] for r in a['regs'] if r['type'] == 'chasseurs') / men
                    base *= 1 - 0.7 * share   # les montagnards connaissent les cols
                if season == 'été' and tname == 'Marais':
                    base *= 1.5
                rate += base
            unpaid = bool(f.get('banqueroute'))
            hungry = bool(f.get('famine')) or a['supply'] < 0.35
            if unpaid or hungry:
                a['des_why'] = ('solde impayée' if unpaid else 'disette dans le pays' if f.get('famine')
                                else 'ravitaillement épuisé')
            if a['supply'] < 0.35:
                rate += 0.012
            if f.get('famine'):
                rate += 0.012
            if self.weather[self.zone_of(a['x'], a['y'])]['kind'] == 'canicule' and a['state'] == 'move':
                rate += 0.002
            rate *= max(0.2, 1 + self.mod(code, 'attrition')) * (0.6 if logi else 1.0)
            # moral et désertions : une armée mal payée ou affamée fond
            if unpaid or hungry:
                for r in a['regs']:
                    r['morale'] = max(5, r['morale'] - (2.5 * unpaid + 2.5 * hungry) * dt)
            men = sum(r['n'] for r in a['regs'])
            if men > 0 and a['state'] != 'battle':
                mor = sum(r['n'] * r['morale'] for r in a['regs']) / men
                drate = max(0.0, (45 - mor) / 45) * 0.014 + (0.003 if unpaid else 0.0)
                if drate > 0:
                    gone = 0.0
                    for r in a['regs']:
                        g_ = r['n'] * drate * dt
                        r['n'] -= g_
                        gone += g_
                    a['des'] = a.get('des', 0.0) + gone
            if rate > 0:
                for r in a['regs']:
                    r['n'] -= r['n'] * rate * dt
            self.prune(a)
            if a['state'] == 'idle' and not (unpaid or hungry):
                if friendly_land:
                    top = 100 + self.mod(code, 'morale')
                    for r in a['regs']:
                        r['morale'] = min(top, r['morale'] + 5 * dt)
                    if a['at_node'] is not None and self.geo.nodes[a['at_node']]['type'] != 'village':
                        self.replenish(code, a['regs'], dt, R.REPL_ARMY)
                else:
                    for r in a['regs']:
                        r['morale'] = max(r['morale'], min(90, r['morale'] + 1.5 * dt))
            if not a['regs']:
                if a['battle'] and a['battle'] in self.battles:
                    for s in self.battles[a['battle']]['sides']:
                        if a['id'] in s['armies']:
                            s['armies'].remove(a['id'])
                del self.armies[a['id']]
        TB.campaign_tick(self, dt)   # munitions recomplétées, fatigue de la marche et du repos
        # sièges : les assiégeants s'usent aussi
        if not self.factions[self.player]['alive']:
            self.check_end()

    # ------------------------------------------------------------------ fleuves : feu des berges, blocus
    def river_fire(self, dt):
        """Les gabares qui passent à portée de canons ennemis (armées ou forts riverains) essuient des pertes."""
        forts = None   # places à remparts (rien ne les change pendant ce pas) : relevées s'il y a des gabares en route
        for b in list(self.armies.values()):
            if not b.get('boat') or b['at_node'] is not None or not b['edge'] or not b['regs']:
                continue
            e = self.geo.edges[b['edge']['e']]
            if e.get('kind') != 'water' or e.get('sea'):
                continue
            fire, who = 0.0, None
            r2 = R.RIVER_FIRE_KM ** 2
            for x in self.armies.values():
                if x is b or x.get('boat') or x['state'] == 'battle':
                    continue
                if (x['x'] - b['x']) ** 2 + (x['y'] - b['y']) ** 2 > r2 or not self.at_war(x['owner'], b['owner']):
                    continue
                f = sum(1.0 if r['type'] == 'artillerie' else (0.15 if self.arm_class(r['type']) == 'inf' else 0) for r in x['regs'])
                if f:
                    fire += f
                    who = x['owner']
            rn2 = (R.RIVER_FIRE_KM + 0.5) ** 2
            if forts is None:
                forts = [(n,) + self.node_xy(n['id']) for n in self.nodes if n['fort'] >= 1]
            for n, nx, ny in forts:
                if (nx - b['x']) ** 2 + (ny - b['y']) ** 2 <= rn2 and n['owner'] in self.factions \
                        and self.at_war(n['owner'], b['owner']):
                    fire += n['fort']
                    who = n['owner']
            if not fire:
                b['_fire'] = False
                continue
            rate = min(0.4, 0.12 * fire)
            for r in b['regs']:
                r['n'] -= r['n'] * rate * dt
                r['morale'] = max(10, r['morale'] - 8 * dt)
            b['regs'] = [r for r in b['regs'] if r['n'] >= 5]
            if not b.get('_fire'):
                b['_fire'] = True
                where = self.place_name(b['x'], b['y'])
                if b['owner'] == self.player:
                    self.log('battle', f"Les gabares de la {b['name']} essuient le feu de {self.fname(who)} {where} !",
                             b['x'], b['y'], who=who, important=True)
                elif who == self.player:
                    self.log('battle', f"Vos canons prennent pour cible les gabares de {self.fname(b['owner'])} {where}.",
                             b['x'], b['y'], who=who)
            if not b['regs']:
                del self.armies[b['id']]
                if b['owner'] == self.player:
                    self.log('battle_end', f"La {b['name']} a sombré sous le feu ennemi.", b['x'], b['y'], important=True)

    def compute_blockades(self):
        """Un port ou un quai est bloqué si une place en aval, sur la route de la mer, est tenue par un ennemi."""
        out = set()
        for nid, down in self.geo.down_nodes.items():
            o = self.nodes[nid]['owner']
            if o not in self.factions:
                continue
            for d in down:
                od = self.nodes[d]['owner']
                if od in self.factions and self.at_war(o, od):
                    out.add(nid)
                    break
        old = getattr(self, '_blockade', set())
        cut = [self.geo.nodes[n] for n in sorted(out - old) if self.nodes[n]['owner'] == self.player]
        freed = [self.geo.nodes[n] for n in sorted(old - out) if self.nodes[n]['owner'] == self.player]
        names = lambda gs: ', '.join(g['name'] for g in gs[:4]) + (f" et {len(gs) - 4} autres" if len(gs) > 4 else '')
        if cut:
            self.log('eco', f"Blocus : l'ennemi en aval coupe le commerce fluvial {R.de(names(cut))}.",
                     cut[0]['x'], cut[0]['y'], important=True)
        if freed:
            self.log('eco', f"Blocus levé pour {names(freed)} : les gabares descendent de nouveau vers la mer.",
                     freed[0]['x'], freed[0]['y'])
        self._blockade = out

    # ------------------------------------------------------------------ espions
    def spy(self, code, nid, kind):
        if kind not in R.SPY:
            return False, "Mission inconnue."
        n = self.nodes[nid]
        gn = self.geo.nodes[nid]
        o = n['owner']
        if o == code:
            return False, "Cette place vous appartient déjà."
        if kind == 'saboter':
            if o == R.NEUTRAL or not self.at_war(code, o):
                return False, "Le sabotage n'est possible que contre un camp avec lequel vous êtes en guerre."
            if n['fort'] <= 0:
                return False, "Cette place n'a pas de remparts à saboter."
        if any(s['by'] == code and s['node'] == nid for s in self.spies):
            return False, "Un de vos agents est déjà en route pour cette place."
        cost = R.SPY[kind]['cost']
        f = self.factions[code]
        if f['res']['livres'] < cost:
            return False, "Livres insuffisantes."
        f['res']['livres'] -= cost
        # rapport au tour suivant (une IA : en trois jours, comme avant)
        self.spies.append(dict(by=code, node=nid, kind=kind, done=TT.deadline(self, 1) if code == self.player else self.t + 3.0))
        return True, f"Un agent part pour {gn['name']} : son rapport au prochain tour."

    def update_spies(self):
        if not self.spies:
            return
        due = [s for s in self.spies if s['done'] <= self.t]
        if not due:
            return
        self.spies = [s for s in self.spies if s['done'] > self.t]
        for s in due:
            self.resolve_spy(s)

    def resolve_spy(self, s):
        code, nid, kind = s['by'], s['node'], s['kind']
        f = self.factions.get(code)
        if not f or not f['alive']:
            return
        n = self.nodes[nid]
        gn = self.geo.nodes[nid]
        o = n['owner']
        if o == code:
            return
        chance = R.SPY[kind]['chance'] + (0.1 if 'diplomates' in f['techs'] else 0)
        if o in self.factions and 'chappe' in self.factions[o]['techs']:
            chance -= 0.15
        if kind == 'saboter' and (o == R.NEUTRAL or not self.at_war(code, o) or n['fort'] <= 0):
            if code == self.player:
                self.log('espion', f"Mission annulée à {gn['name']} : la situation a changé.", gn['x'], gn['y'])
            f['res']['livres'] += R.SPY[kind]['cost'] * 0.5
            return
        if self.rng.random() < chance:
            if kind == 'espionner':
                f.setdefault('intel', {})[str(nid)] = TT.deadline(self, R.SPY_INTEL_TOURS, code)
                if code == self.player:
                    gm = sum(r['n'] for r in n['garrison'])
                    near = [a for a in self.armies.values() if a['owner'] == o and math.hypot(a['x'] - gn['x'], a['y'] - gn['y']) < 14]
                    self.log('espion', f"Rapport d'espion sur {gn['name']} : milice {int(n['milice'])}, garnison {int(gm)}, "
                                       f"remparts niveau {n['fort']}, {len(near)} armée(s) aux environs.",
                             gn['x'], gn['y'], who=o, important=True)
            else:
                n['fort'] = max(0, n['fort'] - 1)
                n['milice_max'] = max(R.NODE_BASE[gn['type']]['milice'], n['milice_max'] - 40)
                n['milice'] = min(n['milice'], n['milice_max'])
                if code == self.player:
                    self.log('espion', f"Sabotage réussi : une brèche s'ouvre dans les remparts de {gn['name']}.",
                             gn['x'], gn['y'], who=code, important=True)
                if o == self.player:
                    self.log('espion', f"Des saboteurs ont endommagé les remparts de {gn['name']} !", gn['x'], gn['y'],
                             who=code, important=True)
        else:
            pen = 10 if kind == 'espionner' else 20
            if o in self.factions:
                self.factions[o]['rel'][code] = max(-100, self.factions[o]['rel'][code] - pen)
            if code == self.player:
                self.log('espion', f"Votre agent a été démasqué à {gn['name']}." +
                         (f" {self.fname(o)} s'en offusque." if o in self.factions else ''), gn['x'], gn['y'],
                         who=o, important=True)
            if o == self.player:
                self.log('espion', f"Un espion de {self.fname(code)} a été arrêté à {gn['name']}.", gn['x'], gn['y'],
                         who=code, important=True)

    def intel_active(self, code, nid):
        f = self.factions.get(code)
        return bool(f) and f.get('intel', {}).get(str(nid), -1) > self.t

    # ------------------------------------------------------------------ impôts et ordre public
    def set_tax(self, code, v):
        v = float(v)
        if not math.isfinite(v):
            return False, "Niveau d'impôts invalide."
        f = self.factions[code]
        f['tax'] = max(0.0, min(1.0, round(v, 2)))
        self._dirty_income = True
        return True, f"Impôts : {R.tax_label(f['tax']).lower()}."

    def stab_targets(self):
        """Stabilité vers laquelle tend chaque place d'un département."""
        out = {}
        for code, f in self.factions.items():
            if not f['alive']:
                continue
            tax = f.get('tax', 0.5)
            t = 1.0 - max(0.0, tax - 0.5) * 1.2 * max(0.0, 1 + self.mod(code, 'tax_unrest')) + self.mod(code, 'order')
            if f.get('famine'):
                t -= 0.3
            if f.get('banqueroute'):
                t -= 0.2
            out[code] = t
        return out

    # ================================================================== ordres du joueur
    def form_army(self, code, nid, reg_ids, into=None):
        n = self.nodes[nid]
        if n['owner'] != code:
            return False, "Garnison introuvable."
        if not isinstance(reg_ids, (list, tuple)):
            return False, "Choisissez au moins un régiment."
        regs = [r for r in n['garrison'] if r['id'] in reg_ids]
        if regs and all(R.UNITS[r['type']]['garrison_only'] for r in regs):
            return False, "La Garde nationale ne quitte pas sa ville."
        regs = [r for r in regs if not R.UNITS[r['type']]['garrison_only']]
        reg_ids = [r['id'] for r in regs]
        if not regs:
            return False, "Choisissez au moins un régiment."
        if into:
            a = self.armies.get(into)
            if not a or a['owner'] != code or a['at_node'] != nid or a['state'] not in ('idle',) or a.get('boat'):
                return False, "L'armée doit être sur place et au repos."
            a['regs'] += regs
        else:
            gx, gy = self.node_xy(nid)
            a = self.create_army(code, gx, gy, regs, node=nid)
        n['garrison'] = [r for r in n['garrison'] if r['id'] not in reg_ids]
        return True, a['id']

    def enroll(self, code, frm):
        """Enrôle les prisonniers d'une origine : une partie seulement accepte de servir, leur département s'en fâche."""
        f = self.factions[code]
        n = int(f.setdefault('prisoners', {}).get(frm, 0))
        if n <= 0:
            return False, "Aucun prisonnier de cette origine."
        gain = int(self.add_recrues(code, int(n * 0.6)))
        del f['prisoners'][frm]
        if frm in self.factions:
            self.factions[frm]['rel'][code] = max(-100, self.factions[frm]['rel'][code] - 8)
        if code == self.player:
            self.log('armee', f"{gain} prisonniers ({self.fname(frm)}) acceptent de servir sous vos drapeaux ; "
                              f"les autres sont renvoyés.", who=code)
        return True, f"{gain} prisonniers enrôlés comme recrues."

    def to_garrison(self, code, aid):
        a = self.armies.get(aid)
        if not a or a['owner'] != code:
            return False, "Armée introuvable."
        if a['at_node'] is None or self.nodes[a['at_node']]['owner'] != code or a['state'] != 'idle':
            return False, "L'armée doit être au repos dans une de vos villes."
        self.nodes[a['at_node']]['garrison'] += a['regs']
        del self.armies[aid]
        return True, ("Régiments placés en garnison. Pour les en sortir : panneau de la ville, section Garnison, "
                      "« Sortir de la garnison ».")

    def split(self, code, aid, reg_ids):
        a = self.armies.get(aid)
        if not a or a['owner'] != code or a['state'] in ('battle',):
            return False, "Impossible de scinder cette armée maintenant."
        if a.get('boat') and a['at_node'] is None:
            return False, "Impossible de scinder une armée embarquée : attendez qu'elle accoste."
        if not isinstance(reg_ids, (list, tuple)):
            return False, "Choisissez une partie des régiments."
        regs = [r for r in a['regs'] if r['id'] in reg_ids]
        if not regs or len(regs) == len(a['regs']):
            return False, "Choisissez une partie des régiments."
        a['regs'] = [r for r in a['regs'] if r['id'] not in reg_ids]
        b = self.create_army(code, a['x'], a['y'], regs, node=a['at_node'])
        b['onroad'] = a['onroad']
        b['edge'] = dict(a['edge']) if a['edge'] else None
        b['fm'], b['pl'], b['tac_auto'], b['stance'] = a.get('fm', 'ligne'), a.get('pl', 'frontal'), a.get('tac_auto', True), \
            a['stance']
        b['supply'] = a['supply']
        b['mp'] = a.get('mp')
        b['rx'] = a.get('rx', True)
        b['hold'] = a.get('hold', False)   # (détachée d'une armée en halte devant une place : en halte aussi)
        if a['state'] == 'siege':
            b['state'] = 'siege'
        return True, b['id']

    def split_by_type(self, code, aid, kind):
        """Détache d'un coup toute la cavalerie, l'infanterie ou l'artillerie d'une armée."""
        a = self.armies.get(aid)
        if not a or a['owner'] != code:
            return False, "Armée introuvable."
        ids = [r['id'] for r in a['regs'] if self.arm_class(r['type']) == kind]
        if not ids:
            return False, "Aucun régiment de ce type dans l'armée."
        ok, res = self.split(code, aid, ids)
        if ok:
            b = self.armies[res]
            base = a['name'].split(' de la ', 1)[1] if ' de la ' in a['name'] else a['name']
            b['name'] = {'cavalerie': 'Cavalerie', 'artillerie': 'Batterie', 'inf': 'Infanterie'}[kind] + f" de la {base}"
            self.factions[code]['army_count'] -= 1
            if kind == 'cavalerie' and self.gen_trait(b) != 'cavalier' and self.rng.random() < 0.5:
                b['gen']['trait'] = 'cavalier'
        return ok, res

    def merge(self, code, aid, bid):
        a, b = self.armies.get(aid), self.armies.get(bid)
        if not a or not b or a['owner'] != code or b['owner'] != code or a is b:
            return False, "Armées introuvables."
        if math.hypot(a['x'] - b['x'], a['y'] - b['y']) > 3 or 'battle' in (a['state'], b['state']):
            return False, "Les armées doivent être côte à côte et hors combat."
        if b.get('boat') or a.get('boat'):
            return False, "Impossible de réunir des armées embarquées."
        a['regs'] += b['regs']
        ga, gb = a.get('gen'), b.get('gen')
        if gb and (not ga or (gb['lvl'], gb['xp']) > (ga['lvl'], ga['xp'])):
            a['gen'] = gb
        a['supply'] = min(a['supply'], b['supply'])
        if a.get('mp') is not None or b.get('mp') is not None:
            full = TT.march_days(self)
            a['mp'] = min(full if a.get('mp') is None else a['mp'], full if b.get('mp') is None else b['mp'])
        del self.armies[bid]
        if not a.get('gen'):
            return True, "Armées réunies."
        t = self.gen_title(a['gen'])
        return True, f"Armées réunies sous le commandement du {t[0].lower() + t[1:]}."

    def set_formation(self, code, aid, fm):
        a = self.armies.get(aid)
        if not a or a['owner'] != code:
            return False, "Armée introuvable."
        if fm not in R.FORMATIONS:
            return False, "Formation inconnue."
        if a.get('fm') == fm:
            a['tac_auto'] = False
            return True, f"Déjà en {R.FORMATIONS[fm]['label'].lower()}."
        a['fm'] = fm
        a['tac_auto'] = False
        if a['state'] == 'battle':
            a['fm_t'] = self.t
            return True, f"Les régiments se forment en {R.FORMATIONS[fm]['label'].lower()} (réorganisation de quelques heures)."
        return True, f"Formation : {R.FORMATIONS[fm]['label'].lower()}."

    def set_plan(self, code, aid, pl):
        a = self.armies.get(aid)
        if not a or a['owner'] != code:
            return False, "Armée introuvable."
        if pl == 'auto':
            a['tac_auto'] = True
            bt = self.battles.get(a['battle']) if a['state'] == 'battle' else None
            if bt:
                si = 0 if aid in bt['sides'][0]['armies'] else 1
                self.choose_tactics(a, bt, si)
            return True, "Le général choisira la formation et le plan selon l'ennemi."
        if pl not in R.PLANS:
            return False, "Plan inconnu."
        a['pl'] = pl
        a['tac_auto'] = False
        return True, f"Plan de bataille : {R.PLANS[pl]['label'].lower()}."

    def set_stance(self, code, aid, stance):
        a = self.armies.get(aid)
        if not a or a['owner'] != code:
            return False, "Armée introuvable."
        if stance not in ('normal', 'embuscade', 'retranche'):
            return False, "Posture inconnue."
        if stance == 'embuscade' and (a['onroad'] or a['at_node'] is not None):
            return False, "Une embuscade se tend hors des routes : marchez à travers champs vers un bois, une lande ou un marais."
        if stance == 'embuscade' and not TERRAIN[self.geo.terrain_at(a['x'], a['y'])][2]:
            return False, "Il faut un couvert (forêt, lande, marais, montagne) pour tendre une embuscade."
        if a['state'] == 'move':
            a['path'] = []
            a['state'] = 'idle'
        a['stance'] = stance
        return True, {'normal': 'Posture normale.', 'embuscade': 'Embuscade tendue : restez invisibles et attendez.',
                      'retranche': 'Les troupes se retranchent (+20 % en défense).'}[stance]

    def assault(self, code, aid):
        a = self.armies.get(aid)
        if not a or a['owner'] != code or a['state'] != 'siege':
            return False, "Cette armée n'assiège rien."
        a['assault'] = True
        if self.tour['on'] and self.tour['end'] is None:
            self.update_sieges(0.0)   # tour par tour : l'assaut se livre tout de suite
        return True, "Assaut ordonné !"

    def set_slider(self, code, v):
        v = float(v)
        if not math.isfinite(v):
            return False, "Réglage invalide."
        self.factions[code]['slider'] = max(0.0, min(1.0, v))
        self._dirty_income = True
        return True, "Production ajustée."

    def market_trade(self, code, res, qty, side):
        if res not in self.market:
            return False, "Ressource non négociable."
        if side not in ('buy', 'sell'):
            return False, "Opération inconnue."
        qty = float(qty)
        if not math.isfinite(qty):
            return False, "Quantité invalide."
        if qty < 1:
            return False, "Indiquez une quantité."
        qty = min(1000, int(qty))
        has_port = any('port' in self.geo.nodes[n['id']]['spec'] for n in self.owned_nodes(code))
        spread = (1.15, 0.85) if has_port else (1.4, 0.6)
        m = self.mod(code, 'market')
        spread = (max(1.02, spread[0] - m), min(0.98, spread[1] + m))
        p = self.market[res]
        r = self.factions[code]['res']
        if side == 'buy':
            if res == 'recrues':
                room = int(self.recruit_cap(code) - r['recrues'])
                if room <= 0:
                    return False, "Vos casernes sont pleines : aucune recrue de plus ne peut être accueillie."
                qty = min(qty, room)
            cost = qty * p * (1 + 0.0002 * qty) * spread[0]
            if r['livres'] < cost:
                return False, "Livres insuffisantes."
            r['livres'] -= cost
            r[res] += qty
            self.market[res] = round(p * (1 + 0.0004 * qty), 3)
            return True, f"Acheté {qty} {R.RES_LABEL[res].lower()} pour {int(cost)} livres."
        if r[res] < qty:
            return False, "Stock insuffisant."
        gain = qty * p * (1 - 0.0002 * qty) * spread[1]
        r[res] -= qty
        r['livres'] += gain
        self.market[res] = round(max(0.05, p * (1 - 0.0004 * qty)), 3)
        return True, f"Vendu {qty} {R.RES_LABEL[res].lower()} pour {int(gain)} livres."
