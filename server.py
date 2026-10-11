#!/usr/bin/env python3
"""Conquête (Aquitaine 1790) — serveur local du jeu.

Lancement :  python server.py            (puis ouvrir http://127.0.0.1:8790)
Options   :  --port 8790  --lan  --local  --no-browser  --browser
Sur un Raspberry Pi (ou un Linux sans écran), le jeu s'ouvre tout seul au réseau local,
n'essaie pas de lancer de navigateur et affiche son adresse réseau.
Aucune dépendance externe : Python 3.8+ suffit (Windows, Linux, macOS, Termux).
"""
import argparse
import gzip
import json
import math
import mimetypes
import os
import re
import socket
import subprocess
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
ADDR_FILE = os.path.join(ROOT, 'adresse-reseau.txt')
AUTOSAVE = 'sauvegarde-automatique'
sys.path.insert(0, ROOT)

from game import cities as CT  # noqa: E402
from game import diplomacy as D  # noqa: E402
from game import events as EV  # noqa: E402
from game import rules as R  # noqa: E402
from game import views as V  # noqa: E402
from game.engine import Game  # noqa: E402
from game.geo import GeoMap  # noqa: E402


class App:
    def __init__(self):
        t0 = time.time()
        print('Préparation de la carte de l\'Aquitaine…', flush=True)
        self.geo = GeoMap()
        nw = sum(1 for e in self.geo.edges if e.get('kind') == 'water')
        print(f'Carte prête ({time.time() - t0:.1f} s) : {len(self.geo.nodes)} villes et villages, '
              f'{len(self.geo.edges) - nw} routes, {nw} tronçons navigables.', flush=True)
        self.game = None
        self.lock = threading.RLock()
        self.port = 8790
        self.lan = False
        self.ips = []
        payload = dict(map=self.geo.client_payload(), rules=V.rules_payload())
        raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), default=str).encode('utf-8')
        self.static_raw = raw
        self.static_gz = gzip.compress(raw, 6)
        os.makedirs(SAVES, exist_ok=True)
        self._auto_key = None
        self.load_autosave()

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
                        self.autosave_tick()
                    except Exception:
                        traceback.print_exc()
                        self.game.speed_idx = 0

    # ------------------------------------------------------------------ commandes
    def _node(self, v):
        nid = int(v)
        if not self.game.valid_node(nid):
            raise ValueError('lieu inconnu')
        return nid

    @staticmethod
    def _num(v):
        x = float(v)
        if not math.isfinite(x):
            raise ValueError('nombre invalide')
        return x

    def command(self, body):
        g = self.game
        if not g:
            return dict(ok=False, msg='Aucune partie en cours.')
        if not isinstance(body, dict):
            return dict(ok=False, msg='Commande invalide.')
        p = g.player
        c = body.get('cmd')
        a = body.get('army')
        try:
            if c == 'speed':
                if g.over:
                    return dict(ok=False, msg='La partie est terminée.')
                g.speed_idx = max(0, min(len(R.SPEEDS) - 1, int(self._num(body.get('value', 0)))))
                return dict(ok=True)
            if c == 'move':
                x, y = body.get('x'), body.get('y')
                node = body.get('node')
                return self._r(g.order_move(p, a, None if x is None else self._num(x), None if y is None else self._num(y),
                                            None if node is None else self._node(node), body.get('mode')))
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
            if c == 'split_type':
                return self._r(g.split_by_type(p, a, body.get('value')))
            if c == 'formation':
                return self._r(g.set_formation(p, a, body.get('value')))
            if c == 'plan':
                return self._r(g.set_plan(p, a, body.get('value')))
            if c == 'spy':
                return self._r(g.spy(p, self._node(body['node']), body.get('value')))
            if c == 'tax':
                return self._r(g.set_tax(p, body.get('value', 0.5)))
            if c == 'form':
                return self._r(g.form_army(p, self._node(body['node']), body.get('regs', []), body.get('into')))
            if c == 'take':
                return self._r(g.form_army(p, self._node(body['node']), body.get('regs', []), a))
            if c == 'recruit':
                return self._r(g.recruit(p, self._node(body['node']), body.get('unit')))
            if c == 'build':
                return self._r(g.build(p, self._node(body['node']), body.get('what')))
            # villes : emplacements et politique (game/cities.py)
            if c == 'slot_build':
                return self._r(CT.slot_build(g, p, self._node(body['node']), str(body.get('chain'))))
            if c == 'slot_demolish':
                return self._r(CT.demolish(g, p, self._node(body['node']), str(body.get('chain'))))
            if c == 'policy':
                return self._r(CT.set_policy(g, p, self._node(body['node']), str(body.get('value')), bool(body.get('all'))))
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
            if c == 'event':
                return self._r(EV.resolve(g, str(body.get('id')), int(self._num(body.get('choice', -1)))))
            if c == 'rearm':
                node = body.get('node')
                return self._r(g.rearm(p, army_id=a if node is None else None,
                                       nid=None if node is None else self._node(node)))
            if c == 'reflex':
                ar = g.armies.get(a)
                if ar and ar['owner'] == p:
                    ar['rx'] = bool(body.get('value'))
                    return dict(ok=True, msg='Carré réflexe activé.' if ar['rx'] else 'Carré réflexe désactivé : '
                                                                                      'vous formerez le carré vous-même.')
                return dict(ok=False, msg='Armée introuvable.')
            if c == 'enroll':
                frm = body.get('from')
                if frm not in g.factions and frm != R.NEUTRAL:
                    return dict(ok=False, msg='Origine inconnue.')
                return self._r(g.enroll(p, frm))
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
        except (KeyError, ValueError, TypeError, OverflowError, IndexError) as e:
            return dict(ok=False, msg=f'Commande invalide ({e}).')
        except Exception:
            traceback.print_exc()
            return dict(ok=False, msg='Erreur interne : commande ignorée.')
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
        if not self.game:
            return dict(ok=False, msg='Aucune partie à sauvegarder.')
        try:
            self.write_save(name)
        except OSError as e:
            return dict(ok=False, msg=f'Sauvegarde impossible ({e.strerror or e}).')
        return dict(ok=True, msg=f'Partie sauvegardée : « {name} ».')

    def write_save(self, name, auto=False):
        g = self.game
        data = dict(meta=dict(player=g.player, faction=g.fname(g.player), date=g.date_str(), t=g.t,
                              difficulty=g.difficulty, auto=auto), game=V.to_dict(g))
        path = os.path.join(SAVES, name + '.json')
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, path)  # écriture atomique : une coupure de courant ne corrompt pas la sauvegarde

    def net_info(self):
        """Adresses à taper sur l'iPad ou un autre appareil du réseau local."""
        urls = [f'http://{ip}:{self.port}' for ip in self.ips]
        if self.lan:
            urls.append(f'http://{socket.gethostname()}.local:{self.port}')
        return dict(lan=self.lan, port=self.port, urls=urls if self.lan else [], host=socket.gethostname())

    def autosave_tick(self):
        """Sauvegarde automatique au début de chaque mois de jeu (et à la fin de la partie)."""
        g = self.game
        d = g.date()
        key = (id(g), d.year, d.month, bool(g.over))
        if self._auto_key is None or self._auto_key[0] != id(g):
            self._auto_key = key
            return
        if key != self._auto_key:
            self._auto_key = key
            try:
                self.write_save(AUTOSAVE, auto=True)
            except OSError:
                traceback.print_exc()

    def load_autosave(self):
        path = os.path.join(SAVES, AUTOSAVE + '.json')
        if not os.path.exists(path):
            return
        try:
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
            if data['game'].get('over'):
                return
            self.game = V.from_dict(self.geo, data['game'])
            print(f"Partie reprise depuis la sauvegarde automatique ({data['meta'].get('faction')}, "
                  f"{data['meta'].get('date')}).", flush=True)
        except Exception:
            traceback.print_exc()

    def load(self, name):
        path = os.path.join(SAVES, os.path.basename(name or '') + '.json')
        if not os.path.exists(path):
            return dict(ok=False, msg='Sauvegarde introuvable.')
        try:
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
            game = V.from_dict(self.geo, data['game'])
        except Exception:
            traceback.print_exc()
            return dict(ok=False, msg='Sauvegarde illisible ou abîmée.')
        self.game = game
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
            body = json.loads(self.rfile.read(n).decode('utf-8'))
        except Exception:
            return {}
        return body if isinstance(body, dict) else {}

    def do_GET(self):
        u = urlparse(self.path)
        path = u.path
        if path == '/api/map':
            if 'gzip' in self.headers.get('Accept-Encoding', ''):
                return self._send(200, APP.static_raw, gz=APP.static_gz)
            return self._send(200, APP.static_raw)
        if path == '/api/state':
            q = parse_qs(u.query)
            try:
                since = int(q.get('since', ['0'])[0] or 0)
            except ValueError:
                since = 0
            with APP.lock:
                if not APP.game:
                    return self._json(dict(game=None))
                return self._json(V.player_state(APP.game, since))
        if path == '/api/saves':
            return self._json(dict(saves=APP.list_saves(), running=APP.game is not None, net=APP.net_info()))
        if path == '/api/info':
            return self._json(APP.net_info())
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
                try:
                    seed = int(body['seed']) if body.get('seed') else None
                except (TypeError, ValueError, OverflowError):
                    seed = None
                APP.game = Game(APP.geo, dept, body.get('difficulty', 'normal'), seed, body.get('scenario', '1790'))
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
    """Adresses IPv4 de la machine sur le réseau local (pour jouer depuis une tablette)."""
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))  # aucun paquet n'est envoyé
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    if sys.platform.startswith('linux'):
        try:  # toutes les interfaces (Wi-Fi et câble) sur Raspberry Pi OS / Debian
            out = subprocess.run(['hostname', '-I'], capture_output=True, text=True, timeout=2).stdout
            ips += [ip for ip in out.split() if '.' in ip]
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.append(info[4][0])
    except OSError:
        pass
    seen = []
    for ip in ips:
        if ip not in seen and not ip.startswith(('127.', '169.254.', '0.')):
            seen.append(ip)
    return seen


def is_raspberry():
    for p in ('/proc/device-tree/model', '/sys/firmware/devicetree/base/model'):
        try:
            with open(p, 'rb') as f:
                if b'Raspberry Pi' in f.read():
                    return True
        except OSError:
            pass
    return False


def is_headless():
    """Linux sans écran graphique (Raspberry Pi en SSH, service systemd…), hors Termux sur Android."""
    if not sys.platform.startswith('linux') or 'com.termux' in os.environ.get('PREFIX', ''):
        return False
    return not (os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY'))


def banner(app, local_url, why=''):
    host = socket.gethostname()
    lines = ['', '  ' + '=' * 62, '   Conquête (Aquitaine 1790) est prêt' + (f'  [{why}]' if why else ''), '']
    if app.lan:
        if app.ips:
            lines.append('   Pour jouer depuis l\'iPad, un téléphone ou un PC du réseau local,')
            lines.append('   ouvrez le navigateur à l\'une de ces adresses :')
            lines.append('')
            for ip in app.ips:
                lines.append(f'      http://{ip}:{app.port}')
            lines.append(f'      http://{host}.local:{app.port}')
        else:
            lines.append('   Réseau pas encore disponible : l\'adresse s\'affichera dès que')
            lines.append('   le Wi-Fi ou le câble sera connecté.')
        lines.append('')
        lines.append(f'   Sur cette machine : {local_url}')
    else:
        lines.append(f'   Ouvrez : {local_url}')
        lines.append('   (pour jouer depuis l\'iPad : relancez avec --lan)')
    lines += ['  ' + '=' * 62, '   (Ctrl+C pour arrêter)', '']
    print('\n'.join(lines), flush=True)
    if app.lan:
        try:
            with open(ADDR_FILE, 'w', encoding='utf-8') as f:
                f.write('Conquête : adresses pour jouer depuis le réseau local\n\n')
                for ip in app.ips:
                    f.write(f'http://{ip}:{app.port}\n')
                f.write(f'http://{host}.local:{app.port}\n')
        except OSError:
            pass


def watch_network(app, local_url):
    """Au démarrage du Raspberry, le Wi-Fi arrive parfois après le jeu : on réaffiche l'adresse dès qu'elle change."""
    while True:
        time.sleep(15)
        ips = lan_addresses()
        if ips != app.ips:
            app.ips = ips
            banner(app, local_url, 'nouvelle adresse réseau')


def main():
    global APP
    ap = argparse.ArgumentParser(description='Conquête — serveur local')
    ap.add_argument('--host', default=None, help='adresse d\'écoute (0.0.0.0 = tout le réseau local)')
    ap.add_argument('--port', type=int, default=8790)
    ap.add_argument('--lan', action='store_true', help='ouvrir le jeu aux autres appareils du réseau local (iPad, téléphone…)')
    ap.add_argument('--local', action='store_true', help='n\'accepter que les connexions de cette machine')
    ap.add_argument('--no-browser', action='store_true', help='ne pas ouvrir le navigateur')
    ap.add_argument('--browser', action='store_true', help='ouvrir le navigateur même sur un Raspberry Pi')
    args = ap.parse_args()
    rpi = is_raspberry()
    auto = rpi or is_headless()  # Raspberry Pi ou machine sans écran : réseau local, pas de navigateur
    if args.local:
        host = '127.0.0.1'
    elif args.lan or (auto and args.host is None):
        host = '0.0.0.0'
    else:
        host = args.host or '127.0.0.1'
    open_browser = args.browser or (not args.no_browser and not auto)
    mimetypes.add_type('application/javascript', '.js')
    mimetypes.add_type('text/css', '.css')
    mimetypes.add_type('application/manifest+json', '.webmanifest')
    APP = App()
    APP.port = args.port
    APP.lan = host in ('0.0.0.0', '')
    APP.ips = lan_addresses() if APP.lan else []
    threading.Thread(target=APP.loop, daemon=True).start()
    try:
        srv = ThreadingHTTPServer((host, args.port), Handler)
    except OSError as e:
        print(f'\nImpossible d\'ouvrir le port {args.port} ({e}). Le jeu tourne peut-être déjà : essayez --port 8791.', flush=True)
        sys.exit(1)
    url = f'http://127.0.0.1:{args.port}' if APP.lan else f'http://{host}:{args.port}'
    banner(APP, url, 'Raspberry Pi' if rpi else ('sans écran' if auto and not args.lan else ''))
    if APP.lan:
        threading.Thread(target=watch_network, args=(APP, url), daemon=True).start()
    if open_browser:
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
