"""Commun aux jumeaux Python du portage en Rust (rust/conquete/PORTAGE.md).

- canon(o), empreinte(o) : la forme des références (clés triées, compacte, flottants entiers écrits en entiers,
  tuples en listes, sets en listes triées, tableaux d'octets et array en listes) et son SHA-256 ; les mêmes que
  py::json::dumps_ref et py::json::empreinte en Rust ;
- tracer_hasard(fichier) : chaque tirage élémentaire de random.Random part dans un fichier (« r valeur lieu » ou
  « b valeur lieu »), comme CONQUETE_TRACE_HASARD côté Rust : le premier tirage qui diffère désigne la fonction fautive.
    à appeler AVANT d'importer game.
"""
import array
import hashlib
import json
import os
import random
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REFS = os.path.join(RACINE, 'rust', 'conquete', 'tests', 'references')
sys.path.insert(0, RACINE)


def _plat(o):
    if isinstance(o, bool) or o is None or isinstance(o, (int, str)):
        return o
    if isinstance(o, float):
        return int(o) if o == o and abs(o) < 9007199254740992.0 and o == int(o) else o
    if isinstance(o, dict):
        return {k: _plat(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_plat(v) for v in o]
    if isinstance(o, (set, frozenset)):
        return [_plat(v) for v in sorted(o)]
    if isinstance(o, (bytes, bytearray, array.array)):
        return [_plat(v) for v in o]
    raise TypeError(f'canon : {type(o).__name__} ne se range pas dans une référence')


def canon(o):
    return json.dumps(_plat(o), sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def empreinte(o):
    return hashlib.sha256(canon(o).encode('utf-8')).hexdigest()


def ecrire(nom, ref):
    """Range une référence : rust/conquete/tests/references/<nom>.json (compacte, flottants à la repr)."""
    with open(os.path.join(REFS, nom + '.json'), 'w', encoding='utf-8') as f:
        json.dump(ref, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{nom}.json écrit ({os.path.getsize(os.path.join(REFS, nom + ".json")) // 1024} Ko)')


def tracer_hasard(fichier):
    sortie = open(fichier, 'w', encoding='utf-8')
    ici = os.path.abspath(__file__)

    def lieu():
        f = sys._getframe(2)
        while f and (f.f_code.co_filename == ici or f.f_code.co_filename == random.__file__):
            f = f.f_back
        return f'{os.path.relpath(f.f_code.co_filename, RACINE)}:{f.f_lineno}' if f else '?'

    class Trace(random.Random):
        def random(self):
            v = super().random()
            sortie.write(f'r {v!r} {lieu()}\n')
            return v

        def getrandbits(self, k):
            v = super().getrandbits(k)
            sortie.write(f'b {v} {lieu()}\n')
            return v

    random.Random = Trace
    return sortie
