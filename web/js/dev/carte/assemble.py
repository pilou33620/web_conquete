import json, re
B = json.load(open('carte/blocs.json'))['blocks']
VEUT = """TAU PEAU clamp lerp mod ease alea hx MEMO mix sombre clair E C T RR PG ligne dup
SOLS HERBE BOIS OMBRE parcelle arbre touffes bois haie chemin decaler route rue riviere pont toit ferme mare botte moutons cloture verger calvaire pietine cratere
tenue GRAINE unite placer BOUGE CHEVAL poseFig fusil bras tete fantassin cheval cavalier piece avant caisson corps drapeau
SPR sprite fumee eclair etincelle terre copeaux boulet ajouterCorps figAuHasard cibleDe impact tirs majUnite Scene
DPR KT
surPoly distPoly longueur surChemin angLerp TOITS ruisseau potager epouvantail charrue ruche tasBois linge abreuvoir souche tronc stere charbonniere sapin dessinMaison flammes
PAL SOLEIL OMB teinte teinteL pignon pyramideF coneF domeF mansardeF empreinte dessinPart bat croix cheminee parterre BATS
bastions chemin_ LPIECE dessinerEnceinte decalerQuad aire toitParcelle remplirIlot camAnim brancher""".split()
veut = set(VEUT)
out = []
for k, b in enumerate(B):
    code = b['code']
    if b['kind'] == 'stmt':
        if code.startswith("sprite('f'") or (code.startswith('{') and 'SPR.fl' in code): out.append(code)
        continue
    if veut & set(b['names']):
        if 'DPR' in b['names']: code = code.split('\n')[0]
        out.append(code)
lib = '\n'.join(out)
lib = lib.replace("sc.zB = () => [Math.max(sc.cssW / Wd, sc.cssH / Hd), 4.5];", "sc.zB = () => [Math.max(sc.cssW / Wd, sc.cssH / Hd), sc.zMax || 4.5];")
lib = lib.replace("const sides = fau ? edges.filter((e, k) => [b.j === V.j0, b.i + 1 === V.i0, b.j + 1 === V.j0, b.i === V.i0][k])", "const sides = fau ? edges.filter((e, k) => (b.cotes || [b.j === V.j0, b.i + 1 === V.i0, b.j + 1 === V.j0, b.i === V.i0])[k])")
lib = lib.replace("const dmax = Math.min(cote * .36, 11)", "const dmax = Math.min(cote * .36, V.prof || 11)")
lib = lib.replace("chemin_(g, inn); g.fillStyle = '#7c9a52'; g.fill(); for (let i = 0; i < 4; i++) arbre(", "chemin_(g, inn); g.fillStyle = b.aire > 2600 ? '#7c9a52' : '#cdbf9f'; g.fill(); for (let i = 0; i < 4; i++) arbre(")
lib = lib.replace("const n = w * h, pt = (cnt, fn)", "const n = w * h * (p.det ?? 1), pt = (cnt, fn)")
assert "p.det ?? 1" in lib
assert "b.aire > 2600" in lib
assert "V.prof ||" in lib
assert "b.cotes ||" in lib and "sc.zMax" in lib
open('carte/lib.js','w').write(lib)
new = open('carte/new.js').read() + '\n' + open('carte/vivante.js').read()
geo = open('carte/geo.json').read()
html = open('carte/page.html').read()
html = html.replace('/*GEO*/', geo).replace('/*SCRIPT*/', lib + '\n' + new)
open('carte-et-villes.html','w').write(html)
print(len(html))
