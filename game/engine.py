"""Moteur de simulation de Conquête, campagne Aquitaine 1790 (temps réel, piloté par le serveur)."""
import datetime
import heapq
import math
import random

from . import rules as R
from .geo import TERRAIN, T_LANDE, T_MARAIS, T_PLAINE

SUBSTEP = 0.05  # jours
CONTACT_KM = 2.6
AMBUSH_KM = 5.0
BASE_DETECT = 2.5
START_DATE = datetime.date(1790, 3, 4)


def ordinal(n):
    return '1re' if n == 1 else f'{n}e'


class Game:
    # ================================================================== création
    def __init__(self, geo, player, difficulty='normal', seed=None):
        self.geo = geo
        self.player = player
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
        self.over = None
        self.flood_until = -1
        self.diplo = {}
        self.market = {r: p for r, p in dict(vivres=0.6, fer=2.0, bois=1.0, armes=3.5, outils=3.0, recrues=0.5).items()}
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
                start_nodes=0, alerts={})
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
                                   stab=1.0, garrison=[], queue=[], siege=None, last_seen={}))
            if owner != R.NEUTRAL:
                self.factions[owner]['start_nodes'] += 1
        for code in R.FACTIONS:
            cap = self.capital_of(code)
            self.nodes[cap]['garrison'] = [self.new_reg('ligne'), self.new_reg('ligne'), self.new_reg('cavalerie')]
            gx, gy = geo.nodes[cap]['x'], geo.nodes[cap]['y']
            self.create_army(code, gx, gy, [self.new_reg('ligne'), self.new_reg('legere'), self.new_reg('cavalerie')], node=cap)
            self.recompute_mods(code)
        self.log('info', f"4 mars 1790 : l'Assemblée crée les départements. Vous gouvernez {R.FACTIONS[player]['name']}.",
                 important=True)
        self.log('info', "Objectif : prendre tous les chefs-lieux (ou obtenir la soumission de leurs départements).")
        from .ai import AI
        self.ais = {c: AI(self, c) for c in R.FACTIONS if c != player}
        self.compute_income()

    # ================================================================== utilitaires
    def nid(self, prefix):
        self.uid += 1
        return f'{prefix}{self.uid}'

    def new_reg(self, typ, n=None):
        u = R.UNITS[typ]
        return dict(id=self.nid('r'), type=typ, n=float(u['men'] if n is None else n), max=u['men'], xp=0.0, morale=80.0)

    def capital_of(self, code):
        for n in self.geo.nodes:
            if n['dept'] == code and n['type'] == 'capitale':
                return n['id']

    def date(self):
        return START_DATE + datetime.timedelta(days=int(self.t))

    def date_str(self, t=None):
        d = START_DATE + datetime.timedelta(days=int(self.t if t is None else t))
        return f"{d.day if d.day > 1 else '1er'} {R.MONTHS[d.month - 1]} {d.year}"

    def season(self):
        return R.SEASONS[self.date().month - 1]

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

    def at_war(self, a, b):
        return self.status(a, b) == 'guerre'

    def friendly(self, a, b):
        return a == b or self.status(a, b) == 'alliance'

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
        if code != self.player:
            d = R.DIFFICULTY[self.difficulty]
            m['ai_income'] = d['ai_income'] - 1
        f['mods'] = m
        self._dirty_income = True

    # ================================================================== boucle
    def advance(self, real_dt):
        if self.over or self.speed_idx == 0:
            return
        days = R.SPEEDS[self.speed_idx] * real_dt
        while days > 1e-9 and not self.over:
            dt = min(SUBSTEP, days)
            self.step(dt)
            days -= dt

    def step(self, dt):
        self.t += dt
        day = int(self.t)
        if day != self._last_day:
            self._last_day = day
            self.new_day()
        if self._dirty_income:
            self.compute_income()
        self.economy(dt)
        self.update_queues(dt)
        self.move_armies(dt)
        self.update_hidden()
        self.detect_contacts()
        self.update_sieges(dt)
        self.update_battles(dt)
        self.attrition(dt)
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
        if d.day == 1:
            self.monthly(d)
        for f in self.factions.values():
            if not f['alive']:
                continue
            for o in list(f['truce']):
                if f['truce'][o] < self.t:
                    del f['truce'][o]
        # propositions expirées
        self.proposals = [p for p in self.proposals if p['expires'] > self.t]
        # prix du marché
        for r in self.market:
            base = dict(vivres=0.6, fer=2.0, bois=1.0, armes=3.5, outils=3.0, recrues=0.5)[r]
            if r == 'vivres':
                base *= {'hiver': 1.5, 'printemps': 1.1, 'été': 0.85, 'automne': 0.8}[season]
            p = self.market[r] * (1 + self.rng.uniform(-0.04, 0.04))
            self.market[r] = round(max(base * 0.6, min(base * 1.6, p * 0.9 + base * 0.1)), 3)

    def monthly(self, d):
        season = self.season()
        for code, f in self.factions.items():
            if not f['alive']:
                continue
            mine = self.owned_nodes(code)
            if d.month in (9, 10):
                vin = sum(1 for n in mine if 'vin' in self.geo.nodes[n['id']]['spec'])
                if vin:
                    gain = 18 * vin * (1 + self.mod(code, 'vin'))
                    f['res']['livres'] += gain
                    if code == self.player:
                        self.log('eco', f"Vendanges : vos {vin} vignobles rapportent {int(gain)} livres.", important=True)
            if season == 'été' and self.rng.random() < 0.10:
                loss = f['res']['vivres'] * 0.12
                f['res']['vivres'] -= loss
                if code == self.player:
                    self.log('meteo', f"Orage de grêle : {int(loss)} vivres perdus dans les champs.", important=True)
            for n in mine:
                if n['stab'] < 0.5 and not n['garrison'] and n['milice'] < n['milice_max'] * 0.4 \
                        and self.geo.nodes[n['id']]['type'] != 'capitale' and self.rng.random() < 0.06:
                    gn = self.geo.nodes[n['id']]
                    n['owner'] = R.NEUTRAL
                    n['milice'] = n['milice_max'] * 0.5
                    self._dirty_income = True
                    self.log('revolte', f"Révolte à {gn['name']} : la ville chasse l'occupant ({R.FACTIONS[code]['name']}).",
                             gn['x'], gn['y'], who=code, important=code == self.player)
        if season == 'printemps' and self.rng.random() < 0.35:
            self.flood_until = self.t + 10
            self.log('meteo', 'Crue de la Garonne et de la Dordogne : les bacs sont ralentis pendant 10 jours.', important=True)
        if self.factions[self.player]['alive']:
            f = self.factions[self.player]
            inc = f['income']
            self.log('eco', f"Bilan de {R.MONTHS[d.month - 2] if d.month > 1 else 'décembre'} : "
                            f"{inc['livres']:+.1f} livres/j, {inc['vivres']:+.1f} vivres/j.", extra=dict(coins=True))

    # ================================================================== économie
    def tools_bonus(self, code):
        f = self.factions[code]
        nn = max(1, len(self.owned_nodes(code)))
        cov = min(1.0, f['res']['outils'] / (3.0 * nn))
        return 1 + (0.30 + self.mod(code, 'tools_max')) * cov, cov

    def node_output(self, n, code):
        gn = self.geo.nodes[n['id']]
        base = R.NODE_BASE[gn['type']]
        out = {k: base.get(k, 0) for k in ('livres', 'vivres', 'recrues', 'industrie', 'fer', 'bois')}
        for s in gn['spec']:
            for k, v in R.SPEC[s].items():
                if k != 'label':
                    bonus = 1.0
                    if s == 'vin':
                        bonus += self.mod(code, 'vin')
                    if s == 'port':
                        bonus += self.mod(code, 'port')
                    out[k] = out.get(k, 0) + v * bonus
        mult = (1 + 0.25 * n['dev']) * max(0.3, n['stab'])
        if n['siege']:
            mult = 0
        ter = self.geo.terrain_at(gn['x'], gn['y'])
        if ter in (T_LANDE, T_MARAIS):
            mult *= 1 + self.mod(code, 'lande_prod')
        return {k: v * mult for k, v in out.items()}

    def compute_income(self):
        self._dirty_income = False
        season = self.season()
        for code, f in self.factions.items():
            if not f['alive']:
                continue
            tb, cov = self.tools_bonus(code)
            ai = 1 + self.mod(code, 'ai_income')
            tot = dict(livres=0.0, vivres=0.0, recrues=0.0, industrie=0.0, fer=0.0, bois=0.0)
            for n in self.owned_nodes(code):
                gn = self.geo.nodes[n['id']]
                o = self.node_output(n, code)
                food = R.SEASON_FOOD[season]
                if season == 'hiver':
                    food += self.mod(code, 'winter_food')
                food *= self.wx(gn['x'], gn['y'])['food']
                tot['livres'] += o['livres'] * tb
                tot['vivres'] += o['vivres'] * food * tb
                tot['recrues'] += o['recrues']
                tot['industrie'] += o['industrie'] * tb
                tot['fer'] += o['fer']
                tot['bois'] += o['bois']
            tot['livres'] *= (1 + self.mod(code, 'livres')) * ai
            tot['vivres'] *= (1 + self.mod(code, 'vivres')) * ai
            tot['recrues'] *= 1 + self.mod(code, 'recrues')
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
            k_up = 1 + self.mod(code, 'upkeep')
            tot['vivres'] -= up_v * k_up
            tot['livres'] -= up_l * k_up
            # industrie
            cap = tot['industrie']
            s = f['slider']
            f['_arm_rate'] = cap * s * (1 + self.mod(code, 'armes_eff')) * 0.5
            f['_tool_rate'] = cap * (1 - s) * 0.5
            f['_cap'] = cap
            f['_cov'] = cov
            f['_upkeep'] = dict(vivres=up_v * k_up, livres=up_l * k_up)
            f['_trade'] = dict(trade_s)
            f['_trade']['livres'] = f['_trade'].get('livres', 0) + trade_l
            f['income'] = dict(livres=tot['livres'], vivres=tot['vivres'], fer=tot['fer'] - f['_arm_rate'] - 0.5 * f['_tool_rate'] * (1 + self.mod(code, 'tools_cost')),
                               bois=tot['bois'] - 0.5 * f['_arm_rate'] - f['_tool_rate'] * (1 + self.mod(code, 'tools_cost')),
                               armes=f['_arm_rate'], outils=f['_tool_rate'], recrues=tot['recrues'], industrie=cap)
            if f.get('_measured'):
                f['income'].update(f['_measured'])

    def economy(self, dt):
        for code, f in self.factions.items():
            if not f['alive']:
                continue
            r = f['res']
            inc = f['income']
            r['livres'] += inc['livres'] * dt
            r['vivres'] += inc['vivres'] * dt
            r['recrues'] = min(r['recrues'] + inc['recrues'] * dt, 3000 + 250 * len(self.owned_nodes(code)))
            gross_fer = inc['fer'] + f['_arm_rate'] + 0.5 * f['_tool_rate'] * (1 + self.mod(code, 'tools_cost'))
            gross_bois = inc['bois'] + 0.5 * f['_arm_rate'] + f['_tool_rate'] * (1 + self.mod(code, 'tools_cost'))
            r['fer'] += gross_fer * dt
            r['bois'] += gross_bois * dt
            # fabrication limitée par les stocks
            kc = 1 + self.mod(code, 'tools_cost')
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
            nn = len(self.owned_nodes(code)) if self._granary_dirty(code) else f.get('_nn', 1)
            cap = 600 + 70 * nn
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
                    cur['left'] -= dt
                    if cur['left'] <= 0:
                        f['research'][b] = None
                        f['techs'].append(cur['tech'])
                        self.recompute_mods(code)
                        if code == self.player:
                            self.log('tech', f"Découverte : {R.TECH[cur['tech']]['name']}.", important=True)
        # milice et stabilité
        for n in self.nodes:
            if n['siege']:
                continue
            code = n['owner']
            k = 1 + (self.mod(code, 'milice') if code != R.NEUTRAL else 0)
            mm = n['milice_max'] * k
            if n['milice'] < mm:
                n['milice'] = min(mm, n['milice'] + mm * 0.012 * dt)
            if n['stab'] < 1:
                rate = 0.012 * (1 + (self.mod(code, 'stab') if code != R.NEUTRAL else 0))
                n['stab'] = min(1.0, n['stab'] + rate * dt)
            # renfort des garnisons
            if code != R.NEUTRAL and n['garrison']:
                self.replenish(code, n['garrison'], dt, 0.04)
        for code, f in self.factions.items():
            if f['alive'] and f['overlord']:
                pass

    def _granary_dirty(self, code):
        f = self.factions[code]
        if f.get('_nn_t', -1) != int(self.t):
            f['_nn_t'] = int(self.t)
            f['_nn'] = max(1, len(self.owned_nodes(code)))
        return False

    def granary_cap(self, code):
        return 600 + 70 * self.factions[code].get('_nn', 1)

    def replenish(self, code, regs, dt, rate):
        f = self.factions[code]
        for reg in regs:
            if reg['n'] < reg['max']:
                add = min(reg['max'] - reg['n'], reg['max'] * rate * dt)
                need_r, need_a = add, add * 0.13
                if f['res']['recrues'] >= need_r and f['res']['armes'] >= need_a:
                    f['res']['recrues'] -= need_r
                    f['res']['armes'] -= need_a
                    reg['n'] += add
            reg['morale'] = min(100 + self.mod(code, 'morale'), reg['morale'] + 6 * dt)

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
        if typ not in R.UNITS:
            return False, "Unité inconnue."
        if gn['type'] == 'village':
            return False, "Seuls le chef-lieu, les villes et les forts lèvent des régiments."
        if gn['type'] == 'fort' and typ in ('cavalerie', 'artillerie'):
            return False, "Un fort ne lève que de l'infanterie."
        if n['siege']:
            return False, "La place est assiégée."
        if len(n['queue']) >= 4:
            return False, "File de production pleine (4 maximum)."
        cost = self.unit_cost(code, typ)
        if not self.can_pay(code, cost):
            return False, "Ressources insuffisantes."
        self.pay(code, cost)
        n['queue'].append(dict(kind='unit', what=typ, left=self.unit_days(code, typ), total=self.unit_days(code, typ)))
        return True, f"{R.UNITS[typ]['name']} en formation à {gn['name']}."

    def build(self, code, nid, what):
        n = self.nodes[nid]
        gn = self.geo.nodes[nid]
        if n['owner'] != code:
            return False, "Cette ville ne vous appartient pas."
        b = R.BUILD.get(what)
        if not b:
            return False, "Construction inconnue."
        lvl = n['fort'] if what == 'fort' else n['dev']
        pending = sum(1 for q in n['queue'] if q['kind'] == 'build' and q['what'] == what)
        if lvl + pending >= b['max']:
            return False, "Niveau maximal atteint."
        if len(n['queue']) >= 4:
            return False, "File de production pleine."
        cost = b['cost'](lvl + pending)
        if not self.can_pay(code, cost):
            return False, "Ressources insuffisantes."
        self.pay(code, cost)
        days = b['days'](lvl + pending)
        n['queue'].append(dict(kind='build', what=what, left=days, total=days))
        return True, f"{b['name']} lancées à {gn['name']}."

    def update_queues(self, dt):
        for n in self.nodes:
            if not n['queue'] or n['siege'] or n['owner'] == R.NEUTRAL:
                continue
            q = n['queue'][0]
            q['left'] -= dt
            if q['left'] <= 0:
                n['queue'].pop(0)
                gn = self.geo.nodes[n['id']]
                if q['kind'] == 'unit':
                    reg = self.new_reg(q['what'])
                    reg['morale'] = 70 + self.mod(n['owner'], 'morale')
                    n['garrison'].append(reg)
                    if n['owner'] == self.player:
                        self.log('armee', f"{R.UNITS[q['what']]['name']} prêt(e) à {gn['name']}.", gn['x'], gn['y'])
                else:
                    if q['what'] == 'fort':
                        n['fort'] = min(3, n['fort'] + 1)
                        n['milice_max'] += 40
                    else:
                        n['dev'] = min(3, n['dev'] + 1)
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
                 assault=False, ai=None, viol=0.0)
        self.armies[aid] = a
        return a

    def army_men(self, a):
        return sum(r['n'] for r in a['regs'])

    def army_speed(self, a):
        sp = min(R.UNITS[r['type']]['speed'] * (1 + (self.mod(a['owner'], 'art_speed') if r['type'] == 'artillerie' else 0))
                 for r in a['regs']) if a['regs'] else 20
        if a['supply'] < 0.35:
            sp *= 0.9
        return sp

    def army_power(self, a, terrain_name='Plaine'):
        return sum(self.reg_power(a['owner'], r, terrain_name) for r in a['regs'])

    def reg_power(self, code, r, tname, wx_fire=1.0, cover=False):
        u = R.UNITS[r['type']]
        p = r['n'] * u['power'] * u['terrain'].get(tname, 1.0)
        k = 1 + self.mod(code, 'all_power')
        if r['type'] in ('ligne', 'legere'):
            k += self.mod(code, 'inf_power')
            p *= wx_fire
        elif r['type'] == 'artillerie':
            k += self.mod(code, 'art_power')
            p *= wx_fire
        else:
            k += self.mod(code, 'cav_power')
            p *= (1 + wx_fire) / 2
        if r['type'] == 'legere' and cover:
            k += self.mod(code, 'legere_cover')
        if tname in ('Montagne', 'Collines', 'Haute montagne'):
            k += self.mod(code, 'mountain')
        p *= k * (0.55 + 0.45 * r['morale'] / 100) * (1 + r['xp'] / 250)
        return max(0.0, p)

    def node_defense_power(self, nid, include_armies=True):
        n = self.nodes[nid]
        code = n['owner']
        gn = self.geo.nodes[nid]
        fort_eff = n['fort'] * (1 - (n['siege']['dmg'] if n['siege'] else 0))
        fb = 1 + 0.35 * fort_eff + (self.mod(code, 'fort_bonus') if code != R.NEUTRAL else 0)
        tname = TERRAIN[self.geo.terrain_at(gn['x'], gn['y'])][0]
        p = n['milice'] * R.MILICE_POWER
        if code != R.NEUTRAL:
            p += sum(self.reg_power(code, r, tname) for r in n['garrison'])
        p *= fb
        if include_armies:
            for a in self.armies.values():
                if a['at_node'] == nid and a['state'] in ('idle',) and self.friendly(a['owner'], code):
                    p += self.army_power(a, tname) * fb
        return p

    def faction_power(self, code):
        p = 0.0
        for a in self.armies.values():
            if a['owner'] == code:
                p += self.army_power(a)
        for n in self.nodes:
            if n['owner'] == code:
                p += n['milice'] * R.MILICE_POWER * 0.5 + sum(self.reg_power(code, r, 'Plaine') for r in n['garrison'])
        return p

    def army_pos_node(self, a):
        if a['at_node'] is not None:
            return a['at_node']
        return None

    # ------------------------------------------------------------------ chemins
    def passable_node(self, code, nid, target):
        o = self.nodes[nid]['owner']
        if o == code or o == R.NEUTRAL:
            return True
        st = self.status(code, o)
        if st in ('guerre', 'alliance'):
            return True
        return False

    def edge_cost(self, code, e):
        sp = 1.15 if e['royal'] else 1.0
        c = e['len'] / sp
        if e['rrank'] == 1 and not self.mod(code, 'bridges'):
            c += 8 if not e['ferry'] else 20
        return c

    def road_route(self, code, start_nodes, goal):
        """start_nodes: dict node -> coût initial. Retourne (coût, [nœuds])."""
        dist = {}
        prev = {}
        pq = []
        for s, c0 in start_nodes.items():
            dist[s] = c0
            heapq.heappush(pq, (c0, s))
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist.get(u, 1e18):
                continue
            if u == goal:
                break
            if u not in start_nodes and self.nodes[u]['owner'] != code and not self.friendly(code, self.nodes[u]['owner']) \
                    and u != goal:
                # on peut traverser un nœud hostile/neutre mais on s'y arrêtera : coût dissuasif
                d += 25
            for eid in self.geo.adj[u]:
                e = self.geo.edges[eid]
                v = e['b'] if e['a'] == u else e['a']
                if not self.passable_node(code, v, goal):
                    continue
                nd = d + self.edge_cost(code, e)
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(pq, (nd, v))
        if goal not in dist:
            return None
        path = [goal]
        while path[-1] not in start_nodes:
            path.append(prev[path[-1]])
        path.reverse()
        return dist[goal], path

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

    def plan_route(self, a, goal):
        code = a['owner']
        legs = []
        if a['at_node'] is not None:
            starts = {a['at_node']: 0.0}
        elif a['edge']:
            e = self.geo.edges[a['edge']['e']]
            frm, pos = a['edge']['frm'], a['edge']['pos']
            to = e['b'] if e['a'] == frm else e['a']
            starts = {}
            if self.passable_node(code, frm, goal):
                starts[frm] = pos
            if self.passable_node(code, to, goal):
                starts[to] = e['len'] - pos
            if not starts:
                return None
        else:
            near = self.nearest_node(a['x'], a['y'], lambda i: self.passable_node(code, i, goal), 60)
            if near is None:
                return None
            nx, ny = self.node_xy(near)
            pts = self.geo.astar(a['x'], a['y'], nx, ny)
            if not pts:
                return None
            legs.append(dict(kind='off', pts=[list(p) for p in pts], i=1))
            starts = {near: 0.0}
        r = self.road_route(code, starts, goal)
        if not r:
            return None
        _, nodes = r
        if a['edge'] and a['at_node'] is None:
            e = self.geo.edges[a['edge']['e']]
            frm, pos = a['edge']['frm'], a['edge']['pos']
            to = e['b'] if e['a'] == frm else e['a']
            first = nodes[0]
            if first == to:
                legs.append(dict(kind='road', e=e['id'], frm=frm, to=to, pos=pos))
            else:
                legs.append(dict(kind='road', e=e['id'], frm=to, to=frm, pos=e['len'] - pos))
        for u, v in zip(nodes, nodes[1:]):
            e = self.edge_between(u, v)
            legs.append(dict(kind='road', e=e['id'], frm=u, to=v, pos=0.0))
        return legs

    def order_move(self, code, aid, x=None, y=None, node=None, mode=None):
        a = self.armies.get(aid)
        if not a or a['owner'] != code:
            return False, "Armée introuvable."
        if a['state'] == 'battle':
            return False, "Cette armée est engagée dans une bataille (ordonnez la retraite)."
        if mode:
            a['mode'] = mode
        if node is not None:
            node = int(node)
            o = self.nodes[node]['owner']
            if o not in (code, R.NEUTRAL) and self.status(code, o) == 'paix':
                return False, f"{self.geo.nodes[node]['name']} appartient à {R.FACTIONS[o]['name']} (en paix). Déclarez la guerre d'abord."
        if a['state'] == 'siege':
            self.end_siege_for(a)
        if a['mode'] == 'route':
            if node is None:
                node_near = self.nearest_node(x, y, maxd=6)
                if node_near is not None:
                    node = node_near
            if node is not None:
                if node == a['at_node']:
                    return False, "L'armée y est déjà."
                legs = self.plan_route(a, node)
                if not legs:
                    return False, "Aucun chemin par les routes (territoire d'un département en paix ?). Essayez à travers champs."
                a['path'] = legs
                a['target'] = dict(node=node)
            else:
                # route jusqu'au nœud le plus proche puis hors route
                near = self.nearest_node(x, y, lambda i: self.passable_node(code, i, None), 40)
                legs = self.plan_route(a, near) if near is not None and near != a['at_node'] else []
                if legs is None:
                    return False, "Aucun chemin praticable."
                sx, sy = self.node_xy(near) if near is not None else (a['x'], a['y'])
                pts = self.geo.astar(sx, sy, x, y)
                if not pts:
                    return False, "Destination inaccessible (eau, montagne ou hors de la région)."
                legs.append(dict(kind='off', pts=[list(p) for p in pts], i=1))
                a['path'] = legs
                a['target'] = dict(x=x, y=y)
        else:
            if node is not None:
                x, y = self.node_xy(node)
            pts = self.geo.astar(a['x'], a['y'], x, y)
            if not pts:
                return False, "Destination inaccessible à travers champs (fleuve sans pont, eau ou hors région)."
            a['path'] = [dict(kind='off', pts=[list(p) for p in pts], i=1)]
            a['target'] = dict(node=node) if node is not None else dict(x=x, y=y)
        a['state'] = 'move'
        a['assault'] = False
        if a['stance'] == 'embuscade':
            a['stance'] = 'normal'
        if a['at_node'] is not None:
            a['at_node'] = None
        return True, "En marche."

    def order_path(self, code, aid, pts):
        """Itinéraire tracé au doigt ou au stylet : l'armée passe par les points dessinés, à travers champs."""
        a = self.armies.get(aid)
        if not a or a['owner'] != code:
            return False, "Armée introuvable."
        if a['state'] == 'battle':
            return False, "Cette armée est engagée dans une bataille (ordonnez la retraite)."
        pts = [(float(p[0]), float(p[1])) for p in pts if len(p) >= 2][:400]
        if not pts:
            return False, "Tracé vide."
        way = [(a['x'], a['y'])]
        for p in pts:
            if math.dist(p, way[-1]) >= 3.0:
                way.append(p)
        if math.dist(pts[-1], way[-1]) > 0.4:
            way.append(pts[-1])
        way = way[:45]
        full = [way[0]]
        skipped = 0
        for p in way[1:]:
            seg = self.geo.astar(full[-1][0], full[-1][1], p[0], p[1], max_nodes=40000)
            if not seg:
                skipped += 1
                continue
            full += seg[1:]
        if len(full) < 2:
            return False, "Tracé impraticable (eau, fleuve sans pont ou hors de la région)."
        ex, ey = full[-1]
        node = self.nearest_node(ex, ey, maxd=1.6)
        if node is not None:
            o = self.nodes[node]['owner']
            if o not in (code, R.NEUTRAL) and self.status(code, o) == 'paix':
                node = None
        if a['state'] == 'siege':
            self.end_siege_for(a)
        a['mode'] = 'champs'
        a['path'] = [dict(kind='off', pts=[list(p) for p in full], i=1)]
        a['target'] = dict(node=node) if node is not None else dict(x=ex, y=ey)
        a['state'] = 'move'
        a['assault'] = False
        if a['stance'] == 'embuscade':
            a['stance'] = 'normal'
        a['at_node'] = None
        msg = "En marche le long du tracé."
        if skipped:
            msg += " Les passages impossibles ont été contournés."
        return True, msg

    def move_armies(self, dt):
        season = self.season()
        for a in list(self.armies.values()):
            if a['state'] not in ('move', 'retreat') or not a['path']:
                if a['state'] in ('move', 'retreat') and not a['path']:
                    a['state'] = 'idle'
                continue
            budget = dt
            base = self.army_speed(a)
            if a['state'] == 'retreat':
                base *= 1.15
            wx = self.wx(a['x'], a['y'])
            while budget > 1e-9 and a['path']:
                leg = a['path'][0]
                if leg['kind'] == 'road':
                    e = self.geo.edges[leg['e']]
                    sp = base * (1.15 if e['royal'] else 1.0) * R.SEASON_ROAD[season] * wx['move'] \
                        * (1 + self.mod(a['owner'], 'road_speed'))
                    if self.wx(a['x'], a['y']) is R.WEATHER['neige'] and self.zone_of(a['x'], a['y']) == 'montagne':
                        sp *= 0.6
                    zone_end = e['len']
                    if e['rrank'] == 1 and not self.mod(a['owner'], 'bridges'):
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
                    if any(r['type'] == 'artillerie' for r in a['regs']) and tname in ('Forêt', 'Marais', 'Montagne', 'Haute montagne', 'Dunes'):
                        mult *= 0.6
                    if tname in ('Montagne', 'Haute montagne', 'Collines'):
                        mult *= 1 + self.mod(a['owner'], 'mountain')
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
            if not a['path'] and a['state'] in ('move', 'retreat'):
                a['state'] = 'idle' if a['state'] != 'battle' else a['state']
                if a['ai'] and a['ai'].get('then') == 'embuscade':
                    a['stance'] = 'embuscade'
                    a['ai']['then'] = None
            # violation de territoire en paix
            if a['state'] in ('move', 'idle'):
                nd = self.geo.node_of_cell(a['x'], a['y'])
                if nd is not None:
                    o = self.nodes[nd]['owner']
                    if o not in (a['owner'], R.NEUTRAL) and self.status(a['owner'], o) == 'paix':
                        self.factions[o]['rel'][a['owner']] = max(-100, self.factions[o]['rel'][a['owner']] - 1.2 * dt)
                        a['viol'] += dt
                        if a['viol'] > 0.5 and o == self.player and self.rng.random() < dt:
                            self.log('diplo', f"Des troupes de {R.FACTIONS[a['owner']]['name']} violent votre territoire.",
                                     a['x'], a['y'], who=a['owner'])

    def arrive_node(self, a, nid):
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
        if o != R.NEUTRAL and not self.at_war(code, o):
            a['path'] = []
            a['state'] = 'idle'
            return True
        if a['state'] == 'retreat':
            a['path'] = []
            a['state'] = 'idle'
        # nœud hostile ou neutre : combat ou siège
        defense = self.node_defense_power(nid)
        gn = self.geo.nodes[nid]
        if defense < 1:
            self.capture(nid, code)
            return False if a['path'] else True
        mine = self.army_power(a, TERRAIN[self.geo.terrain_at(gn['x'], gn['y'])][0])
        if n['siege'] and n['siege']['by'] != code:
            a['path'] = []
            a['state'] = 'idle'
            if code == self.player:
                self.log('siege', f"{gn['name']} est déjà investie par {self.fname(n['siege']['by'])}.", gn['x'], gn['y'])
            return True
        if o == R.NEUTRAL and (mine > 3 * defense or (n['siege'] and n['siege'].get('occupy') and n['siege']['by'] == code)):
            if not n['siege']:
                n['siege'] = dict(by=code, dmg=0.0, since=self.t, occupy=True)
                if code == self.player:
                    self.log('siege', f"Vos troupes occupent {gn['name']} : ralliement en cours…", gn['x'], gn['y'], who=code)
            a['state'] = 'siege'
            return True
        if n['fort'] >= 1 and not a['assault'] and n['siege'] is None and (o != R.NEUTRAL or n['fort'] >= 2):
            n['siege'] = dict(by=code, dmg=0.0, since=self.t)
            a['state'] = 'siege'
            if code == self.player or o == self.player:
                self.log('siege', f"Siège de {gn['name']} par {R.FACTIONS[code]['name']}.", gn['x'], gn['y'], who=code,
                         important=True)
            return True
        if n['siege'] and n['siege']['by'] == code and not a['assault']:
            a['state'] = 'siege'
            return True
        self.start_battle([a], [], gx=gn['x'], gy=gn['y'], node=nid)
        return True

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

    def update_sieges(self, dt):
        for n in self.nodes:
            s = n['siege']
            if not s:
                continue
            nid = n['id']
            bes = [a for a in self.armies.values() if a['at_node'] == nid and a['state'] == 'siege' and a['owner'] == s['by']]
            if not bes:
                n['siege'] = None
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
            n_art = sum(1 for a in bes for r in a['regs'] if r['type'] == 'artillerie')
            power_art = 1 + self.mod(s['by'], 'art_power')
            rate = (0.02 + 0.06 * n_art * power_art) / max(1, n['fort'])
            s['dmg'] = min(1.0, s['dmg'] + rate * dt)
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
        return side, srcs

    def visible_armies(self, code):
        side, srcs = self.vision_sources(code)
        det = BASE_DETECT + self.mod(code, 'detect') + 1.5
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
        return vis, srcs

    # ------------------------------------------------------------------ contacts et batailles
    def detect_contacts(self):
        arr = [a for a in self.armies.values() if a['state'] not in ('battle',) and self.t >= a['grace'] and a['regs']]
        n = len(arr)
        for i in range(n):
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
                        det = BASE_DETECT + self.mod(y['owner'], 'detect')
                        if d2 > det * det or d2 <= CONTACT_KM * CONTACT_KM:
                            amb = (x, y)
                if amb:
                    x, y = amb
                    self.start_battle([x], [y], gx=y['x'], gy=y['y'], ambush=True)
                elif d2 <= CONTACT_KM * CONTACT_KM:
                    if a['state'] == 'siege' and b['state'] == 'siege':
                        continue
                    surprise = a['hidden'] or b['hidden']
                    att, de = (a, b) if (a['state'] == 'move' or a['hidden']) else (b, a)
                    self.start_battle([att], [de], gx=(a['x'] + b['x']) / 2, gy=(a['y'] + b['y']) / 2,
                                      surprise=surprise and att['hidden'])
        # renforts : armées proches d'une bataille en cours
        for bt in self.battles.values():
            for a in self.armies.values():
                if a['state'] == 'battle' or not a['regs'] or self.t < a['grace']:
                    continue
                if (a['x'] - bt['x']) ** 2 + (a['y'] - bt['y']) ** 2 > 9:
                    continue
                for si, side in enumerate(bt['sides']):
                    other = bt['sides'][1 - si]
                    if self.friendly(a['owner'], side['owner']) and self.at_war(a['owner'], other['owner']):
                        side['armies'].append(a['id'])
                        side['men0'] += self.army_men(a)
                        a['state'] = 'battle'
                        a['battle'] = bt['id']
                        a['path'] = []
                        break

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
                a['path'] = [] if a in de or ambush else a['path']
                side['men0'] += self.army_men(a)
            if side['node'] is not None:
                n = self.nodes[side['node']]
                side['men0'] += n['milice'] + sum(r['n'] for r in n['garrison'])
        if ambush:
            for a in de:
                for r in a['regs']:
                    r['morale'] = max(5, r['morale'] - 25 * (1 + self.mod(code_a, 'ambush')))
        self.battles[bid] = bt
        gname = self.place_name(gx, gy)
        if code_a == self.player or code_d == self.player or self.player in (code_a, code_d):
            kind = 'Embuscade' if ambush else ('Assaut' if node is not None else 'Bataille')
            self.log('battle', f"{kind} {gname} : {self.fname(code_a)} attaque {self.fname(code_d)}.", gx, gy,
                     who=code_a, important=True)

    def fname(self, code):
        return 'les insurgés' if code == R.NEUTRAL else R.FACTIONS[code]['name']

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

    def update_battles(self, dt):
        for bid in list(self.battles):
            bt = self.battles.get(bid)
            if not bt:
                continue
            age = self.t - bt['t0']
            wxf = self.wx(bt['x'], bt['y'])['fire']
            powers = [0.0, 0.0]
            men = [0.0, 0.0]
            for si in (0, 1):
                side = bt['sides'][si]
                side['armies'] = [aid for aid in side['armies'] if aid in self.armies and self.armies[aid]['regs']]
                p = 0.0
                for owner, r, a in self.side_units(bt, si):
                    rp = self.reg_power(owner, r, bt['terrain'], wxf, bt['cover'])
                    rp *= 0.75 + 0.25 * a['supply']
                    if si == 1:
                        rp *= bt['defbonus']
                        if a['stance'] == 'retranche':
                            rp *= 1.2
                    elif bt['river'] >= 2:
                        rp *= 0.85
                    if (bt['ambush'] and si == 0 and age < 0.35) or (bt['surprise'] and si == 0 and age < 0.2):
                        rp *= 1.8 + self.mod(owner, 'ambush') if bt['ambush'] else 1.3
                    p += rp
                    men[si] += r['n']
                if side['node'] is not None:
                    n = self.nodes[side['node']]
                    o = n['owner']
                    fort_eff = n['fort'] * (1 - (n['siege']['dmg'] if n['siege'] else 0))
                    fb = 1 + 0.35 * fort_eff + (self.mod(o, 'fort_bonus') if o != R.NEUTRAL else 0)
                    p *= fb
                    p += n['milice'] * R.MILICE_POWER * fb
                    men[si] += n['milice']
                    if o != R.NEUTRAL:
                        for r in n['garrison']:
                            p += self.reg_power(o, r, bt['terrain'], wxf) * fb
                            men[si] += r['n']
                powers[si] = p
            # pertes
            K = 0.20
            for si in (0, 1):
                oi = 1 - si
                dmg = K * powers[oi] * dt
                owner_si = bt['sides'][si]['owner']
                if owner_si != R.NEUTRAL:
                    dmg *= 1 + self.mod(owner_si, 'casualties')
                self.apply_losses(bt, si, dmg, men[si])
            for si in (0, 1):
                side = bt['sides'][si]
                bt['recent'][si] = side['lost']
            # fin ?
            res = None
            for si in (0, 1):
                side = bt['sides'][si]
                m_now = self.side_men(bt, si)
                mor = self.side_morale(bt, si)
                if m_now < 10 or m_now < side['men0'] * 0.18 or mor < 12:
                    res = 1 - si
                    break
            if res is None and age > 4.0:
                res = 0 if powers[0] >= powers[1] else 1
            if res is not None:
                self.end_battle(bt, res)

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
            fort = n['fort'] * (1 - (n['siege']['dmg'] if n['siege'] else 0))
            mm = min(100, 55 + 15 * fort)
            tot += mm * n['milice']
            w += n['milice']
        return tot / w if w > 0 else 0

    def apply_losses(self, bt, si, dmg, men_total):
        if men_total <= 0 or dmg <= 0:
            return
        side = bt['sides'][si]
        units = self.side_units(bt, si)
        node = self.nodes[side['node']] if side['node'] is not None else None
        has_inf = any(r['type'] != 'artillerie' for _, r, _ in units) or (node and node['milice'] > 0)
        weights = []
        for owner, r, a in units:
            v = 0.5 if (r['type'] == 'artillerie' and has_inf) else 1.0
            weights.append(r['n'] * v)
        if node:
            weights.append(node['milice'] * 1.1)
            for r in node['garrison']:
                weights.append(r['n'])
        W = sum(weights) or 1
        frac_side = dmg / max(1.0, men_total)
        k = 0
        for owner, r, a in units:
            loss = min(r['n'], dmg * weights[k] / W)
            r['n'] -= loss
            r['morale'] = max(0.0, r['morale'] - frac_side * 230)
            side['lost'] += loss
            k += 1
        if node:
            loss = min(node['milice'], dmg * weights[k] / W)
            node['milice'] -= loss
            side['lost'] += loss
            k += 1
            for r in node['garrison']:
                loss = min(r['n'], dmg * weights[k] / W)
                r['n'] -= loss
                r['morale'] = max(0.0, r['morale'] - frac_side * 150)
                side['lost'] += loss
                k += 1
            node['garrison'] = [r for r in node['garrison'] if r['n'] >= 5]
        for aid in side['armies']:
            a = self.armies.get(aid)
            if a:
                a['regs'] = [r for r in a['regs'] if r['n'] >= 5]

    def end_battle(self, bt, winner):
        loser = 1 - winner
        W, L = bt['sides'][winner], bt['sides'][loser]
        gname = self.place_name(bt['x'], bt['y'])
        has_cav = any(r['type'] == 'cavalerie' for _, r, _ in self.side_units(bt, winner))
        for si in (0, 1):
            for aid in bt['sides'][si]['armies']:
                a = self.armies.get(aid)
                if not a:
                    continue
                a['battle'] = None
                if si == winner:
                    for r in a['regs']:
                        r['xp'] = min(100, r['xp'] + 8)
                        r['morale'] = max(r['morale'], 35)
                    a['state'] = 'move' if a['path'] else 'idle'
                    a['assault'] = False
                else:
                    pursuit = (0.10 if has_cav else 0.04) * (1 + self.mod(a['owner'], 'retreat'))
                    for r in a['regs']:
                        r['n'] *= 1 - pursuit
                        r['morale'] = max(r['morale'], 18)
                    a['regs'] = [r for r in a['regs'] if r['n'] >= 5]
                    if not a['regs']:
                        del self.armies[aid]
                        continue
                    self.retreat(a)
        for si, side in ((winner, W), (loser, L)):
            if side['owner'] in self.factions:
                st = self.factions[side['owner']]['stats']
                st['won' if si == winner else 'lost'] += 1
                st['killed'] += bt['sides'][1 - si]['lost']
        # prise de la place ?
        if L['node'] is not None:
            nid = L['node']
            self.nodes[nid]['milice'] = 0
            self.nodes[nid]['garrison'] = []
            self.capture(nid, W['owner'])
            for aid in W['armies']:
                a = self.armies.get(aid)
                if a:
                    a['at_node'] = nid
                    a['x'], a['y'] = self.node_xy(nid)
        elif W['node'] is not None:
            n = self.nodes[W['node']]
            if n['siege']:
                n['siege'] = None
        del self.battles[bt['id']]
        if self.player in (W['owner'], L['owner']) or any(
                self.friendly(self.player, s['owner']) for s in (W, L)):
            won = self.friendly(self.player, W['owner'])
            wn = self.fname(W['owner'])
            txt = (f"{'Victoire' if won else 'Défaite'} {gname} — {wn} l'emporte{'nt' if W['owner'] == R.NEUTRAL else ''}. "
                   f"Pertes : {self.fname(bt['sides'][0]['owner'])} {int(bt['sides'][0]['lost'])}, "
                   f"{self.fname(bt['sides'][1]['owner'])} {int(bt['sides'][1]['lost'])}.")
            self.log('battle_end', txt, bt['x'], bt['y'], who=W['owner'], important=True,
                     extra=dict(win=won, a=bt['sides'][0]['owner'], d=bt['sides'][1]['owner'],
                                la=int(bt['sides'][0]['lost']), ld=int(bt['sides'][1]['lost'])))

    def retreat(self, a):
        code = a['owner']
        a['state'] = 'retreat'
        a['grace'] = self.t + 1.0
        a['stance'] = 'normal'
        a['assault'] = False
        best = None
        for gn in self.geo.nodes:
            n = self.nodes[gn['id']]
            if n['owner'] == code or self.friendly(code, n['owner']):
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
        legs = self.plan_route(a, best[1])
        if not legs:
            pts = self.geo.astar(a['x'], a['y'], *self.node_xy(best[1]))
            legs = [dict(kind='off', pts=[list(p) for p in pts], i=1)] if pts else None
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
                if bt and (not bt['sides'][0]['armies'] and bt['sides'][0]['node'] is None):
                    self.end_battle(bt, 1)
                elif bt and (not bt['sides'][1]['armies'] and bt['sides'][1]['node'] is None):
                    self.end_battle(bt, 0)
                return True, "Retraite ordonnée."
        if a['state'] == 'siege':
            self.end_siege_for(a)
        self.retreat(a)
        return True, "Retraite ordonnée."

    # ------------------------------------------------------------------ prise d'une place
    def capture(self, nid, code, peaceful=False):
        n = self.nodes[nid]
        gn = self.geo.nodes[nid]
        old = n['owner']
        if old == code:
            return
        n['owner'] = code
        n['milice'] = n['milice_max'] * (0.5 if peaceful else 0.15)
        n['stab'] = 0.6 if peaceful else 0.35
        n['garrison'] = []
        n['queue'] = []
        n['siege'] = None
        if not peaceful and n['dev'] > 0 and old != R.NEUTRAL and self.rng.random() < 0.35:
            n['dev'] -= 1
        self._dirty_income = True
        if code in self.factions:
            self.factions[code]['stats']['captured'] += 1
        if old in self.factions:
            self.factions[old]['rel'][code] = max(-100, self.factions[old]['rel'][code] - 12)
        if not peaceful and (code == self.player or old == self.player):
            self.log('capture', f"{gn['name']} tombe aux mains de {self.fname(code)}.", gn['x'], gn['y'], who=code, important=True)
        elif not peaceful:
            self.log('capture', f"{gn['name']} tombe aux mains de {self.fname(code)}.", gn['x'], gn['y'], who=code)
        # pénalité pour l'expansion près des voisins
        if old == R.NEUTRAL and code in self.factions:
            for o in self.factions:
                if o != code and gn['dept'] == o:
                    self.factions[o]['rel'][code] = max(-100, self.factions[o]['rel'][code] - 3)
        if gn['type'] == 'capitale' and old in self.factions and gn['dept'] == old:
            self.capitulate(old, code)
        self.check_end()

    def capitulate(self, loser, winner):
        lf = self.factions[loser]
        if not lf['alive']:
            return
        lf['alive'] = False
        for n in self.nodes:
            if n['owner'] == loser:
                n['owner'] = winner
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
        self.log('capitulation', f"{R.FACTIONS[loser]['name']} capitule ! Ses villes passent à {self.fname(winner)}.",
                 who=winner, important=True)

    def check_end(self):
        if self.over:
            return
        p = self.player
        if not self.factions[p]['alive'] or self.nodes[self.capital_of(p)]['owner'] != p:
            self.over = dict(result='defaite', text="Votre chef-lieu est tombé. La partie est perdue.", t=self.t)
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
    def attrition(self, dt):
        season = self.season()
        for a in list(self.armies.values()):
            code = a['owner']
            nd = self.geo.node_of_cell(a['x'], a['y'])
            friendly_land = nd is not None and (self.nodes[nd]['owner'] == code or self.friendly(code, self.nodes[nd]['owner']))
            if friendly_land:
                a['supply'] = min(1.0, a['supply'] + 0.3 * dt)
            else:
                k = 1.8 if season == 'hiver' else (0.6 if season in ('été', 'automne') else 1.0)
                a['supply'] = max(0.0, a['supply'] - 0.035 * k * dt)
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
                if season == 'été' and tname == 'Marais':
                    base *= 1.5
                rate += base
            if a['supply'] < 0.35:
                rate += 0.012
            f = self.factions[code]
            if f.get('famine'):
                rate += 0.015
            if f.get('banqueroute'):
                rate += 0.008
            if self.weather[self.zone_of(a['x'], a['y'])]['kind'] == 'canicule' and a['state'] == 'move':
                rate += 0.002
            rate *= max(0.2, 1 + self.mod(code, 'attrition'))
            if rate > 0:
                for r in a['regs']:
                    r['n'] -= r['n'] * rate * dt
                    if f.get('famine') or f.get('banqueroute'):
                        r['morale'] = max(5, r['morale'] - 3 * dt)
                a['regs'] = [r for r in a['regs'] if r['n'] >= 5]
            if a['state'] == 'idle':
                if friendly_land:
                    for r in a['regs']:
                        r['morale'] = min(100 + self.mod(code, 'morale'), r['morale'] + 5 * dt)
                    if a['at_node'] is not None and self.geo.nodes[a['at_node']]['type'] != 'village':
                        self.replenish(code, a['regs'], dt, 0.02)
                else:
                    for r in a['regs']:
                        r['morale'] = min(90, r['morale'] + 1.5 * dt)
            if not a['regs']:
                if a['battle'] and a['battle'] in self.battles:
                    for s in self.battles[a['battle']]['sides']:
                        if a['id'] in s['armies']:
                            s['armies'].remove(a['id'])
                del self.armies[a['id']]
        # sièges : les assiégeants s'usent aussi
        if not self.factions[self.player]['alive']:
            self.check_end()

    # ================================================================== ordres du joueur
    def form_army(self, code, nid, reg_ids, into=None):
        n = self.nodes[nid]
        if n['owner'] != code:
            return False, "Garnison introuvable."
        regs = [r for r in n['garrison'] if r['id'] in reg_ids]
        if not regs:
            return False, "Choisissez au moins un régiment."
        if into:
            a = self.armies.get(into)
            if not a or a['owner'] != code or a['at_node'] != nid or a['state'] not in ('idle',):
                return False, "L'armée doit être sur place et au repos."
            a['regs'] += regs
        else:
            gx, gy = self.node_xy(nid)
            a = self.create_army(code, gx, gy, regs, node=nid)
        n['garrison'] = [r for r in n['garrison'] if r['id'] not in reg_ids]
        return True, a['id']

    def to_garrison(self, code, aid):
        a = self.armies.get(aid)
        if not a or a['owner'] != code:
            return False, "Armée introuvable."
        if a['at_node'] is None or self.nodes[a['at_node']]['owner'] != code or a['state'] != 'idle':
            return False, "L'armée doit être au repos dans une de vos villes."
        self.nodes[a['at_node']]['garrison'] += a['regs']
        del self.armies[aid]
        return True, "Régiments placés en garnison."

    def split(self, code, aid, reg_ids):
        a = self.armies.get(aid)
        if not a or a['owner'] != code or a['state'] in ('battle',):
            return False, "Impossible de scinder cette armée maintenant."
        regs = [r for r in a['regs'] if r['id'] in reg_ids]
        if not regs or len(regs) == len(a['regs']):
            return False, "Choisissez une partie des régiments."
        a['regs'] = [r for r in a['regs'] if r['id'] not in reg_ids]
        b = self.create_army(code, a['x'], a['y'], regs, node=a['at_node'])
        b['onroad'] = a['onroad']
        b['edge'] = dict(a['edge']) if a['edge'] else None
        if a['state'] == 'siege':
            b['state'] = 'siege'
        return True, b['id']

    def merge(self, code, aid, bid):
        a, b = self.armies.get(aid), self.armies.get(bid)
        if not a or not b or a['owner'] != code or b['owner'] != code or a is b:
            return False, "Armées introuvables."
        if math.hypot(a['x'] - b['x'], a['y'] - b['y']) > 3 or 'battle' in (a['state'], b['state']):
            return False, "Les armées doivent être côte à côte et hors combat."
        a['regs'] += b['regs']
        del self.armies[bid]
        return True, "Armées réunies."

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
        return True, "Assaut ordonné !"

    def set_slider(self, code, v):
        self.factions[code]['slider'] = max(0.0, min(1.0, float(v)))
        self._dirty_income = True
        return True, "Production ajustée."

    def market_trade(self, code, res, qty, side):
        if res not in self.market:
            return False, "Ressource non négociable."
        qty = max(1, min(1000, int(qty)))
        has_port = any('port' in self.geo.nodes[n['id']]['spec'] for n in self.owned_nodes(code))
        spread = (1.15, 0.85) if has_port else (1.4, 0.6)
        p = self.market[res]
        r = self.factions[code]['res']
        if side == 'buy':
            cost = qty * p * spread[0]
            if r['livres'] < cost:
                return False, "Livres insuffisantes."
            r['livres'] -= cost
            r[res] += qty
            self.market[res] = round(p * (1 + 0.0004 * qty), 3)
            return True, f"Acheté {qty} {R.RES_LABEL[res].lower()} pour {int(cost)} livres."
        if r[res] < qty:
            return False, "Stock insuffisant."
        gain = qty * p * spread[1]
        r[res] -= qty
        r['livres'] += gain
        self.market[res] = round(max(0.05, p * (1 - 0.0004 * qty)), 3)
        return True, f"Vendu {qty} {R.RES_LABEL[res].lower()} pour {int(gain)} livres."
