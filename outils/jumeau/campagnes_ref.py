"""Jumeau des campagnes entières (game/engine.py et tout ce qu'il appelle : IA, villes, événements, familles, chemins de
fer, crues, et le pont des batailles tactiques) : des parties créées (Game(...)) puis jouées mois par mois comme
tests/fabrique.py jouer_mois (TT.go, TT.advance, interruptions acceptées d'office), et des escarmouches (skirmish.new)
jouées jusqu'au bout. Écrit rust/conquete/tests/references/campagnes.json, relu par rust/conquete/tests/campagnes.rs.

    python3 outils/jumeau/campagnes_ref.py                       # écrit la référence
    python3 outils/jumeau/campagnes_ref.py balayage <fichier>    # le balayage plus large (tiree, CONQUETE_BALAYAGE
                                                                 # parties), pour l'essai `balayage` (ignoré par défaut)
    python3 outils/jumeau/campagnes_ref.py chrono <nom> [<mois>] # le temps de la carte, de la création et de chaque mois
                                                                 # (l'essai Rust `chrono` en fait autant)
    python3 outils/jumeau/campagnes_ref.py <nom> <mois>          # diagnostic : l'empreinte de l'état après chaque pas
                                                                 # du mois qui suit le mois <mois> (pas à pas : un seul
                                                                 # g.step par appel de TT.advance), dans
                                                                 # $CONQUETE_DIAG/<nom>_<mois>_pas_py.json
    python3 outils/jumeau/campagnes_ref.py <nom> <mois> <pas>    # la forme complète (canon_ordre de views.to_dict) à ce
                                                                 # pas (-1 : à la fin du mois <mois>) dans
                                                                 # $CONQUETE_DIAG/<nom>_<mois>_<pas>_py.json, et la
                                                                 # trace du hasard du mois jusque-là (hasard_py.txt)

Deux façons de mener le camp du joueur (`mode`) :
- 'ia' : une IA le gouverne, comme les autres (outils/simuler.py : g.ais[g.player] = AI(g, g.player)) ; ses décisions
  (événements) sont prises comme le fait simuler.play_month : le premier choix qu'il peut payer ;
- 'rien' : le joueur ne fait rien (ses batailles attendent son choix, ses décisions restent en suspens) ;
- 'ordres' : personne ne gouverne le camp du joueur, mais il prend ses décisions (comme 'ia') et livre ses batailles
  (batailler) : « le général commande », ou « Donner mes ordres » et la bataille tactique jusqu'au bout. C'est par là
  que le pont des batailles (bridge.create_orders, make_spec, finish, retour en campagne) tourne en campagne : les
  batailles des IA entre elles se règlent sans lui (bridge.auto_battle_tick).

Par partie : `emp`, pour la création (mois 0) puis chaque fin de mois, [empreinte ordonnée de views.to_dict (16
chiffres), {clé de to_dict: 8 chiffres de son empreinte ordonnée}] (les clés, dans l'ordre de to_dict, disent le premier
champ qui diffère) ; la partie s'arrête à `mois` ou à sa fin (g.over).
Par escarmouche : l'empreinte de views.to_dict après skirmish.new et de la fenêtre des ordres, puis, ordres tirés au sort
donnés (bridge.set_orders(go=True, skip=True)) et la bataille menée par skirmish.tick jusqu'au bout (au moment décisif :
'go'), l'empreinte de views.to_dict, du résultat et de tb.result_view(0).

Ce qui varie en Python d'un lancement à l'autre (parcours de sets de textes) : le jumeau se relance avec
PYTHONHASHSEED=0 s'il ne l'a pas (sinon la référence change d'un lancement à l'autre). Les deux endroits connus
(engine.compute_income : dernier bit de `_douane`, rails.sabotage : l'ordre de deux lignes du journal) sont traités par
l'essai Rust (voir son en-tête).
"""
import os
import random
import sys

if 'PYTHONHASHSEED' not in os.environ:   # (avant tout : les sets de textes sont parcourus dans un ordre fixe ; une autre
    # valeur donnée exprès sert à voir ce qui en dépend)
    os.environ['PYTHONHASHSEED'] = '0'
    os.execv(sys.executable, [sys.executable] + sys.argv)

os.environ['WEB_CONQUETE_NOLOG'] = '1'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import commun  # noqa: E402

DIAG = len(sys.argv) in (3, 4) and sys.argv[1] not in ('balayage', 'chrono')
SORTIE = os.environ.get('CONQUETE_DIAG', '/tmp')
if DIAG and len(sys.argv) == 4:   # (avant d'importer game : le hasard tracé)
    TRACE = commun.tracer_hasard(os.path.join(SORTIE, 'hasard_py.txt'))

from game import events as E  # noqa: E402
from game import rules as R  # noqa: E402
from game import turns as TT  # noqa: E402
from game import views as V  # noqa: E402
from game.ai import AI  # noqa: E402
from game.engine import Game  # noqa: E402
from game.geo import GeoMap  # noqa: E402
from game.tactics import bridge as TB  # noqa: E402
from game.tactics import orders as OR  # noqa: E402
from game.tactics import skirmish as S  # noqa: E402

_GEOS = {}


def geo(v):
    if v not in _GEOS:
        _GEOS[v] = GeoMap(v)
    return _GEOS[v]


# nom, géographie, joueur, difficulté, graine, scénario, mode, mois
PARTIES = [
    # des campagnes longues
    ('g2_1790_ia', 2, '33', 'normal', 1, '1790', 'ia', 60),
    ('g2_1700_ia', 2, '64', 'difficile', 7, '1700', 'ia', 36),
    ('g2_1813_rien', 2, '24', 'facile', 3, '1813', 'rien', 36),
    ('g2_1870_ia', 2, '40', 'normal', 11, '1870', 'ia', 36),
    ('g3_1790_ia', 3, '33', 'normal', 1, '1790', 'ia', 12),
    ('g2_1813_ordres', 2, '24', 'facile', 3, '1813', 'ordres', 36),
    ('g2_1790_ordres', 2, '47', 'difficile', 2, '1790', 'ordres', 24),
    ('g2_1700_ordres', 2, '33', 'normal', 14, '1700', 'ordres', 24),
    ('g2_1870_ordres', 2, '64', 'normal', 15, '1870', 'ordres', 24),
    # quelques mois, beaucoup de parties
    ('g2_1790_rien', 2, '47', 'difficile', 2, '1790', 'rien', 12),
    ('g2_1700_rien', 2, '33', 'facile', 5, '1700', 'rien', 6),
    ('g2_1813_ia', 2, '64', 'normal', 8, '1813', 'ia', 6),
    ('g2_1870_rien', 2, '24', 'difficile', 9, '1870', 'rien', 6),
    ('g3_1700_rien', 3, '75', 'facile', 4, '1700', 'rien', 3),
    ('g3_1813_ia', 3, '13', 'difficile', 6, '1813', 'ia', 3),
    ('g3_1870_ia', 3, '69', 'normal', 12, '1870', 'ia', 3),
    ('g3_1790_rien', 3, '67', 'normal', 10, '1790', 'rien', 3),
    ('g3_1813_ordres', 3, '33', 'normal', 16, '1813', 'ordres', 3),
    ('g1_1790_ia', 1, '33', 'normal', 13, '1790', 'ia', 6),
    # la création seule
    ('c2_1700', 2, '24', 'normal', 21, '1700', 'rien', 0),
    ('c2_1790', 2, '40', 'facile', 22, '1790', 'rien', 0),
    ('c2_1813', 2, '33', 'difficile', 23, '1813', 'rien', 0),
    ('c2_1870', 2, '47', 'facile', 24, '1870', 'rien', 0),
    ('c3_1700', 3, '29', 'difficile', 25, '1700', 'rien', 0),
    ('c3_1790', 3, '06', 'facile', 26, '1790', 'rien', 0),
    ('c3_1813', 3, '59', 'normal', 27, '1813', 'rien', 0),
    ('c3_1870', 3, '64', 'difficile', 28, '1870', 'rien', 0),
    ('c1_1870', 1, '64', 'facile', 29, '1870', 'rien', 0),
    ('c1_1700', 1, '40', 'difficile', 30, '1700', 'rien', 0),
]

# nom, géographie, corps de skirmish.new
ESCARMOUCHES = [
    ('e2_1790', 2, dict(me='33', foe='24', era='1790', units=dict(ligne=3, legere=1, cavalerie=1, artillerie=1), seed=1)),
    ('e2_1813_place', 2, dict(me='24', foe='47', era='1813', kind='forteresse', seed=2,
                              units=dict(ligne=3, artillerie=1, sapeurs=1))),
    ('e2_1870_village_def', 2, dict(me='64', foe='40', era='1870', kind='village', role='def', seed=3,
                                    difficulty='difficile', units=dict(ligne=2, artillerie=1, mitrailleuses=1))),
    ('e2_1700_hiver', 2, dict(me='47', foe='64', era='1700', seed=4, season='hiver', weather='neige',
                              units=dict(ligne=2, cavalerie=2, artillerie=1))),
    ('e3_1790', 3, dict(me='75', foe='13', era='1790', seed=5, units=dict(ligne=2, legere=1, cavalerie=1, artillerie=1))),
    ('e3_1870_place', 3, dict(me='69', foe='67', era='1870', kind='forteresse', seed=6,
                              units=dict(ligne=3, artillerie=1, mitrailleuses=1))),
    ('e3_1813_def', 3, dict(me='59', era='1813', role='def', seed=7, difficulty='facile',
                            units=dict(ligne=2, grenadiers=1, cavalerie=1, artillerie=1))),
]


def tiree(k):
    """La partie tirée au sort numéro k (balayage)."""
    rng = random.Random(f'campagne{k}')
    v = rng.choice([2, 2, 2, 3])
    codes = [c for c in R.FACTIONS if c in geo(v).playable_codes]
    return (f'x{k}', v, rng.choice(codes), rng.choice(['facile', 'normal', 'difficile']), rng.randrange(1 << 30),
            rng.choice(['1700', '1790', '1813', '1870']), rng.choice(['ia', 'rien']), 24 if v == 2 else 4)


def neuve(p):
    _nom, v, joueur, diff, graine, scen, mode, _mois = p
    g = Game(geo(v), joueur, diff, graine, scen)
    if mode == 'ia':
        g.ais[g.player] = AI(g, g.player)   # le camp du joueur joué par une IA, comme les autres
    return g


def decider(g, mode):
    """'ia', 'ordres' : les décisions qui attendent le joueur, il les prend comme son IA (simuler.play_month)."""
    if mode == 'rien':
        return
    for x in list(g.pending_ev):
        ok = [i for i, c in enumerate(x['choices']) if E.affordable(g, g.player, c['fx'])]
        E.resolve(g, x['id'], ok[0] if ok else len(x['choices']) - 1, auto=True)


def batailler(g, mode):
    """'ordres' : les batailles du joueur, comme le serveur les mène (rend True si elle a agi : le mois attend). Une
    bataille tactique en cours avance (bridge.tick, 0,1 s ; au moment décisif : 'go') ; une bataille qui attend son
    choix (la première de g.battles) : « le général commande » (choose auto, une fois sur trois au hasard), ou « Donner
    mes ordres » (choose ordres, puis des ordres tirés au sort, go et skip). Le hasard du joueur vient de la bataille
    (random.Random(f'choix{bid}')), à part de celui du jeu. La bataille finie, le joueur reprend le mois (TT.go)."""
    if mode != 'ordres':
        return False
    if g.tactical:
        tb = next(iter(g.tactical.values()))
        if tb.ask:
            OR.answer(tb, 'go')
        TB.tick(g, 0.1)
        if not g.tactical:
            TT.go(g)   # la bataille finie : « Continuer le mois »
        return True
    bt = next((b for b in g.battles.values() if b.get('mode') == 'attente'), None)
    if bt is None:
        return False
    rng = random.Random(f"choix{bt['id']}")
    choix = 'auto' if rng.random() < 1 / 3 else 'ordres'
    r = TB.command(g, dict(sub='choose', bid=bt['id'], mode=choix))
    if r['ok'] and choix == 'ordres':
        tb = g.tactical[bt['id']]
        raw = {gr['key']: rng.choice(gr['opts'])['v'] for gr in OR.groups(tb, tb.me, TB._livres(g, tb))}
        TB.command(g, dict(sub='orders', orders=raw, go=True, skip=True))
    return True


def jouer_mois(g, mode):
    """tests/fabrique.py jouer_mois (et les décisions et les batailles du joueur, selon le mode)."""
    TT.go(g)
    for _ in range(1000000):
        if g.tour['end'] is None or g.over:
            return
        decider(g, mode)
        if batailler(g, mode):
            continue
        TT.advance(g, 1.0)
        if g.tour['stop']:
            TT.go(g)
    raise AssertionError('le tour des IA ne finit pas')


def un_pas(g):
    """TT.advance réduit à un seul g.step (diagnostic : le même déroulé, découpé pas à pas). Rend False à la fin du mois."""
    from game.engine import SUBSTEP
    tr = g.tour
    if g.over:
        return False
    if not g.speed_idx:
        if tr['end'] is None or not TT._settled(g):
            return tr['end'] is not None
        TT.go(g)
    if tr['end'] is None:
        TT.go(g)
    sub = SUBSTEP if g.battles else SUBSTEP * 2
    rem = tr['end'] - g.t
    seq0 = g.seq
    if rem <= sub + 1e-6:
        g.step(max(rem, 0.0) + 1e-9)
        g.t = tr['end']
        TT.watch(g, rem, seq0)
        TT.finish(g)
        return False
    g.step(sub)
    TT.watch(g, sub, seq0)
    return True


def jouer_mois_pas(g, mode, rappel):
    """jouer_mois, pas à pas : rappel(n) après chaque pas n (0, 1…) ; s'arrête quand rappel rend True."""
    TT.go(g)
    n = 0
    while g.tour['end'] is not None and not g.over:
        decider(g, mode)
        if batailler(g, mode):
            while g.tactical:   # (la bataille tactique d'un coup : bridge.tick avance selon un budget de temps)
                batailler(g, mode)
            if rappel(n):
                return
            n += 1
            continue
        encore = un_pas(g)
        if g.tour['stop']:
            TT.go(g)
        if rappel(n):
            return
        n += 1
        if not encore and g.tour['end'] is None:
            return


SABOTAGE = 'coupe la voie ferrée'


def journal(events):
    """Le journal, les lignes d'un même sabotage (rails.sabotage : `for who in {code} | {…}` parcourt un set de textes,
    dans un ordre qui dépend de PYTHONHASHSEED) rangées par camp (who), leurs numéros (seq) gardés dans l'ordre. Rien
    d'autre n'est touché. Le même en Rust (tests/campagnes.rs : journal)."""
    out = list(events)
    i = 0
    while i < len(out):
        e, j = out[i], i + 1
        if e['kind'] == 'rail' and SABOTAGE in e['text']:
            while j < len(out) and out[j]['kind'] == 'rail' and out[j]['text'] == e['text'] and out[j]['t'] == e['t']:
                j += 1
            if j - i > 1:
                seqs = [x['seq'] for x in out[i:j]]
                out[i:j] = [dict(x, seq=s) for s, x in zip(seqs, sorted(out[i:j], key=lambda x: str(x['who'])))]
        i = j
    return out


def etat(g):
    """views.to_dict, le journal pris par journal()."""
    d = V.to_dict(g)
    d['events'] = journal(d['events'])
    return d


def empreintes(g):
    d = etat(g)
    return [commun.empreinte_ordre(d)[:16], {k: commun.empreinte_ordre(v)[:8] for k, v in d.items()}]


def jouer(p):
    nom, _v, _j, _d, _g, _s, mode, mois = p
    g = neuve(p)
    emp = [empreintes(g)]
    for m in range(mois):
        if g.over:
            break
        jouer_mois(g, mode)
        emp.append(empreintes(g))
    return dict(nom=nom, geo=p[1], joueur=p[2], difficulte=p[3], graine=p[4], scenario=p[5], mode=mode, mois=mois,
                emp=emp, date=g.date_str(), over=bool(g.over), guerres=sum(1 for v in g.diplo.values() if v == 'guerre'),
                batailles=g.seq)


def ordres_tires(g, tb, nom):
    rng = random.Random(f'ordres{nom}')
    return {gr['key']: rng.choice(gr['opts'])['v'] for gr in OR.groups(tb, tb.me, TB._livres(g, tb))}


def escarmouche(e):
    nom, v, body = e
    g, bid = S.new(geo(v), body)
    assert g is not None, bid
    tb = g.tactical[bid]
    r = dict(nom=nom, geo=v, body=body, neuve=commun.empreinte_ordre(V.to_dict(g)),
             fenetre=commun.empreinte_ordre(TB.orders_view(g, tb)))
    raw = ordres_tires(g, tb, nom)
    r['ordres'] = raw
    r['set_orders'] = TB.set_orders(g, tb, raw, go=True, skip=True)
    n = 0
    while bid in g.tactical:
        if tb.ask:
            OR.answer(tb, 'go')
        S.tick(g, 0.1)
        n += 1
        assert n < 1000000
    r.update(fin=commun.empreinte_ordre(V.to_dict(g)), phase=tb.phase, clock=tb.clock, result=tb.result,
             view=commun.empreinte_ordre(tb.result_view(0)) if tb.result else None)
    return r


def trouver(nom):
    return tiree(int(nom[1:])) if nom[0] == 'x' else next(p for p in PARTIES if p[0] == nom)


def diag(nom, mois, pas=None):
    import json
    p = trouver(nom)
    mode = p[6]
    g = neuve(p)
    for _ in range(mois):
        jouer_mois(g, mode)
    if pas is None:
        hs = []
        jouer_mois_pas(g, mode, lambda n: hs.append(commun.empreinte_ordre(V.to_dict(g))[:16]) and False)
        f = os.path.join(SORTIE, f'{nom}_{mois}_pas_py.json')
        with open(f, 'w') as s:
            json.dump(hs, s)
        print(f, len(hs), 'pas')
        return
    TRACE.truncate(0)
    TRACE.seek(0)
    if pas >= 0:
        jouer_mois_pas(g, mode, lambda n: n == pas)
    TRACE.close()
    f = os.path.join(SORTIE, f'{nom}_{mois}_{pas}_py.json')
    with open(f, 'w', encoding='utf-8') as s:
        s.write(commun.canon_ordre(etat(g)))
    print(f, os.path.join(SORTIE, 'hasard_py.txt'))


def main():
    import json
    import time
    if DIAG:
        diag(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) == 4 else None)
        return
    if sys.argv[1:2] == ['chrono']:   # (comme l'essai Rust `chrono`)
        p = trouver(sys.argv[2])
        t = time.time()
        geo(p[1])
        print(f'carte {p[1]} relue du cache : {time.time() - t:.2f} s')
        t = time.time()
        g = neuve(p)
        print(f'partie créée : {time.time() - t:.3f} s')
        for m in range(1, int(sys.argv[3]) + 1 if len(sys.argv) > 3 else 2):
            t = time.time()
            jouer_mois(g, p[6])
            print(f'mois {m} : {time.time() - t:.2f} s')
        return
    if sys.argv[1:2] == ['balayage']:
        out = []
        for k in range(int(os.environ.get('CONQUETE_BALAYAGE', 12))):
            t = time.time()
            r = jouer(tiree(k))
            print(r['nom'], r['geo'], r['scenario'], r['mode'], len(r['emp']) - 1, 'mois', r['date'], f'{time.time() - t:.1f} s')
            out.append(r)
        with open(sys.argv[2], 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        return
    ref = dict(parties=[], escarmouches=[])
    for p in PARTIES:
        t = time.time()
        r = jouer(p)
        print(r['nom'], len(r['emp']) - 1, 'mois', r['date'], r['guerres'], 'guerres', f'{time.time() - t:.1f} s')
        ref['parties'].append(r)
    for e in ESCARMOUCHES:
        t = time.time()
        r = escarmouche(e)
        print(r['nom'], r['phase'], r['result'] and r['result'].get('why'), f'{time.time() - t:.1f} s')
        ref['escarmouches'].append(r)
    commun.ecrire('campagnes', ref)


if __name__ == '__main__':
    main()
