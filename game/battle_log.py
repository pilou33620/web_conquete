"""Journal des batailles, pour régler l'équilibre : une ligne JSON par bataille dans logs/batailles.jsonl.

Toutes les batailles y passent : résolues automatiquement (y compris entre IA), commandées, et celles du mode Bataille.
Chaque ligne donne le contexte (date, saison, météo, terrain, place et fortification), les forces des deux camps au
début, le déroulement (durée, brèches ouvertes au canon) et le résultat (vainqueur, pertes, prisonniers, prise de la
place). outils/bilan.py en tire des tableaux. Le journal ne doit jamais gêner la partie : une erreur d'écriture est
ignorée, et le fichier est mis de côté (batailles.1.jsonl) au-delà de MAX_BYTES.
"""
import json
import os
import time
import traceback

from . import rules as R
from . import army_actions as AA

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_DIR = os.path.join(ROOT, 'logs')
LOG_FILE = os.path.join(LOG_DIR, 'batailles.jsonl')
MAX_BYTES = 20 * 1024 * 1024
ENABLED = True


def write(rec):
    if not ENABLED:
        return
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > MAX_BYTES:
            os.replace(LOG_FILE, os.path.join(LOG_DIR, 'batailles.1.jsonl'))
        rec['ts'] = time.strftime('%Y-%m-%d %H:%M:%S')
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False, separators=(',', ':')) + '\n')
    except Exception:
        traceback.print_exc()


def _regs(regs, out):
    for r in regs:
        out['comp'][r['type']] = out['comp'].get(r['type'], 0) + 1
        out['men'] += r['n']
        cls = R.UNITS.get(r['type'], {}).get('cls', 'inf')
        out['arm'][cls] = max(out['arm'].get(cls, 0), int(r.get('arm') or 0))
        out['_xp'] += r.get('xp', 0) * r['n']
        out['_mor'] += r.get('morale', 70) * r['n']


# ================================================================== campagne
def snapshot(g, bt):
    """Forces des deux camps au début d'une bataille de campagne (engine.start_battle)."""
    try:
        sides = []
        for s in bt['sides']:
            d = dict(owner=s['owner'], comp={}, men=0.0, arm={}, gens=[], armies=len(s['armies']), _xp=0.0, _mor=0.0)
            for aid in s['armies']:
                a = g.armies.get(aid)
                if not a:
                    continue
                _regs(a['regs'], d)
                if a.get('gen'):
                    d['gens'].append([a['gen'].get('trait'), a['gen'].get('lvl', 1)])
                d['plan'] = a.get('pl')
                d['fm'] = a.get('fm')
            if s['node'] is not None:
                n = g.nodes[s['node']]
                gar = dict(comp={}, men=0.0, arm={}, _xp=0.0, _mor=0.0)
                _regs(n['garrison'], gar)
                d.update(garrison=gar['comp'], garrison_men=round(gar['men']), milice=round(n['milice']),
                         fort=n['fort'], fort_eff=round(AA.fort_eff(g, n), 2), guns=g.fort_guns(n),
                         breach0=round(AA.breach(n), 2))
                d['_xp'] += gar['_xp']
                d['_mor'] += gar['_mor']
                d['men'] += gar['men']
            m = max(1.0, d['men'])
            d['xp'] = round(d.pop('_xp') / m, 1)
            d['morale'] = round(d.pop('_mor') / m, 1)
            d['men'] = round(d['men'])
            sides.append(d)
        zone = g.zone_of(bt['x'], bt['y'])
        place = None
        if bt['node'] is not None:
            gn = g.geo.nodes[bt['node']]
            place = dict(id=bt['node'], name=gn['name'], type=gn['type'])
        return dict(date=g.date_str(), year=g.date().year, t0=round(g.t, 2), season=g.season(),
                    weather=g.weather[zone]['kind'], zone=zone, terrain=bt.get('terrain'), place=place,
                    ambush=bool(bt.get('ambush')), landing=bool(bt.get('landing')), sides=sides,
                    player=next((i for i, s in enumerate(bt['sides']) if s['owner'] == g.player), None),
                    difficulty=g.difficulty, scenario=getattr(g, 'scenario', None))
    except Exception:
        traceback.print_exc()
        return None


def campaign_end(g, bt, winner, disengage, prisoners, tb=None):
    """Fin d'une bataille de campagne (engine.end_battle) : automatique, ou commandée (tb : la bataille tactique)."""
    try:
        rec = dict(bt.get('log0') or {})
        rec.update(kind='campagne', mode='commandee' if bt.get('tac') else 'auto', id=bt['id'],
                   days=round(g.t - bt.get('t0', g.t), 3), winner=winner, winner_owner=bt['sides'][winner]['owner'],
                   disengage=bool(disengage), captured=bool(not disengage and bt['sides'][1 - winner]['node'] is not None
                                                          and winner == 0),
                   men0=[round(s['men0']) for s in bt['sides']], lost=[round(s['lost']) for s in bt['sides']],
                   prisoners=int(prisoners), assault=bt['node'] is not None)
        if tb is not None:
            rec['tac'] = tactical(tb)
        write(rec)
    except Exception:
        traceback.print_exc()


# ================================================================== batailles tactiques
def tactical(tb):
    """Déroulement d'une bataille tactique : durée, brèches, pertes et état des unités à la fin."""
    r = tb.result or {}
    sides = []
    for s in (0, 1):
        us = [u for u in tb.units if u.side == s]
        comp = {}
        for u in us:
            if u.cls in ('general', 'chariot'):
                continue
            k = 'rempart' if u.src == 'rempart' else u.type
            comp[k] = comp.get(k, 0) + 1
        fight = [u for u in us if u.cls not in ('general', 'chariot')]
        sides.append(dict(comp=comp, men0=round(sum(u.men0 for u in fight)),
                          men=round(sum(max(0.0, u.men) for u in fight)),
                          routed=sum(1 for u in fight if u.state == 'deroute'),
                          out=sum(1 for u in fight if u.state == 'hors'),
                          ctrl='joueur' if any(u.ctrl == 'joueur' for u in us) else 'ia'))
    pl = tb.place_info()
    return dict(clock=round(tb.clock), accel=bool(tb.accel), accel_t=round(tb.accel_t) if tb.accel else None,
                weather=tb.weather, season=tb.season, year=tb.spec.get('year'), difficulty=tb.difficulty,
                place=dict(fort=pl['fort'], r=pl['r']) if pl else None,
                guns=sum(1 for u in tb.units if u.src == 'rempart'),
                breaches=[[round(t), k] for t, k in getattr(tb, 'breach_t', [])],
                winner=r.get('winner'), disengage=bool(r.get('disengage')), why=r.get('why'),
                lost=[round(x) for x in r.get('lost', [0, 0])], prisoners=[round(x) for x in r.get('prisoners', [0, 0])],
                me=tb.me, sides=sides)


def skirmish_end(tb):
    """Fin d'une bataille du mode Bataille (game/tactics/skirmish.py)."""
    try:
        sp = tb.spec
        write(dict(kind='bataille', mode='bataille', id=tb.bid, title=sp.get('title'), year=sp.get('year'),
                   season=sp.get('season'), weather=sp.get('weather'), owners=sp.get('owners'),
                   difficulty=sp.get('difficulty'), sk=sp.get('sk'), tac=tactical(tb)))
    except Exception:
        traceback.print_exc()
