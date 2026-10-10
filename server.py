#!/usr/bin/env python3
"""Conquête (Aquitaine 1790) — serveur local du jeu.

Lancement :  python server.py            (puis ouvrir http://127.0.0.1:8790)
Options   :  --port 8790  --host 127.0.0.1  --no-browser
Aucune dépendance externe : Python 3.8+ suffit (Windows, Linux, macOS, Termux).
"""
import argparse
import gzip
import json
import mimetypes
import os
import re
import socket
import sys
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, 'web')
SAVES = os.path.join(ROOT, 'saves')
sys.path.insert(0, ROOT)

from game import diplomacy as D  # noqa: E402
from game import rules as R  # noqa: E402
from game import views as V  # noqa: E402
from game.engine import Game  # noqa: E402
from game.geo import GeoMap  # noqa: E402


class App:
    def __init__(self):
        t0 = time.time()
        print('Préparation de la carte de l\'Aquitaine…', flush=True)
        self.geo = GeoMap()
        print(f'Carte prête ({time.time() - t0:.1f} s) : {len(self.geo.nodes)} villes et villages, '
              f'{len(self.geo.edges)} routes.', flush=True)
        self.game = None
        self.lock = threading.RLock()
        payload = dict(map=self.geo.client_payload(), rules=V.rules_payload())
        raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), default=str).encode('utf-8')
        self.static_raw = raw
        self.static_gz = gzip.compress(raw, 6)
        os.makedirs(SAVES, exist_ok=True)

    def loop(self):
        last = time.monotonic()
        while True:
            time.sleep(0.1)
            now = time.monotonic()
            dt = min(0.3, now - last)
            last = now
            with self.lock:
                if self.game:
                    try:
                        self.game.advance(dt)
                    except Exception:
                        traceback.print_exc()
                        self.game.speed_idx = 0

    # ------------------------------------------------------------------ commandes
    def command(self, body):
        g = self.game
        if not g:
            return dict(ok=False, msg='Aucune partie en cours.')
        p = g.player
        c = body.get('cmd')
        a = body.get('army')
        try:
            if c == 'speed':
                if g.over:
                    return dict(ok=False, msg='La partie est terminée.')
                g.speed_idx = max(0, min(len(R.SPEEDS) - 1, int(body.get('value', 0))))
                return dict(ok=True)
            if c == 'move':
                x, y = body.get('x'), body.get('y')
                return self._r(g.order_move(p, a, None if x is None else float(x), None if y is None else float(y),
                                            body.get('node'), body.get('mode')))
            if c == 'path':
                return self._r(g.order_path(p, a, body.get('pts') or []))
            if c == 'stance':
                return self._r(g.set_stance(p, a, body.get('value')))
            if c == 'retreat':
                return self._r(g.order_retreat(p, a))
            if c == 'assault':
                return self._r(g.assault(p, a))
            if c == 'garrison':
                return self._r(g.to_garrison(p, a))
            if c == 'split':
                return self._r(g.split(p, a, body.get('regs', [])))
            if c == 'merge':
                return self._r(g.merge(p, a, body.get('other')))
            if c == 'form':
                return self._r(g.form_army(p, int(body['node']), body.get('regs', []), body.get('into')))
            if c == 'take':
                return self._r(g.form_army(p, int(body['node']), body.get('regs', []), a))
            if c == 'recruit':
                return self._r(g.recruit(p, int(body['node']), body.get('unit')))
            if c == 'build':
                return self._r(g.build(p, int(body['node']), body.get('what')))
            if c == 'research':
                return self._r(g.research(p, body.get('tech')))
            if c == 'slider':
                return self._r(g.set_slider(p, body.get('value', 0.5)))
            if c == 'market':
                return self._r(g.market_trade(p, body.get('res'), body.get('qty', 0), body.get('side')))
            if c == 'mode':
                ar = g.armies.get(a)
                if ar and ar['owner'] == p and body.get('value') in ('route', 'champs'):
                    ar['mode'] = body['value']
                    return dict(ok=True)
                return dict(ok=False, msg='Armée introuvable.')
            if c == 'rename':
                ar = g.armies.get(a)
                name = str(body.get('value', ''))[:40].strip()
                if ar and ar['owner'] == p and name:
                    ar['name'] = name
                    return dict(ok=True)
                return dict(ok=False, msg='Nom invalide.')
            if c == 'diplo':
                give = body.get('give')
                get = body.get('get')
                ok, msg = D.act(g, p, body.get('to'), body.get('action'), body.get('amount', 0),
                                tuple(give) if give else None, tuple(get) if get else None)
                return dict(ok=bool(ok), msg=msg, pending=ok is None)
            if c == 'answer':
                return self._r(D.answer(g, body.get('id'), bool(body.get('accept'))))
        except (KeyError, ValueError, TypeError) as e:
            return dict(ok=False, msg=f'Commande invalide ({e}).')
        return dict(ok=False, msg='Commande inconnue.')

    @staticmethod
    def _r(res):
        ok, msg = res
        if ok and isinstance(msg, str) and msg.startswith(('a', 'r')) and msg[1:].isdigit():
            return dict(ok=True, id=msg)
        return dict(ok=bool(ok), msg=msg)

    # ------------------------------------------------------------------ sauvegardes
    def list_saves(self):
        out = []
        for fn in sorted(os.listdir(SAVES)):
            if not fn.endswith('.json'):
                continue
            path = os.path.join(SAVES, fn)
            try:
                with open(path, encoding='utf-8') as f:
                    meta = json.load(f).get('meta', {})
            except Exception:
                meta = {}
            out.append(dict(name=fn[:-5], mtime=os.path.getmtime(path), **meta))
        out.sort(key=lambda s: -s['mtime'])
        return out

    def save(self, name):
        name = re.sub(r'[^A-Za-z0-9_\- àâäéèêëîïôöùûüç]', '', name or '').strip()[:40] or 'partie'
        g = self.game
        if not g:
            return dict(ok=False, msg='Aucune partie à sauvegarder.')
        data = dict(meta=dict(player=g.player, faction=R.FACTIONS[g.player]['name'], date=g.date_str(), t=g.t,
                              difficulty=g.difficulty), game=V.to_dict(g))
        with open(os.path.join(SAVES, name + '.json'), 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)
        return dict(ok=True, msg=f'Partie sauvegardée : « {name} ».')

    def load(self, name):
        path = os.path.join(SAVES, os.path.basename(name or '') + '.json')
        if not os.path.exists(path):
            return dict(ok=False, msg='Sauvegarde introuvable.')
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        self.game = V.from_dict(self.geo, data['game'])
        return dict(ok=True, msg=f'Partie « {name} » chargée.')


APP = None


class Handler(BaseHTTPRequestHandler):
    server_version = 'Conquete/1.0'

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype='application/json; charset=utf-8', gz=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Cache-Control', 'no-store')
        if gz is not None:
            self.send_header('Content-Encoding', 'gzip')
            body = gz
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        raw = json.dumps(obj, ensure_ascii=False, separators=(',', ':'), default=str).encode('utf-8')
        if len(raw) > 4000 and 'gzip' in self.headers.get('Accept-Encoding', ''):
            self._send(code, raw, gz=gzip.compress(raw, 4))
        else:
            self._send(code, raw)

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode('utf-8'))
        except Exception:
            return {}

    def do_GET(self):
        u = urlparse(self.path)
        path = u.path
        if path == '/api/map':
            if 'gzip' in self.headers.get('Accept-Encoding', ''):
                return self._send(200, APP.static_raw, gz=APP.static_gz)
            return self._send(200, APP.static_raw)
        if path == '/api/state':
            q = parse_qs(u.query)
            since = int(q.get('since', ['0'])[0] or 0)
            with APP.lock:
                if not APP.game:
                    return self._json(dict(game=None))
                return self._json(V.player_state(APP.game, since))
        if path == '/api/saves':
            return self._json(dict(saves=APP.list_saves(), running=APP.game is not None))
        if path == '/' or path == '':
            path = '/index.html'
        full = os.path.normpath(os.path.join(WEB, path.lstrip('/')))
        if not full.startswith(WEB) or not os.path.isfile(full):
            return self._send(404, b'Not found', 'text/plain')
        ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        if ctype.startswith('text/') or ctype in ('application/javascript',):
            ctype += '; charset=utf-8'
        with open(full, 'rb') as f:
            self._send(200, f.read(), ctype)

    def do_POST(self):
        path = urlparse(self.path).path
        body = self._body()
        with APP.lock:
            if path == '/api/new':
                dept = body.get('dept')
                if dept not in R.FACTIONS:
                    return self._json(dict(ok=False, msg='Département inconnu.'), 400)
                seed = body.get('seed')
                APP.game = Game(APP.geo, dept, body.get('difficulty', 'normal'), int(seed) if seed else None)
                return self._json(dict(ok=True))
            if path == '/api/cmd':
                return self._json(APP.command(body))
            if path == '/api/save':
                return self._json(APP.save(body.get('name')))
            if path == '/api/load':
                return self._json(APP.load(body.get('name')))
            if path == '/api/quit':
                APP.game = None
                return self._json(dict(ok=True))
        self._json(dict(ok=False, msg='Route inconnue.'), 404)


def lan_addresses():
    """Adresses IP de la machine sur le réseau local (pour jouer depuis une tablette)."""
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))  # aucun paquet n'est envoyé
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith('127.'):
                ips.append(ip)
    except OSError:
        pass
    return ips


def main():
    global APP
    ap = argparse.ArgumentParser(description='Conquête — serveur local')
    ap.add_argument('--host', default='127.0.0.1', help='adresse d\'écoute (0.0.0.0 = tout le réseau local)')
    ap.add_argument('--port', type=int, default=8790)
    ap.add_argument('--lan', action='store_true', help='ouvrir le jeu aux autres appareils du réseau local (iPad, téléphone…)')
    ap.add_argument('--no-browser', action='store_true')
    args = ap.parse_args()
    if args.lan:
        args.host = '0.0.0.0'
    mimetypes.add_type('application/javascript', '.js')
    mimetypes.add_type('text/css', '.css')
    mimetypes.add_type('application/manifest+json', '.webmanifest')
    APP = App()
    threading.Thread(target=APP.loop, daemon=True).start()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f'http://{"127.0.0.1" if args.host in ("0.0.0.0", "") else args.host}:{args.port}'
    print(f'\n  Conquête (Aquitaine 1790) est prêt : {url}', flush=True)
    if args.host in ('0.0.0.0', ''):
        ips = lan_addresses()
        host = socket.gethostname()
        print('  Depuis l\'iPad ou un autre appareil du même réseau Wi-Fi :', flush=True)
        for ip in ips:
            print(f'    http://{ip}:{args.port}', flush=True)
        print(f'    http://{host}.local:{args.port}', flush=True)
    print('  (Ctrl+C pour arrêter)\n', flush=True)
    if not args.no_browser:
        try:
            threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        except Exception:
            pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nAu revoir !')


if __name__ == '__main__':
    main()
