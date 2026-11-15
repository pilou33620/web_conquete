"""Jumeau des batailles entières (game/tactics/ : battle, ai, units, orders, terrain…) : des escarmouches du mode
Bataille (skirmish.new, géographie 2), rejouées pas à pas. Écrit rust/conquete/tests/references/batailles.json, relu
par rust/conquete/tests/batailles.rs.

    python3 outils/jumeau/batailles_ref.py                 # écrit la référence
    python3 outils/jumeau/batailles_ref.py balayage <n> <k0> <fichier>   # n batailles tirées au sort (x<k0>…) dans
                                                           # <fichier>, pour l'essai `balayage` (ignoré par défaut)
    python3 outils/jumeau/batailles_ref.py <nom> <pas>     # écrit la forme complète (canon_ordre) de ce que l'empreinte
                                                           # range au pas donné dans $CONQUETE_DIAG (défaut /tmp), et la
                                                           # trace du hasard jusqu'à ce pas (hasard_py.txt)

Trois façons de mener une bataille (`mode`) :
- 'ia' : l'IA des deux camps (toutes les unités en ctrl 'ia', ai_sides [0, 1], spec['me'] None) ;
- 'joueur' : le camp 0 a une unité sur deux sous les ordres du « joueur », l'IA mène le reste ; le joueur donne un
  ordre tiré au sort tous les 25 pas (tb.order, who='joueur' : toutes les sortes d'ordres, y compris d'impossibles),
  parfois « Finir automatiquement » puis reprend la main, parfois fait décrocher son camp. Ses actes sont rangés
  (`actes` : [pas, sorte, arguments…, réponse]) et rejoués tels quels par l'essai Rust, qui compare les réponses ;
- 'ordres' : « Donner mes ordres » (bridge.create_orders) : des ordres tirés au sort (`ordres`, nettoyés par
  orders.clean avec `livres`), puis ce que fait bridge.set_orders(go=True) (sans la partie) ; au moment décisif
  (tb.ask), la réponse est 'go' ou 'wait' selon le pas (pas // PAS impair : 'go').

Chaque bataille est rangée par son état de départ (`depart` : tb.to_dict() tel quel, flottants à la repr), pris
AVANT le déploiement (les unités pas encore placées sont à x = y = 0.0, comme bridge.default_deploy les reconnaît ;
'ordres' : déployée par create_orders, ordres pas encore donnés), ou, pour les « reprises », au milieu d'une bataille
(l'aller-retour des sauvegardes). Les deux côtés relisent cet état (TacticalBattle.from_dict : la carte se refait de la
graine, battle.rng repart de la sienne), engagent la bataille si besoin (relue), puis font les mêmes pas (tb.step()) ;
`relu` : l'empreinte ordonnée de from_dict(depart).to_dict() (l'aller-retour des sauvegardes, avant tout pas) ;
`emp` : les 16 premiers chiffres de commun.empreinte_ordre(dict(etat=tb.to_dict(), vue=tb.view(0, since))) tous les
PAS pas (le premier au pas 0 ; since : tb.seq à l'empreinte d'avant), puis à la fin le résultat (tb.result) et
tb.result_view(0).
"""
import json
import os
import random
import sys

os.environ['WEB_CONQUETE_NOLOG'] = '1'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import commun  # noqa: E402

DIAG = len(sys.argv) == 3
if DIAG:   # (avant d'importer game : le hasard tracé)
    SORTIE = os.environ.get('CONQUETE_DIAG', '/tmp')
    TRACE = commun.tracer_hasard(os.path.join(SORTIE, 'hasard_py.txt'))

from game.geo import GeoMap  # noqa: E402
from game.tactics import ai as AI  # noqa: E402
from game.tactics import battle as BT  # noqa: E402
from game.tactics import bridge as TB  # noqa: E402
from game.tactics import orders as OR  # noqa: E402
from game.tactics import skirmish as S  # noqa: E402

GEO = GeoMap(2)
PAS = 10          # une empreinte tous les PAS pas
LIMITE = 3000     # pas au plus par bataille (6 000 s de bataille)
ACTE = 25         # le joueur agit tous les ACTE pas
LIVRES = 100      # le trésor du joueur (orders.clean : les faux déserteurs coûtent orders.FEINT_COST)
# (bridge.set_orders : le texte de la ruse des faux déserteurs)
DESERTEURS = "des déserteurs annoncent l'attaque sur l'aile : la réserve et la cavalerie s'y portent."
KINDS = ['move', 'move', 'attack', 'attack', 'charge', 'hold', 'fire', 'stop', 'volley_charge', 'harass', 'cover',
         'maisons', 'barricade', 'pursue', 'shot', 'counter', 'form', 'rally', 'retreat', 'bombard', 'inconnu']

# nom, corps de skirmish.new (sans mode), reprise (pas au bout duquel on prend l'état de départ ; None : avant le
# déploiement), mode
BATAILLES = [
    ('1790_campagne', dict(me='33', foe='24', era='1790', units=dict(ligne=3, legere=1, cavalerie=1, artillerie=1),
                           seed=1), None, 'ia'),
    ('1700_hiver_facile', dict(me='24', foe='40', era='1700', units=dict(ligne=2, cavalerie=2, artillerie=1), seed=2,
                               season='hiver', weather='neige', difficulty='facile'), None, 'ia'),
    ('1813_defense_pluie', dict(me='47', foe='33', era='1813', role='def', seed=3, season='automne', weather='pluie',
                                difficulty='difficile',
                                units=dict(ligne=2, grenadiers=1, legere=1, cavalerie=1, artillerie=2)), None, 'ia'),
    ('1870_canicule', dict(me='40', foe='47', era='1870', seed=4, season='été', weather='canicule',
                           units=dict(ligne=2, mitrailleuses=1, artillerie=1, cavalerie=1, legere=1)), None, 'ia'),
    ('1870_assaut_place', dict(me='33', foe='64', era='1870', kind='forteresse', seed=5,
                               units=dict(ligne=3, artillerie=1, mitrailleuses=1)), None, 'ia'),
    ('1790_defense_place', dict(me='64', foe='33', era='1790', kind='forteresse', role='def', seed=6,
                                units=dict(ligne=3, garde=1, artillerie=1)), None, 'ia'),
    ('1813_assaut_village', dict(me='24', foe='47', era='1813', kind='village', seed=7,
                                 units=dict(ligne=2, legere=2, sapeurs=1)), None, 'ia'),
    ('1700_defense_village', dict(me='64', foe='24', era='1700', kind='village', role='def', seed=8,
                                  difficulty='facile', units=dict(ligne=2, chasseurs=1, artillerie=1)), None, 'ia'),
    ('1790_brouillard_facile', dict(me='33', foe='40', era='1790', seed=9, weather='brouillard', difficulty='facile',
                                    units=dict(ligne=2, legere=1, cavalerie=2, artillerie=1, suisses=1)), None, 'ia'),
    ('1813_orage_difficile', dict(me='47', foe='24', era='1813', seed=10, season='automne', weather='orage',
                                  difficulty='difficile', units=dict(ligne=3, cavalerie=2, artillerie=2)), None, 'ia'),
    ('1870_defense_tempete', dict(me='64', foe='33', era='1870', role='def', seed=11, weather='tempete',
                                  units=dict(ligne=2, legion=1, artillerie=1, mitrailleuses=1, chasseurs=1)), None,
     'ia'),
    ('1790_assaut_difficile', dict(me='40', foe='33', era='1790', kind='forteresse', seed=12, difficulty='difficile',
                                   units=dict(ligne=2, grenadiers=1, artillerie=1, sapeurs=1)), None, 'ia'),
    ('1790_reprise', dict(me='33', foe='24', era='1790', units=dict(ligne=3, legere=1, cavalerie=1, artillerie=1),
                          seed=1), 300, 'ia'),
    ('1870_place_reprise', dict(me='33', foe='64', era='1870', kind='forteresse', seed=5,
                                units=dict(ligne=3, artillerie=1, mitrailleuses=1)), 400, 'ia'),
    ('1813_joueur', dict(me='33', foe='24', era='1813', seed=21,
                         units=dict(ligne=3, legere=2, cavalerie=2, artillerie=2, grenadiers=1)), None, 'joueur'),
    ('1870_joueur_place', dict(me='47', foe='40', era='1870', kind='forteresse', seed=22,
                               units=dict(ligne=2, legere=1, artillerie=2, mitrailleuses=1, sapeurs=1)), None,
     'joueur'),
    ('1790_joueur_village_def', dict(me='24', foe='33', era='1790', kind='village', role='def', seed=23,
                                     units=dict(ligne=3, garde=1, artillerie=1, sapeurs=1)), None, 'joueur'),
    ('1700_ordres', dict(me='40', foe='24', era='1700', seed=31,
                         units=dict(ligne=3, legere=1, cavalerie=2, artillerie=1)), None, 'ordres'),
    ('1813_ordres_def', dict(me='33', foe='47', era='1813', role='def', seed=32,
                             units=dict(ligne=3, grenadiers=1, cavalerie=1, artillerie=2)), None, 'ordres'),
    ('1870_ordres_place', dict(me='24', foe='64', era='1870', kind='forteresse', seed=33,
                               units=dict(ligne=3, artillerie=1, mitrailleuses=1, legere=1)), None, 'ordres'),
    ('1790_ordres_reprise', dict(me='47', foe='33', era='1790', seed=34,
                                 units=dict(ligne=2, legere=2, cavalerie=1, artillerie=2)), 500, 'ordres'),
]


def tiree(k):
    """La bataille tirée au sort numéro k (balayage) : (nom, corps, reprise, mode)."""
    rng = random.Random(f'balayage{k}')
    era = rng.choice(['1700', '1790', '1813', '1870'])
    codes = ['33', '24', '40', '47', '64']
    me = rng.choice(codes)
    foe = rng.choice([c for c in codes if c != me])
    kind = rng.choice(['bataille', 'bataille', 'forteresse', 'village'])
    role = rng.choice(['att', 'def'])
    place = kind != 'bataille'
    ok = [t for t in S.units_for(era, garrison=place and role == 'def') if S._local(t, me)]
    units = {}
    for _ in range(rng.randint(1, S.MAX_UNITS)):
        t = rng.choice(ok)
        units[t] = units.get(t, 0) + 1
    body = dict(me=me, foe=foe, era=era, kind=kind, role=role, units=units, seed=rng.randrange(1 << 30),
                difficulty=rng.choice(['facile', 'normal', 'difficile']))
    if rng.random() < 0.6:
        body['season'] = rng.choice(list(S.SEASONS))
    if rng.random() < 0.5:
        body['weather'] = rng.choice(['soleil', 'nuages', 'pluie', 'orage', 'brouillard', 'neige', 'canicule', 'tempete'])
    reprise = rng.choice([100, 500, 1200]) if rng.random() < 0.2 else None
    return f'x{k}', body, reprise, rng.choice(['ia', 'ia', 'joueur', 'ordres'])


def neuve(body, mode):
    """La bataille de skirmish.new : pas encore déployée ('ia', 'joueur'), ou déployée par create_orders ('ordres')."""
    if mode == 'ordres':
        g, bid = S.new(GEO, body)
        assert g is not None, bid
        return g.tactical[bid]
    deploy = TB.default_deploy
    TB.default_deploy = lambda tb, s: None
    try:
        g, bid = S.new(GEO, dict(body, mode='manuel'))
    finally:
        TB.default_deploy = deploy
    assert g is not None, bid
    tb = g.tactical[bid]
    k = 0
    for u in tb.units:
        u.ctrl = 'ia'
        if mode == 'joueur' and u.side == 0:
            u.ctrl = 'joueur' if k % 2 == 0 else 'ia'
            k += 1
        if not hasattr(u, 'x'):
            u.x = u.y = 0.0
    tb.spec['me'] = 0 if mode == 'joueur' else None
    tb.ai_sides = [1] if mode == 'joueur' else [0, 1]
    return tb


def ordres_tires(tb, nom):
    """Des ordres tirés au sort parmi ceux que propose la fenêtre des ordres (verrouillés compris : clean les écarte)."""
    rng = random.Random(f'ordres{nom}')
    return {g['key']: rng.choice(g['opts'])['v'] for g in OR.groups(tb, tb.me, LIVRES)}


def engager(tb, raw):
    """bridge.set_orders(g, tb, raw, go=True), sans la partie (le trésor : LIVRES)."""
    me = tb.me
    o = OR.clean(tb, me, raw, LIVRES)
    tb.spec['orders'][me] = o
    TB.default_deploy(tb, me)
    tb.start()
    OR.setup(tb, me, o)
    if o.get('ruse') == 'deserteurs':
        AI.shift_reserve(tb, 1 - me, OR.wing_sign(o), DESERTEURS)
    tb.replay = dict(real=0.0, k=1, skip=False)
    tb.log("Vos officiers engagent la bataille selon vos ordres.")


def relue(depart, ordres):
    """L'état de départ relu, engagé si besoin : ce que fait l'essai Rust."""
    tb = BT.TacticalBattle.from_dict(GEO, json.loads(depart))
    if tb.phase == 'deploiement':
        if tb.spec.get('mode') == 'ordres':
            engager(tb, ordres)
        else:
            for s in (0, 1):
                TB.default_deploy(tb, s)
            tb.warm()
            tb.start()
    return tb


def acte(tb, rng, n):
    """Ce que fait le joueur au pas n : [sorte, arguments…] (None : rien)."""
    if n == 600 and rng.random() < 0.5:
        return ['autofinish']
    if n == 900 and tb.accel:
        return ['resume']
    if n == 1800 and rng.random() < 0.3:
        return ['withdraw', 0]
    if n % ACTE != 5:
        return None
    mine = [u for u in tb.units if u.side == 0 and u.alive]
    if not mine:
        return None
    pool = [u for u in mine if u.ctrl == 'joueur'] if rng.random() < 0.9 else mine
    if not pool:
        return None
    k = rng.choice(KINDS)
    us = rng.sample(pool, min(len(pool), rng.choice([1, 1, 1, 2, 3])))
    p = {}
    foes = [u for u in tb.units if u.side == 1 and u.alive]
    seen = [u for u in foes if u.id in tb.seen_by[0]]
    if k in ('move', 'maisons', 'bombard'):
        if k != 'maisons' or rng.random() < 0.7:
            c = rng.choice(seen or foes or us)
            p['x'], p['y'] = c.x + rng.uniform(-300, 300), c.y + rng.uniform(-300, 300)
        if k == 'move':
            if rng.random() < 0.4:
                p['dir'] = rng.uniform(-3.1, 3.1)
            if rng.random() < 0.3:
                p['run'] = True
    elif k in ('attack', 'charge', 'volley_charge', 'pursue'):
        c = rng.choice(seen if seen and rng.random() < 0.9 else (foes or us))
        p['target'] = c.id
    elif k == 'fire':
        p['mode'] = rng.choice(['free', 'hold', 'volley'])
    elif k == 'stop':
        p['mode'] = rng.choice(['max', 'bonne', 'bout', 'loin'])
    elif k == 'shot':
        p['mode'] = rng.choice(['auto', 'boulet', 'mitraille'])
    elif k == 'counter':
        p['mode'] = rng.choice(['on', 'off'])
    elif k == 'form':
        p['form'] = rng.choice(['ligne', 'colonne', 'carre', 'tirailleurs', 'batterie', 'attelee', 'maisons'])
    return ['order', 0, [u.id for u in us], k, p, 'joueur']


def faire(tb, a):
    """Exécute un acte du joueur ; rend sa réponse."""
    if a[0] == 'order':
        r = tb.order(a[1], a[2], a[3], who=a[5], **a[4])
    elif a[0] == 'autofinish':
        r = tb.autofinish()
    elif a[0] == 'resume':
        r = tb.resume()
    else:
        r = tb.withdraw(a[1])
    return list(r)


def empreinte(tb, since):
    return commun.empreinte_ordre(dict(etat=tb.to_dict(), vue=tb.view(0, since)))


def jouer(nom, mode, depart, ordres, jusqua=None):
    tb = relue(depart, ordres)
    rng = random.Random(f'joueur{nom}')
    emp, actes = [], []
    n = since = 0
    while True:
        if jusqua is not None and n == jusqua:
            return tb, since
        if n % PAS == 0:
            emp.append(empreinte(tb, since)[:16])
            since = tb.seq
        if tb.phase != 'combat' or n >= LIMITE:
            if jusqua is not None:   # (reprise d'une bataille finie avant : son état final)
                return tb, since
            break
        if tb.ask:
            OR.answer(tb, 'go' if (n // PAS) % 2 else 'wait')
        if mode == 'joueur':
            a = acte(tb, rng, n)
            if a:
                actes.append([n] + a + [faire(tb, a)])
        tb.step()
        n += 1
    return dict(pas=n, emp=emp, actes=actes, phase=tb.phase, clock=tb.clock, fin=commun.empreinte_ordre(tb.to_dict()),
                result=tb.result, view=tb.result_view(0) if tb.result else None)


def depart_de(nom, body, reprise, mode):
    """(état de départ en JSON, ordres)."""
    tb = neuve(body, mode)
    ordres = ordres_tires(tb, nom) if mode == 'ordres' else None
    if reprise is not None:
        tb, _since = jouer(nom, mode, json.dumps(tb.to_dict(), ensure_ascii=False), ordres, reprise)
    return json.dumps(tb.to_dict(), ensure_ascii=False, separators=(',', ':')), ordres


def trouver(nom):
    return tiree(int(nom[1:])) if nom[0] == 'x' else next(b for b in BATAILLES if b[0] == nom)


def main():
    if DIAG:
        nom, pas = sys.argv[1], int(sys.argv[2])
        _n, body, reprise, mode = trouver(nom)
        depart, ordres = depart_de(nom, body, reprise, mode)
        TRACE.truncate(0)
        TRACE.seek(0)
        tb, since = jouer(nom, mode, depart, ordres, pas)
        TRACE.close()
        f = os.path.join(SORTIE, f'{nom}_{pas}_py.json')
        with open(f, 'w', encoding='utf-8') as s:
            s.write(commun.canon_ordre(dict(etat=tb.to_dict(), vue=tb.view(0, since))))
        print(f, os.path.join(SORTIE, 'hasard_py.txt'))
        return
    liste, sortie = BATAILLES, None
    if sys.argv[1:2] == ['balayage']:
        n, k0, sortie = int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
        liste = [tiree(k) for k in range(k0, k0 + n)]
    ref = []
    for nom, body, reprise, mode in liste:
        try:
            depart, ordres = depart_de(nom, body, reprise, mode)
        except AssertionError as e:   # (balayage : régiments indisponibles pour cette bataille)
            print(nom, 'impossible :', e)
            continue
        r = jouer(nom, mode, depart, ordres)
        print(nom, mode, r['pas'], r['phase'], r['result'] and r['result']['why'], len(r['actes']), 'actes')
        relu = commun.empreinte_ordre(BT.TacticalBattle.from_dict(GEO, json.loads(depart)).to_dict())
        ref.append(dict(nom=nom, mode=mode, depart=depart, ordres=ordres, relu=relu, **r))
    if sortie:
        with open(sortie, 'w', encoding='utf-8') as f:
            json.dump(ref, f, ensure_ascii=False, separators=(',', ':'))
    else:
        commun.ecrire('batailles', ref)


if __name__ == '__main__':
    main()
