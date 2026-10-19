"""Banc d'essai du serveur (server.py) : un vrai serveur HTTP sur un port libre, des requêtes comme celles du navigateur
ou d'un appareil du réseau local, et des sauvegardes dans un dossier temporaire (les vraies ne sont pas touchées).

    python3 tests/test_serveur.py

POURQUOI CE BANC EXISTE. Le serveur est ouvert au réseau local (iPad, Raspberry Pi) : une requête mal formée ne
doit ni couper la connexion sans réponse, ni arrêter la partie, ni sortir du dossier web/, et une sauvegarde ne doit
jamais être perdue. Bugs déjà rattrapés, à ne pas revoir :
- une commande d'escarmouche mal formée coupait la connexion (« Serveur injoignable ») ;
- /api/quit arrêtait la partie sans sauvegarder, depuis n'importe quel appareil du réseau ;
- une sauvegarde automatique illisible au démarrage était écrasée au mois suivant ;
- une sauvegarde manuelle nommée « sauvegarde-automatique » était écrasée au mois suivant.
"""
import contextlib
import http.client
import io
import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

import fabrique  # noqa: F401  (chemins, journal des batailles coupé)
import server
from game.engine import Game


class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.saves = server.SAVES
        server.SAVES = tempfile.mkdtemp()
        with contextlib.redirect_stdout(io.StringIO()):   # (« Préparation de la carte… »)
            server.APP = server.App()
        cls.srv = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.port = cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        server.SAVES = cls.saves

    def req(self, method, path, body=None, headers=None):
        """(statut, texte) ; body : dict (envoyé en JSON) ou bytes bruts."""
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=30)
        data = json.dumps(body).encode() if isinstance(body, (dict, list, str)) else body
        c.request(method, path, body=data, headers={'Content-Type': 'application/json', **(headers or {})})
        r = c.getresponse()
        out = r.status, r.read().decode('utf-8', 'replace')
        c.close()
        return out

    def cmd(self, body):
        st, txt = self.req('POST', '/api/cmd', body)
        self.assertEqual(st, 200, txt)
        return json.loads(txt)

    def nouvelle_partie(self):
        st, txt = self.req('POST', '/api/new', dict(dept='33', seed=1))
        self.assertEqual(st, 200, txt)
        return server.APP.game

    def test_arrivee_estimee_sans_ordre(self):
        g = self.nouvelle_partie()
        a = next(a for a in g.armies.values() if a['owner'] == g.player)
        r = self.cmd(dict(cmd='eta', army=a['id'], node=g.capital_of('24'), mode='route'))
        self.assertTrue(r['ok'])
        self.assertIsInstance(r['tn'], int)
        self.assertEqual(a['path'], [], "rien n'est ordonné")
        self.assertIsNone(self.cmd(dict(cmd='eta', army='a999', x=1, y=1))['tn'])

    def test_chantier_de_voie_ferree(self):
        g = self.nouvelle_partie()
        r = self.cmd(dict(cmd='rail_build', node=g.capital_of('33'), section='0-5'))
        self.assertFalse(r['ok'], 'sans la technologie')
        self.assertFalse(self.cmd(dict(cmd='rail_build', node=g.capital_of('33'), section=['x']))['ok'])

    def test_page_d_accueil(self):
        st, txt = self.req('GET', '/')
        self.assertEqual(st, 200)
        self.assertIn('<html', txt.lower())

    def test_hors_du_dossier_web_refuse(self):
        for p in ('/../server.py', '/%2e%2e/server.py'):
            with self.subTest(chemin=p):
                self.assertEqual(self.req('GET', p)[0], 404)

    def test_autre_site_refuse(self):
        self.nouvelle_partie()
        avant = server.APP.game
        # formulaire ou fetch « simple » d'un autre site (CSRF) : pas de JSON, refusé
        st, _ = self.req('POST', '/api/new', dict(dept='33'), {'Content-Type': 'text/plain'})
        self.assertEqual(st, 415)
        self.assertIs(server.APP.game, avant, 'la partie en cours est intacte')
        # DNS rebinding : nom inconnu refusé, IP Tailscale acceptée
        self.assertEqual(self.req('GET', '/api/saves', headers={'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.req('GET', '/api/saves', headers={'Host': '100.80.111.121:8790'})[0], 200)

    def test_routes_supprimees(self):
        self.nouvelle_partie()
        self.assertEqual(self.req('POST', '/api/quit', {})[0], 404)
        self.assertEqual(self.req('GET', '/api/info')[0], 404)
        self.assertIsNotNone(server.APP.game, 'la partie tourne toujours')

    def test_requetes_mal_formees_recoivent_une_reponse(self):
        self.nouvelle_partie()
        for body in ['x', [], {}, {'cmd': 'move', 'army': 'a1', 'x': 'nan'}, {'cmd': 'move', 'army': [], 'x': 1e300},
                     {'cmd': 'tac', 'sub': 'deploy', 'bid': 'esc0', 'x': 'a'}]:
            with self.subTest(body=body):
                self.assertIsInstance(self.cmd(body), dict)
        st, txt = self.req('POST', '/api/cmd', b'{}', {'Content-Length': 'abc'})
        self.assertIn(st, (200, 400, 404), 'une taille illisible reçoit une réponse')

    def test_arrivee_devant_une_ville(self):
        # (évolution du 18/10/2026) : l'armée s'arrête devant la ville, l'état envoie le choix, la commande le transmet
        g = self.nouvelle_partie()
        a = next(x for x in g.armies.values() if x['owner'] == g.player)
        mer = {gn['name']: i for i, gn in enumerate(g.geo.nodes)}['Mérignac']
        r = self.cmd(dict(cmd='move', army=a['id'], node=mer, mode='route'))
        self.assertTrue(r['ok'], r)
        self.assertIn('choisir', r['msg'])
        st = json.loads(self.req('GET', '/api/state?since=0')[1])
        d = next(x for x in st['armies'] if x['id'] == a['id'])
        self.assertEqual(d['ask']['n'], mer)
        self.assertEqual(d['ask']['c']['manuel'], '', 'l’assaut est toujours permis')
        b = next(x for x in g.armies.values() if x['owner'] != g.player)
        for body in (dict(cmd='arrive', army=a['id'], value='piller'), dict(cmd='arrive', army=b['id'], value='attendre'),
                     dict(cmd='arrive', army=[], value={}), dict(cmd='arrive', army=a['id'])):
            with self.subTest(body=body):
                self.assertFalse(self.cmd(body)['ok'])
        r = self.cmd(dict(cmd='tour', action='go'))
        self.assertFalse(r['ok'], '« Tour suivant » attend le choix')
        self.assertIn('Mérignac', r['msg'])
        self.assertTrue(self.cmd(dict(cmd='arrive', army=a['id'], value='attendre'))['ok'])
        self.assertNotIn('ask', a)

    def test_pas_d_ordre_de_marche_pendant_le_tour_des_ia(self):
        g = self.nouvelle_partie()
        a = next(x for x in g.armies.values() if x['owner'] == g.player)
        g.tour['end'] = g.t + 20   # le tour des IA a commencé
        try:
            for c in ('move', 'retreat'):
                with self.subTest(ordre=c):
                    r = self.cmd(dict(cmd=c, army=a['id'], x=a['x'] + 30, y=a['y']))
                    self.assertFalse(r['ok'])
                    self.assertIn('tour des IA', r['msg'])
        finally:
            g.tour['end'] = None

    def test_nom_reserve_a_la_sauvegarde_automatique(self):
        self.nouvelle_partie()
        st, txt = self.req('POST', '/api/save', dict(name=server.AUTOSAVE))
        self.assertTrue(json.loads(txt)['ok'], txt)
        self.assertTrue(os.path.exists(os.path.join(server.SAVES, server.AUTOSAVE + '-1.json')))
        self.assertFalse(os.path.exists(os.path.join(server.SAVES, server.AUTOSAVE + '.json')))


class Sauvegardes(unittest.TestCase):
    def setUp(self):
        self.saves = server.SAVES
        server.SAVES = tempfile.mkdtemp()

    def tearDown(self):
        server.SAVES = self.saves

    def app(self):
        app = server.App.__new__(server.App)   # (sans recharger la carte ni la sauvegarde automatique)
        app.game = None
        app.skirmish = None
        return app

    def test_sauvegarde_illisible_mise_de_cote(self):
        p = os.path.join(server.SAVES, server.AUTOSAVE + '.json')
        with open(p, 'w', encoding='utf-8') as f:
            f.write('{"game": {pas du json')
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):   # (erreur attendue)
            self.app().load_autosave()
        self.assertFalse(os.path.exists(p), 'la prochaine sauvegarde automatique ne doit pas l’écraser')
        self.assertTrue(any('illisible' in n for n in os.listdir(server.SAVES)))

    def test_ecriture_puis_lecture(self):
        app = self.app()
        app.game = Game(fabrique.GEO, '33', 'normal', 1, '1790')
        app.write_save(server.AUTOSAVE, auto=True)
        with open(os.path.join(server.SAVES, server.AUTOSAVE + '.json'), encoding='utf-8') as f:
            self.assertEqual(json.load(f)['meta']['player'], '33')
        self.assertEqual([s['name'] for s in app.list_saves()], [server.AUTOSAVE])



class Connexions(unittest.TestCase):
    def test_une_ligne_par_appareil_qui_arrive(self):
        lignes = []
        v = server.Visites('Conquête', afficher=lignes.append)
        v.noter('192.168.1.20')
        v.noter('192.168.1.20')                                    # déjà vu : rien
        v.noter('::ffff:192.168.1.21')
        self.assertEqual(len(lignes), 2)
        self.assertIn('[connexion]', lignes[1])
        self.assertIn('2 appareil(s) actif(s) : 192.168.1.20, 192.168.1.21', lignes[1])
        v.vues['192.168.1.20'] -= server.Visites.INACTIF + 1         # parti depuis 10 min
        v.noter('192.168.1.20')                                    # revenu : affiché de nouveau
        self.assertEqual(len(lignes), 3)

if __name__ == '__main__':
    unittest.main()
