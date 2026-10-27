"""Banc des batailles sur le plan des villes (SPEC-CARTE-2D.md, « Livré — E ») : python3 tests/test_plan_ville.py

POURQUOI CE BANC EXISTE. Une bataille à une place se livre dans la ville de « Voir l'intérieur » : le serveur refait
le plan de web/js/carte/villes.js en Python (game/tactics/plan_ville.py) et le pose sur la grille de la bataille
(terrain_ville.py). Le portage doit rendre exactement la même ville que le navigateur (même tirage, mêmes hachages,
mêmes sinus que V8) : on le vérifie contre Node pour toutes les places. Puis la bataille : le tracé bastionné de
Bayonne et ses portes sont ceux du plan, un village a ses maisons le long de ses rues, et la carte se fait vite.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(ICI))

from game.geo import GeoMap  # noqa: E402
from game.tactics import plan_ville as PV, terrain as TR, terrain_ville as TV  # noqa: E402

GEO = GeoMap()
GEO1 = GeoMap(1)   # (la géographie des anciennes parties : les batailles des versions figées n'existent que là)
K = PV.carte_de(GEO)
nom = lambda x, geo=GEO: next(n for n in geo.nodes if n['name'] == x)


def carte(n, fort=None, battle=True, att=0.5, seed=700, dmg=0.0, year=1790, cx=None, cy=None):
    pl = dict(nid=n['id'], name=n['name'], type=n['type'], fort=n['fort'] if fort is None else fort, dmg=dmg, bar=0.0,
              pop=n['pop0'], x=n['x'], y=n['y'], battle=battle)
    spec = dict(seed=seed, cx=n['x'] if cx is None else cx, cy=n['y'] if cy is None else cy, season='ete',
                weather='soleil', year=year, place=pl if battle else None, att_angle=att, carte=TR.VERSION)
    return TR.generate(GEO, spec)


def resume(V):
    """Ce que les deux générateurs doivent rendre à l'identique (unités de l'intérieur)."""
    enc = lambda t: t and dict(poly=[list(p) for p in t['poly']],
                               ravs=[[list(r['b1']), list(r['apex']), list(r['b2'])] for r in t['ravs']])
    return dict(modele=V['Pf']['modele'], murs=V['Pf']['murs'], R=V['Pf']['R'], routes=[r['a'] for r in V['Pf']['routes']],
                ilots=[dict(q=[list(p) for p in b['q']], role=b.get('role'), zone=b['zone'], main=bool(b['main']))
                       for b in V['ilots']],
                rues=len(V['rues']), trace=enc(V['trace']), citadelle=enc(V['citadelle']), rect=V['rect'],
                murLigne=V['murLigne'], rMur=V['rMur'],
                plus=[dict(k=p['k'], x=p.get('x'), y=p.get('y'), a=p.get('a')) for p in V['plus']])


def ecart(a, b, path=''):
    """Premier écart entre deux résumés (nombres à 1e-9 près), ou None."""
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            return path + ' : clés'
        return next((r for r in (ecart(a[k], b[k], path + '.' + k) for k in a) if r), None)
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f'{path} : {len(a)} contre {len(b)}'
        return next((r for r in (ecart(x, y, f'{path}[{i}]') for i, (x, y) in enumerate(zip(a, b))) if r), None)
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return None if abs(a - b) <= 1e-9 * max(1, abs(a)) else f'{path} : {a} contre {b}'
    return None if a == b else f'{path} : {a!r} contre {b!r}'


class LeMemePlan(unittest.TestCase):

    @unittest.skipUnless(shutil.which('node'), "Node absent : pas de comparaison avec villes.js")
    def test_le_plan_de_python_est_celui_du_navigateur(self):
        etats = []
        for n in GEO.nodes:
            etats += [[n['id'], 1789, None, None, 0], [n['id'], 1870, None, None, 0],
                      [n['id'], 1789, 3, (n['pop0'] or 700) * 3, 2]]
        d = tempfile.mkdtemp()
        with open(os.path.join(d, 'm.json'), 'w') as f:
            json.dump(GEO.client_payload(), f)
        with open(os.path.join(d, 'e.json'), 'w') as f:
            json.dump(etats, f)
        js = json.loads(subprocess.check_output(['node', os.path.join(ICI, 'plan_ville_js.mjs'), os.path.join(d, 'm.json'),
                                                 os.path.join(d, 'e.json')]))
        shutil.rmtree(d)
        faux = []
        for (nid, an, f, pop, dd), j in zip(etats, js):
            r = ecart(resume(PV.generer_interieur(K, PV.profil_ville(K, K.noeud[nid], an, f, pop, dd))), j)
            if r:
                faux.append(f"{K.noeud[nid]['name']} ({an}, f={f}) {r}")
        self.assertEqual(faux, [], f'{len(faux)} plans sur {len(etats)} diffèrent')

    def test_l_arithmetique_de_v8(self):
        # (valeurs de Node 22 : Math.imul, mulberry32, Math.hypot, Math.sin, Math.atan2, Math.round)
        R = PV.alea(1234567)
        self.assertEqual([R() for _ in range(3)], [0.6074679309967905, 0.19144689152017236, 0.43751312675885856])
        self.assertEqual(PV.hashS('bayonne'), 2881610187)
        self.assertEqual(PV.hash2(3, -7, 2881610187), 0.812592493603006)
        self.assertEqual(PV.hypot(3.1, 4.7), 5.630275304103699)
        self.assertEqual(PV.sin(2.8966139904629276), 0.24253562503633447)
        self.assertEqual(PV.atan2(0.25, -0.97), 2.8893501956999748)
        self.assertEqual((PV.jround(2.5), PV.jround(-2.5)), (3, -2))


class BatailleSurLePlan(unittest.TestCase):

    def test_siege_de_bayonne_sur_son_plan(self):
        n = nom('Bayonne')
        m = carte(n, 3, dmg=0.3)
        V = PV.plan(GEO, n['id'], 1790, 3, n['pop0'], 0)
        self.assertEqual(V['Pf']['murs'], 'bastions')
        P = m.plan
        self.assertEqual(len(P['ilots']), len(V['ilots']))
        k = P['k']
        tf = lambda p: (P['c'][0] + (p[0] - PV.IC[0]) * k, P['c'][1] + (p[1] - PV.IC[1]) * k)
        # le tracé bastionné et les demi-lunes de la bataille sont ceux du plan, à l'échelle de la carte
        # (à un mètre près : l'échelle du plan envoyé au client, k, est arrondie)
        self.assertTrue(all(abs(a - round(b)) <= 1 for p, q in zip(m.bastions, map(tf, V['trace']['poly'])) for a, b in zip(p, q)))
        self.assertEqual(len(m.bastions), len(V['trace']['poly']))
        self.assertEqual(m.demi_lunes, [[[round(x), round(y)] for x, y in map(tf, (r['b1'], r['apex'], r['b2']))]
                                        for r in V['trace']['ravs']])
        self.assertEqual(m.walls[0]['kind'], 'bastion')
        self.assertTrue(m.walls[0]['breach'], 'le siège a ouvert une brèche')
        if V['citadelle']:
            self.assertEqual(m.walls[1]['bastions'][0], [round(v) for v in tf(V['citadelle']['poly'][0])])
        # chaque route du plan entre par une porte au milieu de la courtine qui lui fait face
        dedans = TR._dedans([tuple(p) for p in m.bastions])
        portes = [TR.center_of(c) for c in range(TR.N) if m.t[c] == TR.T_PORTE]
        cotes = [tf(c['porte']) for c in V['trace']['cotes']]
        entrees = 0
        for r in m.roads:
            cells = TR._poly_cells(r['pts'])
            if r['kind'] != 'chemin' and any(dedans(c) for c in cells) and not all(dedans(c) for c in cells):
                entrees += 1
                self.assertTrue(any(m.t[c] == TR.T_PORTE for c in cells), 'route sans porte')
                self.assertTrue(any(min(((x - a) ** 2 + (y - b) ** 2) ** .5 for a, b in portes) < 45 for x, y in cotes))
        self.assertGreaterEqual(entrees, 2)
        # des maisons dans les îlots, des rues entre eux ; le cœur est l'église du plan
        self.assertGreater(m.stats['hist']['BATI'], 100)
        self.assertIn(TR.cell_of(*m.heart), [c for c in range(TR.N) if m.t[c] in (TR.T_BATI, TR.T_ROUTE, TR.T_PRE)])
        kinds = {b['kind'] for b in m.batis}
        self.assertTrue({'maison', 'caserne'} <= kinds and kinds & {'eglise', 'cathedrale'}, kinds)
        # l'assaillant a la place de se déployer hors des murs (DEPLOI m au moins entre l'enceinte et son bord)
        self.assertLessEqual(m.place['r'] + 400, max(m.place['x'], TR.W - m.place['x']) + 1)
        d = m.to_client(dict(seed=1, season='ete', weather='soleil', cx=0, cy=0))
        self.assertEqual(d['plan']['modele'], 'grande')
        json.dumps(d)

    def test_un_village_et_ses_rues(self):
        n = nom('Belin')
        m = carte(n, battle=False, cx=n['x'] + 0.4, cy=n['y'])   # (une bataille rangée à 400 m du village)
        V = PV.plan(GEO, n['id'], 1790, n['fort'], n['pop0'], 0)
        self.assertEqual(m.place['name'], 'Belin')
        self.assertFalse(m.place['battle'])
        self.assertEqual(m.plan['echelle'], 1.0, 'un village tient sur le champ : à la vraie échelle')
        self.assertEqual(len(m.plan['ilots']), len(V['ilots']))
        self.assertFalse(m.walls)
        self.assertAlmostEqual(m.place['x'], 1500 - 400, delta=1)
        # des maisons sur les rues du plan, une église
        bati = [c for c in range(TR.N) if m.t[c] == TR.T_BATI and
                ((TR.center_of(c)[0] - m.place['x']) ** 2 + (TR.center_of(c)[1] - m.place['y']) ** 2) ** .5 < m.town_r]
        self.assertGreater(len(bati), 50)
        voisins = lambda c: (c - 1, c + 1, c - TR.COLS, c + TR.COLS)
        sur_rue = [c for c in bati if any(m.t[v] in (TR.T_ROUTE, TR.T_CHEMIN) for v in voisins(c))]
        self.assertGreater(len(sur_rue) / len(bati), 0.95)
        self.assertTrue({'eglise'} & {b['kind'] for b in m.batis})
        # les rues tiennent aux routes (en 8 voisins, comme les troupes : hors du village, une route va en biais)
        c0 = TR.cell_of(m.place['x'], m.place['y'])
        vus, todo = {c0}, [c0]
        while todo:
            c = todo.pop()
            for v in voisins(c) + ((c - TR.COLS - 1, c - TR.COLS + 1, c + TR.COLS - 1, c + TR.COLS + 1) if 0 < c % TR.COLS < TR.COLS - 1 else ()):
                if 0 <= v < TR.N and v not in vus and m.t[v] in (TR.T_ROUTE, TR.T_CHEMIN, TR.T_PORTE):
                    vus.add(v)
                    todo.append(v)
        bord = [c for c in vus if c % TR.COLS in (0, TR.COLS - 1) or c // TR.COLS in (0, TR.ROWS - 1)]
        self.assertTrue(bord, "du village, on gagne le bord de la carte par les rues et les routes")

    def test_les_metiers_et_les_quais(self):
        # les métiers du plan (comme « Voir l'intérieur ») : château viticole et ses vignes, airiaux landais, salines
        m = carte(nom('Saint-Émilion'))
        ks = [e['k'] for e in m.plan['metiers']]
        self.assertIn('chateauVin', ks)
        ch = next(e for e in m.plan['metiers'] if e['k'] == 'chateauVin')
        self.assertEqual(m.t[TR.cell_of(ch['x'], ch['y'])], TR.T_BATI)
        self.assertIn('chateau', {b['kind'] for b in m.batis})
        vignes = [c for q in m.plan['vignes'] for c in TV._dans(q) if m.t[c] == TR.T_VIGNE_T]
        self.assertGreater(len(vignes), 20, 'les vignes du château')
        m = carte(nom('Sabres'))
        airiaux = [e for e in m.plan['metiers'] if e['k'] == 'airial']
        self.assertTrue(airiaux)
        self.assertTrue(all(m.t[TR.cell_of(e['x'], e['y'])] == TR.T_BATI for e in airiaux))
        m = carte(nom('Salies-de-Béarn'), att=1.57)   # (un assaillant dont la bande laisse les salines hors de son chemin)
        self.assertTrue(m.plan['salines'])
        self.assertTrue(any(m.t[c] == TR.T_MARAIS_T for q in m.plan['salines'][0] for c in TV._dans(q)))
        # rien sur le glacis ni devant une porte ; les quais d'un port le long de l'eau, des bateaux
        for n, f in ((nom('Libourne'), 1), (nom('Bordeaux'), 2), (nom('Navarrenx'), 3)):
            m = carte(n, f)
            murs = [c for c in range(TR.N) if m.t[c] in (TR.T_MUR, TR.T_PORTE, TR.T_BRECHE)]
            dg = TR.bfs(murs, 7)
            for e in m.plan['metiers']:
                self.assertGreater(dg[TR.cell_of(e['x'], e['y'])], 7, f"{n['name']} : {e['k']} sur le glacis")
        m = carte(nom('Bordeaux'), 2)
        self.assertTrue(m.plan['quais'] and m.plan['bateaux'])
        quai = [c for q in m.plan['quais'] for c in TR._line4([tuple(p) for p in q])
                if m.t[c] not in (TR.T_EAU, TR.T_GUE, TR.T_MUR, TR.T_PORTE, TR.T_BRECHE)]   # (la rive, hors les murs)
        self.assertGreater(len(quai), 40)
        self.assertGreater(sum(m.t[c] == TR.T_ROUTE for c in quai) / len(quai), 0.9, 'on passe sur les quais')
        self.assertTrue(all(m.t[TR.cell_of(b[0], b[1])] == TR.T_EAU for b in m.plan['bateaux']))

    def test_meme_graine_meme_ville(self):
        a, b = carte(nom('Navarrenx'), 3, seed=4), carte(nom('Navarrenx'), 3, seed=4)
        self.assertEqual(bytes(a.t), bytes(b.t))
        self.assertEqual((a.plan, a.walls, a.batis), (b.plan, b.walls, b.batis))

    def test_une_carte_de_version_3_garde_sa_ville(self):
        n = nom('Navarrenx')
        pl = dict(nid=n['id'], name=n['name'], type=n['type'], fort=3, dmg=0.0, bar=0.0, pop=n['pop0'], x=n['x'],
                  y=n['y'], battle=True)
        m = TR.generate(GEO, dict(seed=4, cx=n['x'], cy=n['y'], season='ete', weather='soleil', year=1790, place=pl,
                                  att_angle=0.5, carte=3))
        self.assertIsNone(m.plan)
        self.assertEqual(m.place['r'], 117)   # (le bourg du générateur d'avant)

    def test_carte_v4_figee(self):
        """Une bataille de version 4 d'une sauvegarde garde son plan d'avant les bâtiments à la vraie taille
        (plan_ville_v4, terrain_ville_v4, figés) ; la version 5 prend le nouveau."""
        n = nom('Belin', GEO1)
        pl = dict(nid=n['id'], name=n['name'], type=n['type'], fort=0, dmg=0.0, bar=0.0, pop=n['pop0'], x=n['x'], y=n['y'], battle=True)
        spec = dict(seed=700, cx=n['x'], cy=n['y'], season='ete', weather='soleil', year=1790, place=pl, att_angle=0.5)
        v4, v5 = TR.generate(GEO1, dict(spec, carte=4)), TR.generate(GEO1, dict(spec, carte=5))
        self.assertEqual(bytes(v4.t), bytes(TR.generate(GEO1, dict(spec, carte=4)).t))
        self.assertNotEqual(bytes(v4.t), bytes(v5.t), 'le village de Belin a rétréci : la carte de version 5 diffère')

    def test_carte_v5_figee(self):
        """Une bataille de version 5 d'une sauvegarde garde son plan d'avant la densité des bourgs (plan_ville_v5,
        terrain_ville_v5, figés) ; la version 6 prend le nouveau."""
        n = nom('Nontron', GEO1)
        pl = dict(nid=n['id'], name=n['name'], type=n['type'], fort=0, dmg=0.0, bar=0.0, pop=n['pop0'], x=n['x'], y=n['y'], battle=True)
        spec = dict(seed=700, cx=n['x'], cy=n['y'], season='ete', weather='soleil', year=1790, place=pl, att_angle=0.5)
        v5, v6 = TR.generate(GEO1, dict(spec, carte=5)), TR.generate(GEO1, dict(spec, carte=6))
        self.assertEqual(bytes(v5.t), bytes(TR.generate(GEO1, dict(spec, carte=5)).t))
        self.assertNotEqual(bytes(v5.t), bytes(v6.t), 'Nontron a rétréci et s’est aéré : la carte de version 6 diffère')
        bati = lambda m: sum(m.t[c] == TR.T_BATI for c in range(TR.N))
        self.assertLess(bati(v6), bati(v5) * .6, 'moins de maisons')

    def test_carte_v6_figee(self):
        """Une bataille de version 6 d'une sauvegarde garde sa carte d'avant les villes denses dans leurs murs et collées
        à leur fleuve (plan_ville_v6, terrain_ville_v6, figés : l'empreinte de la carte de Libourne d'alors) ; la
        version 7 prend le nouveau plan. Toutes deux sur la carte des anciennes parties (geo_v1.json), qui ne change pas
        avec les rivières affinées : la version 7 d'une ancienne partie garde aussi la sienne."""
        import hashlib
        n = nom('Libourne', GEO1)
        pl = dict(nid=n['id'], name=n['name'], type=n['type'], fort=1, dmg=0.0, bar=0.0, pop=n['pop0'], x=n['x'], y=n['y'], battle=True)
        spec = dict(seed=700, cx=n['x'], cy=n['y'], season='ete', weather='soleil', year=1790, place=pl, att_angle=0.5)
        v6, v7 = TR.generate(GEO1, dict(spec, carte=6)), TR.generate(GEO1, dict(spec, carte=7))
        self.assertEqual(hashlib.sha1(bytes(v6.t)).hexdigest(), 'ae47148c3fe604aecb7ab8406c4faf9de693f63c')
        self.assertNotEqual(bytes(v6.t), bytes(v7.t), 'Libourne serrée dans ses murs, au bord de l’Isle : la version 7 diffère')
        self.assertEqual(hashlib.sha1(bytes(v7.t)).hexdigest(), '302feb7219df7186089752db2f0e5fd3d04b6126')

    def test_pas_de_pont_de_pierre_a_bordeaux_avant_1822(self):
        kinds = lambda y: {b.get('kind') for b in carte(nom('Bordeaux'), year=y).bridges if b.get('river') == 'Garonne'}
        self.assertEqual(kinds(1800), {'bateaux'})
        self.assertEqual(kinds(1830), {None})

    def test_carte_v7_figee(self):
        """Une bataille de version 7 d'une sauvegarde garde sa carte des villes denses collées à leur fleuve
        (plan_ville_v7, terrain_ville_v7, figés : l'empreinte de Libourne d'alors) ; la version 8 revient au plan de la
        version 4 (décision du joueur), la même carte."""
        import hashlib
        n = nom('Libourne', GEO1)
        pl = dict(nid=n['id'], name=n['name'], type=n['type'], fort=1, dmg=0.0, bar=0.0, pop=n['pop0'], x=n['x'], y=n['y'], battle=True)
        spec = dict(seed=700, cx=n['x'], cy=n['y'], season='ete', weather='soleil', year=1790, place=pl, att_angle=0.5)
        v4, v7, v8 = (TR.generate(GEO1, dict(spec, carte=c)) for c in (4, 7, 8))
        self.assertEqual(hashlib.sha1(bytes(v7.t)).hexdigest(), '302feb7219df7186089752db2f0e5fd3d04b6126')
        self.assertEqual(bytes(v8.t), bytes(v4.t))

    def test_les_autres_ponts_dates(self):
        import re
        with open(os.path.join(ICI, '..', 'web', 'js', 'carte', 'villes.js'), encoding='utf-8') as f:
            js = re.search(r'PONTS_DATES = \[(.*?)\];', f.read(), re.S).group(1)
        self.assertEqual(sorted((v, r, int(a)) for v, r, a in re.findall(r"\['([^']+)', '([^']+)', (\d+)\]", js)),
                         sorted(TR.PONTS_DATES), 'villes.js et terrain.py : les mêmes ponts')
        kinds = lambda y: {b.get('kind') for b in carte(nom('Libourne'), year=y).bridges if b.get('river') == 'Dordogne'}
        self.assertEqual(kinds(1800), {'bateaux'})
        self.assertEqual(kinds(1830), {None})
        # la route de Bordeaux à Libourne passe la Garonne et la Dordogne : un pont (ou un bac) sur chacune
        e = next(e for e in GEO.edges if {GEO.nodes[e['a']]['name'], GEO.nodes[e['b']]['name']} == {'Bordeaux', 'Libourne'})
        self.assertEqual({e['river']} | {p[2] for p in e['ponts']}, {'Garonne', 'Dordogne'})
        # (géographie 2 : les routes de Bordeaux, Créon et Izon passent la Dordogne au pont de Libourne, pas en amont)
        lib = nom('Libourne')
        for e in GEO.edges:
            if lib['id'] in (e['a'], e['b']) and e.get('kind') != 'water' and {GEO.nodes[e['a']]['name'], GEO.nodes[e['b']]['name']} & {'Bordeaux', 'Créon', 'Izon'}:
                x, y = next(p[:2] for p in [[e['bx'], e['by'], e['river']]] + e.get('ponts', []) if p[2] == 'Dordogne')
                self.assertLess(((x - lib['x']) ** 2 + (y - lib['y']) ** 2) ** .5, 1, 'au pied de Libourne')

    def test_vite(self):
        cas = [(nom('Bayonne'), 3), (nom('Bordeaux'), 2), (nom('Navarrenx'), 3), (nom('Belin'), 0)]
        t0 = time.perf_counter()
        for n, f in cas:
            K.plans.clear()   # (sans le plan gardé en mémoire)
            carte(n, f)
        dt = (time.perf_counter() - t0) / len(cas)
        self.assertLess(dt, 0.5, 'moins d’une demi-seconde par carte sur un PC (deux à trois fois plus sur un Raspberry Pi)')


if __name__ == '__main__':
    unittest.main()
