"""Lance tous les bancs d'essai : python3 tests/lancer.py (environ 25 s sur un Raspberry Pi).

- bancs Python (test_*.py) : batailles, campagne, serveur ;
- banc de l'interface sous Node (*.test.mjs), sauté si Node n'est pas installé.
Code de sortie 0 si tout passe.
"""
import os
import shutil
import subprocess
import sys

ICI = os.path.dirname(os.path.abspath(__file__))

py = subprocess.call([sys.executable, '-m', 'unittest', 'discover', '-s', ICI, '-t', ICI])
node = shutil.which('node')
if node:
    js = subprocess.call([node, '--test', '--test-reporter=dot', os.path.join(ICI, 'interface.test.mjs')])
else:
    print("Node absent : banc de l'interface sauté (https://nodejs.org).")
    js = 0
print('\nTout passe.' if not (py or js) else '\nÉchec : voir ci-dessus.')
sys.exit(1 if py or js else 0)
