"""Intelligence artificielle d'un département."""
import math
import random

from . import rules as R
from . import diplomacy as D
from .geo import TERRAIN

MIX = {
    '33': ['ligne'] * 5 + ['legere'] * 2 + ['cavalerie'] * 2 + ['artillerie'] * 1 + ['grenadiers', 'sapeurs'],
    '24': ['ligne'] * 4 + ['legere'] * 2 + ['cavalerie'] * 1 + ['artillerie'] * 2 + ['grenadiers', 'sapeurs'],
    '40': ['ligne'] * 3 + ['legere'] * 4 + ['cavalerie'] * 2 + ['artillerie'] * 1 + ['grenadiers'],
    '47': ['ligne'] * 4 + ['legere'] * 1 + ['cavalerie'] * 3 + ['artillerie'] * 1 + ['grenadiers'],
    '64': ['ligne'] * 5 + ['legere'] * 1 + ['chasseurs'] * 3 + ['cavalerie'] * 1 + ['artillerie'] * 1 + ['grenadiers'],
}
VALUE = {'capitale': 12, 'ville': 5, 'fort': 3, 'village': 2}


class AI:
    def __init__(self, game, code):
        self.g = game
        self.code = code
        self.pers = R.FACTIONS[code]['personality']
        self.rng = random.Random(game.seed * 7 + int(code))
        self.diplo_clock = 5 + self.rng.random() * 5
        self.cool = {}

    @property
    def f(self):
        return self.g.factions[self.code]

    def step(self):
        if not self.f['alive']:
            return
        self.economy()
        self.research()
        self.recruit()
        self.military()
        if self.g.t >= self.diplo_clock:
            self.diplo_clock = self.g.t + 8 + self.rng.random() * 5
            self.diplomacy()
            self.espionage()

    def espionage(self):
        """Saboter les remparts d'une place ennemie que nos armées convoitent, ou espionner un voisin."""
        g, code, f = self.g, self.code, self.f
        wars = self.wars()
        if not wars or f['res']['livres'] < 450 or self.rng.random() > 0.35:
            return
        mine = [a for a in g.armies.values() if a['owner'] == code]
        cands = []
        for n in g.nodes:
            if n['owner'] not in wars or n['fort'] < 2:
                continue
            x, y = g.node_xy(n['id'])
            d = min((math.hypot(a['x'] - x, a['y'] - y) for a in mine), default=999)
            if d < 70:
                val = VALUE[g.geo.nodes[n['id']]['type']] * n['fort'] / (d + 10)
                cands.append((val, n['id']))
        if cands:
            cands.sort(reverse=True)
            g.spy(code, cands[0][1], 'saboter')

    # ------------------------------------------------------------------ économie
    def economy(self):
        g, f, code = self.g, self.f, self.code
        r = f['res']
        s = 0.8 if r['armes'] < 150 else (0.3 if f.get('_cov', 1) < 0.6 else 0.55)
        if r['armes'] > 1000:
            s = 0.15 if r['outils'] < 600 else 0.5
        if abs(s - f['slider']) > 0.01:
            g.set_slider(code, s)
        # impôts : on presse le contribuable en cas de besoin, on desserre l'étau si l'ordre public vacille
        mine = g.owned_nodes(code)
        avg = sum(n['stab'] for n in mine) / max(1, len(mine))
        tax = 0.5
        if avg < 0.62:
            tax = 0.3
        elif r['livres'] < 150 and avg > 0.8:
            tax = 0.7
        elif self.wars() and r['livres'] < 500 and avg > 0.85:
            tax = 0.62
        if abs(tax - f.get('tax', 0.5)) > 0.01:
            g.set_tax(code, tax)
        if r['livres'] < 120:
            for res, keep in (('vivres', 500), ('bois', 350), ('fer', 300)):
                if r[res] > keep + 50:
                    g.market_trade(code, res, int(r[res] - keep), 'sell')
        # matières premières : un trésor qui dort achète le fer et le bois des remparts et des agrandissements
        if r['livres'] > 1500:
            for res, low in (('bois', 250), ('fer', 150)):
                if r[res] < low:
                    g.market_trade(code, res, min(400, int((r['livres'] - 1200) / (4 * g.market[res]))), 'buy')
        self.build_depot()
        if r['livres'] > 900:
            own = [n for n in g.owned_nodes(code) if not n['queue'] and not n['siege']]
            own.sort(key=lambda n: (-VALUE[g.geo.nodes[n['id']]['type']], -len(g.geo.nodes[n['id']]['spec'])))
            built = 0
            for n in own[:8]:
                if built >= (3 if r['livres'] > 3000 else 1):
                    break
                gn = g.geo.nodes[n['id']]
                if (gn['type'] in ('capitale', 'ville') or gn['spec']) and n['dev'] < (3 if r['livres'] > 3000 else 2):
                    if g.build(code, n['id'], 'dev')[0]:
                        built += 1
                        continue
                if (self.threat_at(n['id']) > 0 or gn['type'] == 'capitale') and n['fort'] < g.fort_max(code, n['id']):
                    if g.build(code, n['id'], 'fort')[0]:
                        built += 1

    def build_depot(self):
        """En guerre, un magasin aux vivres dans la place la plus avancée vers l'ennemi."""
        g, f, code = self.g, self.f, self.code
        wars = self.wars()
        if not wars or f['res']['livres'] < 600 or f['res']['bois'] < 80:
            return
        own = [n for n in g.owned_nodes(code) if not n['siege'] and len(n['queue']) < 3]
        if not own or any(n.get('depot') for n in own if self.threat_at(n['id'], 60) > 0):
            return
        foes = [g.node_xy(g.capital_of(o)) for o in wars]
        front = min(own, key=lambda n: min(math.dist(g.node_xy(n['id']), p) for p in foes))
        if not front.get('depot') and not any(q['what'] == 'depot' for q in front['queue']):
            g.build(code, front['id'], 'depot')

    def research(self):
        g, f = self.g, self.f
        busy = sum(1 for v in f['research'].values() if v)
        if busy >= (3 if f['res']['livres'] > 1200 else 2):
            return
        for b in sorted(R.BRANCHES, key=lambda b: (b != self.pers['tech'], self.rng.random())):
            if f['research'][b]:
                continue
            avail = [t for t in R.TECH.values() if t['branch'] == b and t['id'] not in f['techs']
                     and all(q in f['techs'] for q in t['req'])]
            if not avail:
                continue
            t = min(avail, key=lambda t: t['cost'] * (0.8 + 0.4 * self.rng.random()))
            if f['res']['livres'] > t['cost'] + 180:
                g.research(self.code, t['id'])
                return

    def regs_total(self):
        """Régiments de campagne (la Garde nationale, qui ne quitte pas sa ville, ne compte pas)."""
        return sum(1 for r in self.g.all_regs(self.code) if not R.UNITS[r['type']]['garrison_only'])

    def wars(self):
        return [o for o in self.g.factions if o != self.code and self.g.at_war(self.code, o) and self.g.factions[o]['alive']]

    def recruit(self):
        g, f, code = self.g, self.f, self.code
        self.raise_garde()
        aggr = self.pers['aggr'] * R.DIFFICULTY[g.difficulty]['ai_aggr']
        gross = f.get('_gross_livres', 20)
        time_target = 4 + int(g.t / 90) + int(5 * aggr) + (4 if self.wars() else 0)
        surplus = min(25, int(max(0.0, f['res']['livres'] - 1000) / 400))  # trésor qui dort : on arme
        income_cap = max(5, int(gross * (0.5 + 0.25 * aggr) / 2.6))
        target = min(time_target + surplus, income_cap + surplus // 2)
        if self.regs_total() >= target:
            return
        if f['income']['livres'] < 0.5 and f['res']['livres'] < 400:
            return
        typ = self.rng.choice(MIX[code])
        cost = g.unit_cost(code, typ)
        reserve = dict(cost)
        reserve['livres'] = cost['livres'] + 60
        if not g.can_pay(code, reserve):
            typ = 'ligne'
            if not g.can_pay(code, g.unit_cost(code, typ)):
                return
        cands = [n for n in g.owned_nodes(code) if g.geo.nodes[n['id']]['type'] in ('capitale', 'ville') and not n['siege']
                 and len(n['queue']) < 2]
        if typ != 'ligne' and not any(g.can_recruit(code, n['id'], typ)[0] for n in cands):
            typ = 'ligne'   # technologie manquante, ou unité régionale levée ailleurs
        cands = [n for n in cands if g.can_recruit(code, n['id'], typ)[0]]
        if not cands:
            return
        cands.sort(key=lambda n: (len(n['queue']), g.geo.nodes[n['id']]['type'] != 'capitale', -self.threat_at(n['id'])))
        g.recruit(code, cands[0]['id'], typ)

    def raise_garde(self):
        """Une place menacée et mal défendue lève sa Garde nationale."""
        g, f, code = self.g, self.f, self.code
        if f['res']['livres'] < 250 or not self.wars():
            return
        gardes = sum(1 for r in g.all_regs(code) if r['type'] == 'garde')
        if gardes >= max(3, len(g.owned_nodes(code)) // 5):
            return
        for n in g.owned_nodes(code):
            if n['siege'] or n['queue'] or sum(1 for r in n['garrison'] if r['type'] == 'garde') >= 2:
                continue
            th = self.threat_at(n['id'], 30)
            if th > 0 and th > g.node_defense_power(n['id']) * 0.7:
                if g.recruit(code, n['id'], 'garde')[0]:
                    return

    # ------------------------------------------------------------------ militaire
    def threat_at(self, nid, radius=35):
        g = self.g
        x, y = g.node_xy(nid)
        p = 0.0
        for a in g.armies.values():
            if a['hidden'] or not g.at_war(self.code, a['owner']):
                continue
            if (a['x'] - x) ** 2 + (a['y'] - y) ** 2 < radius * radius:
                p += g.army_power(a)
        return p

    def military(self):
        g, code = self.g, self.code
        # 1) former des armées avec les garnisons
        for n in g.owned_nodes(code):
            if not n['garrison'] or n['siege']:
                continue
            gn = g.geo.nodes[n['id']]
            threat = self.threat_at(n['id'])
            at_war = bool(self.wars())
            keep = (3 if threat > 0 or at_war else 2) if gn['type'] == 'capitale' else (1 if threat > 0 else 0)
            regs = sorted(n['garrison'], key=lambda r: -r['n'])
            movable = [r for r in regs if r['n'] > r['max'] * 0.6][keep:]
            if not movable:
                continue
            here = [a for a in g.armies.values() if a['owner'] == code and a['at_node'] == n['id'] and a['state'] == 'idle']
            if here:
                g.form_army(code, n['id'], [r['id'] for r in movable], into=here[0]['id'])
            elif len(movable) >= 2 or (gn['type'] != 'capitale' and movable):
                g.form_army(code, n['id'], [r['id'] for r in movable])
        # 2) regrouper les armées au repos côte à côte
        idle = [a for a in g.armies.values() if a['owner'] == code and a['state'] == 'idle' and a['stance'] != 'embuscade']
        for i, a in enumerate(idle):
            if a['id'] not in g.armies:
                continue
            for b in idle[i + 1:]:
                if b['id'] in g.armies and abs(a['x'] - b['x']) < 1.5 and abs(a['y'] - b['y']) < 1.5:
                    g.merge(code, a['id'], b['id'])
        self.rally = self.rally_node()
        mine = [a for a in g.armies.values() if a['owner'] == code]
        taken = {}
        for a in mine:
            if a['target'] and a['state'] == 'move' and a['target'].get('node') is not None:
                taken[a['target']['node']] = taken.get(a['target']['node'], 0) + 1
        for a in mine:
            if a['id'] not in g.armies:
                continue
            try:
                self.army_think(a, taken)
            except Exception:
                a['path'] = []
                a['state'] = 'idle'

    def army_think(self, a, taken):
        g, code = self.g, self.code
        if a['state'] == 'battle':
            bt = g.battles.get(a['battle'])
            if bt:
                si = 0 if a['id'] in bt['sides'][0]['armies'] else 1
                mine = g.side_men(bt, si)
                theirs = g.side_men(bt, 1 - si)
                if theirs > 3.0 * mine and g.side_morale(bt, si) < 40:
                    g.order_retreat(code, a['id'])
            return
        if a['state'] == 'siege':
            nid = a['at_node']
            if nid is None:
                return
            n = g.nodes[nid]
            ratio = g.army_power(a) / max(1.0, g.node_defense_power(nid))
            has_art = any(r['type'] == 'artillerie' for r in a['regs'])
            dur = g.t - (n['siege']['since'] if n['siege'] else g.t)
            dmg = n['siege']['dmg'] if n['siege'] else 0
            if (n['fort'] == 0 and ratio > 1.5) or (dmg >= 0.6 and ratio > 1.5) or (dur > 45 and ratio > 1.2) \
                    or (ratio > 6 and dmg >= 0.3):
                g.assault(code, a['id'])
            elif ratio < 0.6:
                g.order_retreat(code, a['id'])
            return
        if a['state'] in ('move', 'retreat'):
            tgt = a['target'] or {}
            nid = tgt.get('node')
            if nid is not None and a['state'] == 'move':
                o = g.nodes[nid]['owner']
                if o != code and o != R.NEUTRAL and not g.at_war(code, o) and not g.friendly(code, o):
                    a['path'] = []
                    a['state'] = 'idle'
            return
        # au repos
        ai = a['ai'] or {}
        if a['stance'] == 'embuscade':
            if g.t < ai.get('until', 0) and self.wars():
                return
            a['stance'] = 'normal'
        men = g.army_men(a)
        mx = sum(r['max'] for r in a['regs'])
        if ai.get('then') == 'garrison' and a['at_node'] is not None and g.nodes[a['at_node']]['owner'] == code:
            g.to_garrison(code, a['id'])
            return
        if men < 0.45 * mx or a['supply'] < 0.25:
            home = self.home_node(a)
            if home is not None and home != a['at_node']:
                if g.order_move(code, a['id'], node=home)[0]:
                    a['ai'] = dict(then='garrison')
                    return
            elif home is not None:
                g.to_garrison(code, a['id'])
                return
        # défense
        best = None
        for n in g.owned_nodes(code):
            th = self.threat_at(n['id'], 30)
            if th <= 0:
                continue
            dfn = g.node_defense_power(n['id'], include_armies=False)
            if th > dfn * 0.8:
                d = math.hypot(*(p - q for p, q in zip(g.node_xy(n['id']), (a['x'], a['y']))))
                typ = g.geo.nodes[n['id']]['type']
                val = VALUE[typ] * th / (d + 10) * (3 if typ == 'capitale' else 1)
                if d < (160 if typ == 'capitale' else 90) and (best is None or val > best[0]):
                    best = (val, n['id'])
        if best and best[1] != a['at_node']:
            if g.order_move(code, a['id'], node=best[1])[0]:
                return
        elif best:
            return
        # embuscade
        wars = self.wars()
        n_legere = sum(1 for r in a['regs'] if r['type'] == 'legere')
        amb_chance = 0.12 + (0.25 if code == '40' else 0) + 0.08 * n_legere
        if wars and self.rng.random() < amb_chance and not any(r['type'] == 'artillerie' for r in a['regs']):
            if self.try_ambush(a, wars):
                return
        # conquête / expansion, sinon ralliement au front
        if not self.pick_target(a, taken, wars):
            r = self.rally
            if r is not None and r != a['at_node']:
                g.order_move(code, a['id'], node=r)

    def rally_node(self):
        g, code = self.g, self.code
        wars = self.wars()
        own = [n['id'] for n in g.owned_nodes(code) if not n['siege']]
        if not own:
            return None
        if not wars:
            neutral = [n['id'] for n in g.nodes if n['owner'] == R.NEUTRAL]
            if not neutral:
                return g.capital_of(code) if g.nodes[g.capital_of(code)]['owner'] == code else own[0]
            targets = neutral
        else:
            targets = [n['id'] for n in g.nodes if n['owner'] in wars]
            if not targets:
                return None
        best = None
        for i in own:
            x, y = g.node_xy(i)
            d = min(math.hypot(x - g.node_xy(t)[0], y - g.node_xy(t)[1]) for t in targets)
            typ = g.geo.nodes[i]['type']
            d -= {'capitale': 6, 'ville': 4, 'fort': 3, 'village': 0}[typ]
            if best is None or d < best[0]:
                best = (d, i)
        return best[1]

    def home_node(self, a):
        g = self.g
        best = None
        for n in g.owned_nodes(self.code):
            gn = g.geo.nodes[n['id']]
            if gn['type'] not in ('capitale', 'ville') or n['siege']:
                continue
            d = math.hypot(gn['x'] - a['x'], gn['y'] - a['y'])
            if best is None or d < best[0]:
                best = (d, n['id'])
        return best[1] if best else None

    def pick_target(self, a, taken, wars):
        g, code = self.g, self.code
        p_army = g.army_power(a)
        expand = self.pers['expand']
        cands = []
        for n in g.nodes:
            o = n['owner']
            if o == code:
                continue
            if o != R.NEUTRAL and o not in wars:
                continue
            gn = g.geo.nodes[n['id']]
            d = math.hypot(gn['x'] - a['x'], gn['y'] - a['y'])
            if d > 220:
                continue
            dfn = g.node_defense_power(n['id'])
            need = dfn * (1.25 if o == R.NEUTRAL else 1.3)
            if n['fort'] >= 1 and any(r['type'] == 'artillerie' for r in a['regs']):
                need /= 1 + 0.25 * n['fort']
            if n['siege'] and n['siege']['by'] == code:
                need *= 0.5
            if p_army < need:
                continue
            val = VALUE[gn['type']] + 1.5 * len(gn['spec'])
            if o == R.NEUTRAL:
                if gn['dept'] != code and gn['dept'] in g.factions and g.t < 45:
                    continue   # les premières semaines, chacun rallie d'abord ses propres villages
                val *= 0.8 + expand
                if gn['dept'] == code:
                    val *= 1.6
            else:
                val *= 1.3
                if gn['type'] == 'capitale':
                    val *= 1.8
            sc = val / (d + 15)
            k = taken.get(n['id'], 0)
            if k and gn['type'] != 'capitale':
                sc *= 0.25 / k
            cands.append((sc, n['id']))
        cands.sort(reverse=True)
        for sc, nid in cands[:4]:
            ok, _ = g.order_move(code, a['id'], node=nid)
            if ok:
                taken[nid] = taken.get(nid, 0) + 1
                a['ai'] = None
                return True
        return False

    def try_ambush(self, a, wars):
        g, code = self.g, self.code
        # un chemin qui relie une de nos villes à une ville ennemie
        front = []
        for e in g.geo.edges:
            if e.get('kind') == 'water':
                continue
            oa, ob = g.nodes[e['a']]['owner'], g.nodes[e['b']]['owner']
            if oa == code and ob in wars:
                front.append((e, e['a'], e['b']))
            elif ob == code and oa in wars:
                front.append((e, e['b'], e['a']))
        if not front:
            return False
        self.rng.shuffle(front)
        for e, mine, theirs in front[:6]:
            mx, my = g.node_xy(mine)
            tx, ty = g.node_xy(theirs)
            if math.hypot(mx - a['x'], my - a['y']) > 60:
                continue
            for _ in range(10):
                f = self.rng.uniform(0.3, 0.6)
                px, py = mx + (tx - mx) * f, my + (ty - my) * f
                L = math.hypot(tx - mx, ty - my) or 1
                off = self.rng.choice((-1, 1)) * self.rng.uniform(1.5, 3.2)
                px += -(ty - my) / L * off
                py += (tx - mx) / L * off
                ter = g.geo.terrain_at(px, py)
                if TERRAIN[ter][2] and g.geo.playable_at(px, py) and not g.geo.road[g.geo.cell(px, py)]:
                    ok, _ = g.order_move(code, a['id'], x=px, y=py, mode='champs')
                    a['mode'] = 'route'
                    if ok:
                        a['ai'] = dict(then='embuscade', until=g.t + 30)
                        return True
        return False

    # ------------------------------------------------------------------ diplomatie
    def diplomacy(self):
        g, code, f = self.g, self.code, self.f
        aggr = self.pers['aggr'] * R.DIFFICULTY[g.difficulty]['ai_aggr']
        pa = max(1.0, g.faction_power(code))
        wars = self.wars()
        heg = g.hegemon()
        for o, of in g.factions.items():
            if o == code or not of['alive']:
                continue
            rel = f['rel'][o]
            st = g.status(code, o)
            # dérive des relations
            delta = -0.03 * rel
            if o in f['trade']:
                delta += 1.5
            if any(g.at_war(code, x) and g.at_war(o, x) for x in wars):
                delta += 2.0
            if st == 'guerre':
                delta -= 1.0
            if st == 'paix' and D.borders(g, code, o):
                delta -= 1.2
            if heg and o == heg:
                delta -= 1.5   # équilibre des puissances : on se méfie de qui domine l'Aquitaine
            elif heg and heg != code and g.at_war(o, heg):
                delta += 1.5
            f['rel'][o] = max(-100, min(100, rel + delta))
            rel = f['rel'][o]
            # cartel d'échange : on récupère ses hommes prisonniers
            if D.held(g, o, code) >= 40 and rel > -70 and self.rng.random() < 0.3:
                self.propose(o, 'prisonniers')
            if f['overlord']:
                continue
            po = max(1.0, g.faction_power(o))
            weary = f.get('weary', 0)
            # années depuis la dernière paix : l'envie de guerre revient peu à peu (deux siècles à jouer)
            calm = (g.t - f.get('last_war', 0.0)) / 365
            pace = R.WAR_PACE * min(1.0, calm / R.WAR_REST)
            if st == 'guerre':
                days = g.t - f['war_since'].get(o, g.t)
                if (pa < 0.65 * po and days > 25) or (days > 180 and self.rng.random() < 0.25) \
                        or (weary > 55 and days > 60 and self.rng.random() < weary / 150):
                    trib = int(min(f['res']['livres'] * 0.3, 250)) if pa < 0.5 * po else 0
                    self.propose(o, 'paix', trib)
                elif po < 0.3 * pa and D.lost_nodes(g, o) >= 2 and o != g.player and self.rng.random() < 0.5:
                    D.act(g, code, o, 'soumission')
            elif st == 'paix':
                if g.t > 120 and len(wars) < 2 and o not in f['truce'] and D.borders(g, code, o) and not of['overlord'] == code \
                        and weary < 35:
                    want = (rel < -20 and pa > 1.15 * po and self.rng.random() < aggr * 0.55 * pace) or \
                        (rel < 15 and pa > 1.7 * po and self.rng.random() < aggr * 0.3 * pace) or \
                        (calm > 8 and rel < 25 and pa > 1.05 * po and self.rng.random() < aggr * min(0.1, calm / 80))
                    weak_target = any(g.at_war(o, x) for x in g.factions if x != code) and pa > 1.3 * po \
                        and self.rng.random() < aggr * 0.25 * pace
                    # coalition : quand la puissance dominante est déjà en guerre, ses voisins se joignent à l'hallali
                    coalition = o == heg and any(g.at_war(o, x) for x in g.factions if x != code) \
                        and self.rng.random() < aggr * 0.2
                    want = want or coalition
                    if want or weak_target:
                        D.declare_war(g, code, o)
                        wars = self.wars()
                        continue
                if o not in f['trade'] and rel > 5 and self.rng.random() < self.pers['trade'] * 0.5:
                    self.propose(o, 'commerce')
                elif (rel > 40 or (heg and heg not in (code, o) and rel > 0)) and self.rng.random() < 0.35 \
                        and any(g.at_war(code, x) and g.at_war(o, x) for x in g.factions):
                    self.propose(o, 'alliance')
            # échange de ressources avec le joueur de temps en temps
            if o == g.player and st != 'guerre' and rel > 10 and self.rng.random() < 0.12:
                r = f['res']
                surplus = max(('vivres', 'fer', 'bois', 'outils'), key=lambda k: r[k])
                need = min(('vivres', 'fer', 'bois', 'armes'), key=lambda k: r[k] / max(0.1, D.BASE_VALUE[k]))
                if surplus != need and r[surplus] > 200:
                    q = int(min(r[surplus] * 0.25, 150))
                    want_q = int(q * D.BASE_VALUE[surplus] / D.BASE_VALUE[need] * 0.9)
                    if want_q > 0:
                        self.propose(o, 'echange', give=(surplus, q), get=(need, want_q))

    def propose(self, o, action, amount=0, give=None, get=None):
        g = self.g
        k = (o, action)
        if g.t < self.cool.get(k, -1):
            return
        self.cool[k] = g.t + (40 if o == g.player else 20)
        if o == g.player and any(p['frm'] == self.code and p['action'] == action for p in g.proposals):
            return
        D.act(g, self.code, o, action, amount, give, get)
