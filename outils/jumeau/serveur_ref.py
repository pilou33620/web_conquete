"""Jumeau du serveur (server.py) : ce que le serveur Python répond, sans partie en cours, à des requêtes choisies.

    python3 outils/jumeau/serveur_ref.py    → rust/conquete/tests/references/serveur.json

Un vrai serveur HTTP (server.Handler) sur un port libre, ses sauvegardes dans un dossier temporaire, comme
tests/test_serveur.py ; rust/conquete/tests/serveur.rs pose les mêmes fichiers et envoie les mêmes requêtes à
l'exécutable Rust. /api/map est rangé par son empreinte (SHA-256 des octets servis) : elle ne va pas dans le dépôt.
"""
import contextlib
import hashlib
import http.client
import io
import json
import os
import tempfile
import threading
from http.server import ThreadingHTTPServer

import commun
import server
from game.tactics import skirmish as SK

# les fichiers posés avant le démarrage (les mêmes dans l'essai Rust)
FICHIERS = {
    'sauvegarde-automatique.json': '{"game": {pas du json',
    'abimee.json': '{"meta": {"player": "33"}, "game": ',
    'ancienne.json': json.dumps({'meta': {'player': '24', 'faction': 'Dordogne', 'date': '1er mai 1791', 't': 120,
                                          'difficulty': 'normal', 'auto': False}, 'game': {}}),
    'notes.txt': 'pas une sauvegarde',
}

# (méthode, chemin, corps, en-têtes) : corps dict / liste / texte envoyé en JSON, ou octets bruts
REQUETES = [
    ('GET', '/api/state', None, {}),
    ('GET', '/api/state?since=abc', None, {}),
    ('GET', '/api/tactic?bid=x', None, {}),
    ('GET', '/api/tactic_map', None, {}),
    ('POST', '/api/cmd', 'x', {}),
    ('POST', '/api/cmd', [], {}),
    ('POST', '/api/cmd', {}, {}),
    ('POST', '/api/cmd', {'cmd': 'move', 'army': 'a1', 'x': 'nan'}, {}),
    ('POST', '/api/cmd', b'{}', {'Content-Length': 'abc'}),
    ('POST', '/api/cmd', b'{"cmd": ', {}),
    ('POST', '/api/save', {}, {}),
    ('POST', '/api/save', {'name': 'sauvegarde-automatique'}, {}),
    ('POST', '/api/load', {}, {}),
    ('POST', '/api/load', {'name': 'absente'}, {}),
    ('POST', '/api/load', {'name': '../server'}, {}),
    ('POST', '/api/load', {'name': 'abimee'}, {}),
    ('POST', '/api/load', {'name': ['x']}, {}),
    ('POST', '/api/new', {'dept': '33'}, {'Content-Type': 'text/plain'}),
    ('POST', '/api/new', {'dept': 'xx'}, {}),
    ('POST', '/api/quit', {}, {}),
    ('GET', '/api/info', None, {}),
    ('GET', '/../server.py', None, {}),
    ('GET', '/%2e%2e/server.py', None, {}),
    ('GET', '/js/absent.js', None, {}),
    ('GET', '/api/saves', None, {'Host': 'evil.example'}),
    ('POST', '/api/skirmish', {}, {}),
    ('POST', '/api/skirmish', {'me': '33'}, {}),
    ('POST', '/api/skirmish', {'me': '33', 'units': {'x': 'deux'}}, {}),
    ('POST', '/api/skirmish', {'me': '33', 'units': {'inconnu': 2}}, {}),
]


def main():
    saves = tempfile.mkdtemp()
    server.SAVES = saves
    for i, (nom, texte) in enumerate(FICHIERS.items()):
        with open(os.path.join(saves, nom), 'w', encoding='utf-8') as f:
            f.write(texte)
        os.utime(os.path.join(saves, nom), (1.7e9 + i * 60, 1.7e9 + i * 60))   # (dans cet ordre : la plus récente à la fin)
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        server.APP = server.App()
    srv = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]

    def req(method, path, body=None, headers=None, gzip=False):
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=60)
        data = json.dumps(body).encode() if isinstance(body, (dict, list, str)) else body
        h = {'Content-Type': 'application/json', **({'Accept-Encoding': 'gzip'} if gzip else {}), **(headers or {})}
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        out = r.status, r.getheader('Content-Type'), r.read()
        c.close()
        return out

    ref = {'fichiers': FICHIERS}
    st, ctype, raw = req('GET', '/api/map')
    d = json.loads(raw)
    ref['map'] = dict(status=st, type=ctype, octets=len(raw), sha256=hashlib.sha256(raw).hexdigest(), geo=d['geo'],
                      cles=list(d), cles_carte=list(d['map']), noeuds=len(d['map']['nodes']), ver=d['ver'])
    ref['requetes'] = []
    for method, path, body, headers in REQUETES:
        st, ctype, raw = req(method, path, body, headers)
        ref['requetes'].append(dict(method=method, path=path, body=body.decode() if isinstance(body, bytes) else body,
                                    headers=headers, status=st, type=ctype, text=raw.decode('utf-8', 'replace')))
    st, ctype, raw = req('GET', '/api/saves')
    s = json.loads(raw)
    for x in s['saves']:
        del x['mtime']
        if '-illisible-' in x['name']:   # (suivi de la date et de l'heure)
            x['name'] = x['name'].split('-illisible-')[0] + '-illisible-*'
    ref['saves'] = dict(status=st, saves=s['saves'], running=s['running'])
    ref['illisible'] = sorted(n for n in os.listdir(saves) if 'illisible' in n) != [] \
        and not os.path.exists(os.path.join(saves, 'sauvegarde-automatique.json'))
    # une bataille du mode Bataille, à la même graine : le même identifiant
    corps = {'me': '33', 'foe': '24', 'seed': 1, 'units': {SK.units_for('1790', False)[0]: 2}}
    st, ctype, raw = req('POST', '/api/skirmish', corps)
    ref['escarmouche'] = dict(body=corps, status=st, text=raw.decode())
    srv.shutdown()
    commun.ecrire('serveur', ref)


if __name__ == '__main__':
    main()
