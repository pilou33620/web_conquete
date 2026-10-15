"""Villes : emplacements et chaînes de bâtiments, politique de la ville, petits événements locaux.

Emplacements : chaque place en a selon sa taille (village et place forte 1, ville 3, chef-lieu 5), plus un par
agrandissement. Chacun accueille une chaîne de bâtiments (trois niveaux au plus), bâtie dans la file de la place
comme les remparts. Fortifications et agrandissements restent hors emplacements ; le magasin aux vivres en occupe un.

Politique : une orientation par place (Équilibre par défaut), avec un bonus et une contrepartie ; un changement
prend effet peu à peu, en POLICY_TOURS tour (au début du tour suivant).

Événements locaux : incendie, fièvre, disette, brigands, foire, crue, réfugiés, filon, émeute. Ils ne touchent que
la ville concernée. Pour le joueur, ils passent par les décisions de events.py (fenêtre de choix, pause) ;
les IA choisissent aussitôt.

Données d'une place (dans game.nodes) :
  slots  {chaîne: niveau}       niveau 0 = premier niveau en chantier ; l'ordre est celui des emplacements
  pol    {k, p, t, u, o}        politique, précédente, début et fin du changement, camp qui l'a choisie
  tm     [{k, v, until}]        effets passagers d'un événement (production de la ville)
  bo     {ressource: par jour}  effets durables d'un événement (un filon)
  evt    date du dernier événement local
"""
from . import rules as R
from . import events as EV
from . import turns as TT

SLOTS = dict(village=1, fort=1, ville=3, capitale=5)   # +1 par niveau d'agrandissement
PROD = ('livres', 'vivres', 'recrues', 'industrie', 'fer', 'bois')
POLICY_TOURS = 1          # transition d'une politique à l'autre
POLICY_OLD_DAYS = 18      # (sauvegardes d'avant les tours : transition en jours)
EV_RATE = 1 / 85          # chance quotidienne d'un événement local, pour un camp (un tous les deux à trois mois)
CITY_GAP = 240            # une même place n'a pas deux événements à moins de huit mois d'écart
SIZE_COST = dict(village=0.5, fort=0.6, ville=1.0, capitale=1.8)   # coûts et gains des événements selon la taille
TOWN_W = dict(capitale=3.0, ville=3.0, fort=1.0, village=0.6)      # places touchées : surtout les villes
TECH_NAME = lambda t: R.TECH[t]['name']

# ------------------------------------------------------------------ chaînes de bâtiments
# fx (totaux du niveau, pas cumulés) :
#   livres vivres recrues industrie fer bois   production de base de la place, par jour (avant population et ordre)
#   spec      part de la spécialité en plus      trade   livres de commerce fluvial (sensibles au blocus)
#   stab      ordre public visé                  grow    croissance de la population
#   train     délai de formation des régiments levés ici (cav_train : cavalerie en plus)
#   xp        expérience des régiments levés ici milice  milice de la place
#   research  jours de recherche gagnés chaque jour (collèges, plafonnés)
#   ev        {événement: part}  chances des événements locaux
CHAINS = {
    'marche': dict(name='Commerce', icon='livres', desc='Marchés et halles : des livres, des foires plus fréquentes.', levels=[
        dict(name='Marché', cost=dict(livres=120, bois=40), days=14, fx=dict(livres=0.1)),
        dict(name='Halle couverte', cost=dict(livres=260, bois=80, outils=15), days=22, dev=1, up=0.05,
             fx=dict(livres=0.2, ev=dict(foire=0.5))),
        dict(name='Bourse de commerce', cost=dict(livres=520, bois=100, fer=40, outils=30), days=32, dev=2, tech='escompte',
             up=0.15, fx=dict(livres=0.35, ev=dict(foire=1.0)))]),
    'moulins': dict(name='Grains', icon='vivres', desc='Moulins et greniers : des vivres, moins de disettes.', levels=[
        dict(name='Moulins', cost=dict(livres=100, bois=50), days=12, fx=dict(vivres=0.2)),
        dict(name='Minoterie', cost=dict(livres=220, bois=80, fer=20, outils=15), days=20, dev=1, up=0.05,
             fx=dict(vivres=0.4, ev=dict(disette=-0.3))),
        dict(name='Greniers d’abondance', cost=dict(livres=400, bois=120, fer=40), days=30, tech='greniers', up=0.1,
             fx=dict(vivres=0.6, ev=dict(disette=-0.6)))]),
    'specialite': dict(name='Spécialité', icon='star', where='star',
                       desc='Ateliers de la spécialité de la ville : elle rapporte davantage.', levels=[
        dict(name='Atelier', cost=dict(livres=140, bois=50), days=15, fx=dict(spec=0.2)),
        dict(name='Maison', cost=dict(livres=300, bois=80, outils=20), days=24, dev=1, up=0.05, fx=dict(spec=0.4)),
        dict(name='Grande maison', cost=dict(livres=560, bois=110, fer=30, outils=30), days=34, dev=2, tech='*', up=0.15,
             fx=dict(spec=0.6))]),
    'atelier': dict(name='Industrie', icon='outils', desc='Ateliers et fabriques : capacité industrielle (armes et outils).', levels=[
        dict(name='Atelier', cost=dict(livres=130, bois=50, fer=20), days=15, fx=dict(industrie=0.1)),
        dict(name='Manufacture', cost=dict(livres=300, bois=80, fer=40, outils=20), days=25, dev=1, tech='manufactures', up=0.05,
             fx=dict(industrie=0.25)),
        dict(name='Fabrique', cost=dict(livres=600, bois=100, fer=80, outils=40), days=36, dev=2, tech='vapeur', up=0.15,
             fx=dict(industrie=0.45, stab=-0.02))]),
    'caserne': dict(name='Garnison', icon='recrues', desc='Casernes : recrues, milice, régiments formés plus vite.', levels=[
        dict(name='Caserne', cost=dict(livres=140, bois=60), days=16, up=0.1, fx=dict(recrues=0.1, train=0.15, milice=40)),
        dict(name='Quartier de cavalerie', cost=dict(livres=280, bois=90, fer=30), days=24, dev=1, tech='haras', up=0.2,
             fx=dict(recrues=0.2, train=0.2, cav_train=0.3, milice=60)),
        dict(name='École militaire', cost=dict(livres=550, bois=120, fer=60), days=35, dev=2, tech='divisions', up=0.35,
             fx=dict(recrues=0.3, train=0.25, cav_train=0.3, xp=15, milice=80))]),
    'hospice': dict(name='Charité', icon='scale', desc='Hospices et collèges : ordre public, croissance, moins de fièvres.', levels=[
        dict(name='Hospice', cost=dict(livres=120, bois=40), days=14, up=0.05, fx=dict(stab=0.03, grow=0.10, ev=dict(epidemie=-0.25))),
        dict(name='Hôtel-Dieu', cost=dict(livres=260, bois=70, outils=20), days=22, dev=1, up=0.15,
             fx=dict(stab=0.05, grow=0.20, ev=dict(epidemie=-0.5))),
        dict(name='Collège', cost=dict(livres=480, bois=90, outils=30), days=30, dev=2, up=0.25,
             fx=dict(stab=0.07, grow=0.25, research=0.03, ev=dict(epidemie=-0.6, emeute=-0.3)))]),
    'quai': dict(name='Port fluvial', icon='anchor', where='quai', desc='Cales et chantiers : commerce par eau, bois, industrie.', levels=[
        dict(name='Cale et entrepôts', cost=dict(livres=120, bois=60), days=14, fx=dict(trade=0.1)),
        dict(name='Chantier de gabares', cost=dict(livres=260, bois=100, fer=20), days=22, dev=1, tech='gabares', up=0.05,
             fx=dict(trade=0.2, bois=0.1)),
        dict(name='Arsenal', cost=dict(livres=520, bois=140, fer=60), days=34, dev=2, tech='armureries', up=0.15,
             fx=dict(trade=0.35, bois=0.15, industrie=0.15))]),
    'depot': dict(name='Magasin aux vivres', icon='depot', desc=R.BUILD['depot']['desc'] + '.', levels=[
        dict(name='Magasin aux vivres', cost=R.BUILD['depot']['cost'](0), days=R.BUILD['depot']['days'](0), fx=dict(depot=1))]),
}
CHAIN_ORDER = ['marche', 'moulins', 'specialite', 'atelier', 'caserne', 'hospice', 'quai', 'depot']
SIZE_K = dict(village=0.5, fort=0.5, ville=1.0, capitale=1.5)   # production des bâtiments selon la taille de la place

# noms des ateliers de spécialité (trois niveaux) et technologie du dernier niveau
SPEC_NAMES = dict(
    grand_vin=(['Chai', 'Maison de négoce', 'Grand chai d’exportation'], 'chais'),
    vin=(['Chai', 'Maison de négoce', 'Comptoir des vins'], 'chais'),
    eau_de_vie=(['Alambics', 'Distillerie', 'Négoce d’eau-de-vie'], 'chais'),
    negoce=(['Comptoir', 'Armement maritime', 'Compagnie de commerce'], 'gabares'),
    peche=(['Pêcherie', 'Saurisserie', 'Armement de pêche'], 'gabares'),
    sel=(['Salines', 'Saunerie', 'Raffinerie de sel'], 'manufactures'),
    prune=(['Séchoirs', 'Conserverie', 'Négoce des pruneaux'], 'foires'),
    terroir=(['Saloirs et fermes', 'Conserverie', 'Foirail'], 'foires'),
    salaisons=(['Saloirs', 'Salaisonnerie', 'Maison de salaisons'], 'foires'),
    betail=(['Étables', 'Foirail', 'Halle aux bestiaux'], 'foires'),
    ble=(['Granges', 'Halle aux grains', 'Négoce des grains'], 'assolement'),
    resine=(['Résinerie', 'Distillerie de térébenthine', 'Usine de produits résineux'], 'gemmage'),
    textile=(['Métiers', 'Draperie', 'Filature'], 'draperies'),
    tabac=(['Séchoirs à tabac', 'Manufacture des tabacs', 'Grande manufacture'], 'draperies'),
    forge=(['Forge', 'Haut fourneau', 'Fonderie'], 'hauts_fourneaux'),
)

# ------------------------------------------------------------------ politiques
POLICIES = {
    'equilibre': dict(label='Équilibre', fx={}, pro='Aucun effet particulier', con=''),
    'commerce': dict(label='Commerce', fx=dict(livres=0.10, vivres=-0.10, recrues=-0.15, ev=dict(foire=0.3)),
                     pro='livres +10 %, foires plus fréquentes', con='vivres −10 %, recrues −15 %'),
    'grenier': dict(label='Grenier', fx=dict(vivres=0.15, livres=-0.08, ev=dict(disette=-0.5)),
                    pro='vivres +15 %, disettes deux fois plus rares', con='livres −8 %'),
    'recrutement': dict(label='Recrutement', fx=dict(recrues=0.25, grow=-0.25, stab=-0.03),
                        pro='recrues +25 %', con='croissance −25 %, ordre public −3 %'),
    'armes': dict(label='Place d’armes', fx=dict(train=0.20, xp=5, stab=0.03, livres=-0.10, ev=dict(brigands=-0.5)),
                  pro='régiments formés 20 % plus vite et plus aguerris, ordre public +3 %, moins de brigands',
                  con='livres −10 %'),
    'fetes': dict(label='Fêtes et culte', fx=dict(stab=0.07, grow=0.15, livres=-0.15, ev=dict(emeute=-0.5)),
                  pro='ordre public +7 %, croissance +15 %, moins d’émeutes', con='livres −15 %'),
}
POLICY_ORDER = ['equilibre', 'commerce', 'grenier', 'recrutement', 'armes', 'fetes']

FX_LABEL = dict(livres='livre', vivres='vivres', recrues='recrues', industrie='industrie', fer='fer', bois='bois')
TM_LABEL = dict(prod='production', livres='livres', vivres='vivres', recrues='recrues', industrie='industrie')


def _n(x):
    return f"{x:.2f}".rstrip('0').rstrip('.').replace('.', ',')


def fx_text(fx, star=None):
    """Effets d'un niveau, en clair (production par tour : TOUR_DAYS jours)."""
    out = []
    for k in PROD:
        if fx.get(k):
            out.append(f"+{_n(fx[k] * TT.TOUR_DAYS)} {FX_LABEL[k] if k != 'livres' or fx[k] * TT.TOUR_DAYS < 2 else 'livres'} /tour")
    if fx.get('trade'):
        out.append(f"+{_n(fx['trade'] * TT.TOUR_DAYS)} livres /tour de commerce par eau")
    if fx.get('spec'):
        out.append(f"spécialité +{round(fx['spec'] * 100)} %")
    if fx.get('stab'):
        out.append(f"ordre public {'+' if fx['stab'] > 0 else '−'}{round(abs(fx['stab']) * 100)} %")
    if fx.get('grow'):
        out.append(f"croissance +{round(fx['grow'] * 100)} %")
    if fx.get('train'):
        out.append(f"régiments formés {round(fx['train'] * 100)} % plus vite"
                   + (f" (cavalerie {round((fx['train'] + fx.get('cav_train', 0)) * 100)} %)" if fx.get('cav_train') else ''))
    if fx.get('xp'):
        out.append(f"régiments levés ici aguerris (+{fx['xp']} d’expérience)")
    if fx.get('milice'):
        out.append(f"milice +{fx['milice']}")
    if fx.get('research'):
        out.append(f"recherches +{round(fx['research'] * 100)} %")
    for k, v in (fx.get('ev') or {}).items():
        lab = LOCAL_BY_ID[k]['short'] if k in LOCAL_BY_ID else k
        out.append(f"{lab} {'plus fréquentes' if v > 0 else 'plus rares'}")
    if fx.get('depot'):
        out.append('ravitaille les armées à moins de 30 km')
    return ', '.join(out)


# ------------------------------------------------------------------ emplacements
def slots(n):
    s = n.get('slots')
    if s is None:
        s = n['slots'] = {'depot': 1} if n.get('depot') else {}
    return s


def slot_count(g, n):
    return SLOTS[g.geo.nodes[n['id']]['type']] + n.get('dev', 0)


def level_name(g, nid, chain, lvl):
    """Nom d'un niveau (1 à 3) ; les ateliers de spécialité changent de nom selon la ville."""
    if chain == 'specialite':
        star = (g.geo.nodes[nid].get('star') or [None])[0]
        if star in SPEC_NAMES:
            return SPEC_NAMES[star][0][lvl - 1]
    return CHAINS[chain]['levels'][lvl - 1]['name']


def level_tech(g, nid, chain, lvl):
    t = CHAINS[chain]['levels'][lvl - 1].get('tech')
    if t == '*':
        star = (g.geo.nodes[nid].get('star') or [None])[0]
        t = SPEC_NAMES.get(star, (None, None))[1]
    return t


def fits(g, nid, chain):
    """La chaîne a-t-elle sa place ici ? (spécialité, quai)"""
    gn = g.geo.nodes[nid]
    w = CHAINS[chain].get('where')
    if w == 'star':
        return bool(gn.get('star')) and gn['star'][0] in R.SPECIALTY
    if w == 'quai':
        return nid in g.geo.ports and gn['type'] != 'fort'
    return True


def check(g, code, n, chain):
    """(niveau visé, raison du refus ou None) pour bâtir ou améliorer cette chaîne ici."""
    nid = n['id']
    if chain not in CHAINS:
        return None, "Bâtiment inconnu."
    if not fits(g, nid, chain):
        return None, ("Il faut une spécialité dans la ville." if CHAINS[chain].get('where') == 'star'
                      else "Il faut un quai sur un fleuve navigable.")
    s = slots(n)
    cur = s.get(chain)
    # (un magasin aux vivres commandé avant les emplacements est encore une file « build »)
    if cur == 0 or any(q['kind'] in ('slot', 'build') and q['what'] == chain for q in n['queue']):
        return None, "Déjà en chantier."
    lvl = 1 if cur is None else cur + 1
    levels = CHAINS[chain]['levels']
    if lvl > len(levels):
        return None, "Niveau maximal atteint."
    if cur is None and len(s) >= slot_count(g, n):
        return None, "Plus d'emplacement libre : agrandissez la ville ou démolissez un bâtiment."
    L = levels[lvl - 1]
    if n.get('dev', 0) < L.get('dev', 0):
        return None, f"Il faut d'abord agrandir la ville (niveau {L['dev']})."
    t = level_tech(g, nid, chain, lvl)
    if t and t not in g.factions[code]['techs']:
        return None, f"Technologie requise : {TECH_NAME(t)}."
    return lvl, None


def slot_build(g, code, nid, chain):
    n = g.nodes[nid]
    gn = g.geo.nodes[nid]
    if n['owner'] != code:
        return False, "Cette ville ne vous appartient pas."
    sync(g, n)
    lvl, why = check(g, code, n, chain)
    if why:
        return False, why
    if n['siege']:
        return False, "La place est assiégée."
    if len(n['queue']) >= 4:
        return False, "File de production pleine."
    L = CHAINS[chain]['levels'][lvl - 1]
    if not g.can_pay(code, L['cost']):
        return False, "Ressources insuffisantes."
    g.pay(code, L['cost'])
    n['queue'].append(dict(kind='slot', what=chain, lvl=lvl, left=L['days'], total=L['days']))
    if lvl == 1:
        slots(n)[chain] = 0   # l'emplacement est pris dès le début du chantier
    name = level_name(g, nid, chain, lvl)
    return True, f"{name} : chantier lancé à {gn['name']}." if lvl == 1 else f"{name} : amélioration lancée à {gn['name']}."


def finish(g, n, q):
    """Fin d'un chantier d'emplacement (appelé par la file de la place)."""
    chain, lvl = q['what'], q['lvl']
    s = slots(n)
    old = s.get(chain) or 0
    s[chain] = lvl
    _milice(n, chain, old, lvl)
    if chain == 'depot':
        n['depot'] = 1
    g._dirty_income = True
    if n['owner'] == g.player:
        gn = g.geo.nodes[n['id']]
        g.log('eco', f"Fin des travaux à {gn['name']} : {level_name(g, n['id'], chain, lvl).lower()}.", gn['x'], gn['y'])


def _milice(n, chain, old, new):
    """Les casernes logent de la milice : on suit la différence entre deux niveaux."""
    lv = CHAINS[chain]['levels']
    a = lv[old - 1]['fx'].get('milice', 0) if old > 0 else 0
    b = lv[new - 1]['fx'].get('milice', 0) if new > 0 else 0
    if a != b:
        n['milice_max'] = max(20.0, n['milice_max'] + b - a)
        n['milice'] = min(n['milice'], n['milice_max'])


def demolish(g, code, nid, chain):
    n = g.nodes[nid]
    gn = g.geo.nodes[nid]
    if n['owner'] != code:
        return False, "Cette ville ne vous appartient pas."
    s = slots(n)
    if chain not in s:
        return False, "Aucun bâtiment de ce type ici."
    if n['siege']:
        return False, "La place est assiégée."
    lvl = s.pop(chain)
    n['queue'] = [q for q in n['queue'] if not (q['kind'] == 'slot' and q['what'] == chain)]
    _milice(n, chain, lvl, 0)
    if chain == 'depot':
        n['depot'] = 0
    g._dirty_income = True
    if lvl == 0:
        return True, f"Chantier abandonné à {gn['name']} : l'emplacement est libre."
    return True, f"Démolition à {gn['name']} : {level_name(g, nid, chain, lvl).lower()} ; l'emplacement est libre."


def sync(g, n):
    """Remet d'accord les emplacements avec la place : magasin pillé, chantier perdu à la prise de la ville,
    ancienne sauvegarde dont le magasin occupe un emplacement, politique d'un ancien maître."""
    s = slots(n)
    if n.get('depot') and 'depot' not in s:
        s['depot'] = 1
    elif not n.get('depot') and s.get('depot'):
        del s['depot']
    for k in [k for k, v in s.items() if v == 0]:
        if not any(q['kind'] == 'slot' and q['what'] == k for q in n['queue']):
            del s[k]
    p = n.get('pol')
    if p and p.get('o') != n['owner']:
        del n['pol']
    if n.get('tm'):
        n['tm'] = [e for e in n['tm'] if e['until'] > g.t]


# ------------------------------------------------------------------ effets
def _add(tot, fx, w=1.0):
    for k, v in fx.items():
        if k == 'ev':
            ev = tot.setdefault('ev', {})
            for e, x in v.items():
                ev[e] = ev.get(e, 0) + x * w
        elif isinstance(v, (int, float)):
            tot[k] = tot.get(k, 0) + v * w


_EMPTY = {}
_PFX = {}
_BFX = {}   # effets d'une combinaison de bâtiments (ne dépend que des emplacements) : calculés une fois


def bfx(n):
    """Effets cumulés des bâtiments achevés de la place (dictionnaire partagé : ne pas le modifier)."""
    s = n.get('slots')
    if not s:
        return _EMPTY
    key = tuple(s.items())
    tot = _BFX.get(key)
    if tot is None:
        tot = {}
        for c, lvl in key:
            if lvl > 0 and c in CHAINS:
                _add(tot, CHAINS[c]['levels'][min(lvl, len(CHAINS[c]['levels'])) - 1]['fx'])
        if len(_BFX) > 5000:
            _BFX.clear()
        _BFX[key] = tot
    return tot


for _k, _p in POLICIES.items():
    _add(_PFX.setdefault(_k, {}), _p['fx'])


def policy_w(g, n):
    """Avancement du changement de politique (0 au début, 1 une fois achevé)."""
    p = n.get('pol')
    if not p:
        return 1.0
    u = p.get('u') or TT.turn_start_after(g, p['t'] + POLICY_OLD_DAYS)
    return max(0.0, min(1.0, (g.t - p['t']) / max(1e-6, u - p['t'])))


def pfx(g, n):
    """Effets de la politique en vigueur, mêlés à ceux de la précédente pendant la transition
    (dictionnaire partagé une fois la transition achevée : ne pas le modifier)."""
    p = n.get('pol')
    if not p or p.get('o') != n['owner']:
        return _EMPTY
    w = policy_w(g, n)
    if w >= 1:
        return _PFX[p['k']]
    tot = {}
    _add(tot, POLICIES[p['k']]['fx'], w)
    _add(tot, POLICIES[p.get('p', 'equilibre')]['fx'], 1 - w)
    return tot


def node_extra(g, n, code, out, trade):
    """Production de base ajoutée par les bâtiments, la politique et les événements de la place
    (avant population, ordre public et outils). Renvoie la part de commerce, sensible au blocus."""
    if not (n.get('slots') or n.get('pol') or n.get('tm') or n.get('bo')):
        return trade
    b = bfx(n)
    gn = g.geo.nodes[n['id']]
    sk = SIZE_K[gn['type']]
    for k in PROD:
        if b.get(k):
            out[k] = out.get(k, 0) + b[k] * sk
    for k, v in (n.get('bo') or {}).items():
        out[k] = out.get(k, 0) + v
    if b.get('spec') and gn.get('star') and gn['star'][0] in R.SPECIALTY:
        sp = R.SPECIALTY[gn['star'][0]]
        k = (1 + (g.mod(code, sp['boost']) if sp.get('boost') else 0)) * \
            (R.SPECIALTY_CAPITAL if gn['type'] == 'capitale' else 1) * b['spec']
        for r in PROD:
            if r in sp:
                out[r] += sp[r] * k
        if sp.get('boost') == 'port':
            trade += sp.get('livres', 0) * k
    if b.get('trade'):
        out['livres'] += b['trade'] * sk
        trade += b['trade'] * sk
    m = pfx(g, n)
    if n.get('tm'):
        m = dict(m)
        for e in n['tm']:
            if e['until'] > g.t:
                m[e['k']] = m.get(e['k'], 0) + e['v']
    if m:
        for r in PROD:
            k = 1 + m.get(r, 0) + m.get('prod', 0)
            if k != 1:
                out[r] *= max(0.1, k)
        trade *= max(0.1, 1 + m.get('livres', 0) + m.get('prod', 0))
    return trade


def stab_bonus(g, n):
    # appelé très souvent (ordre public) : seuls l'hospice, la fabrique et la politique comptent
    s, v = n.get('slots'), 0.0
    if s and ('hospice' in s or 'atelier' in s):
        v += bfx(n).get('stab', 0)
    if n.get('pol'):
        v += pfx(g, n).get('stab', 0)
    return v


def growth_k(g, n):
    return max(0.2, 1 + bfx(n).get('grow', 0) + pfx(g, n).get('grow', 0))


def train_k(g, n, typ):
    b, p = bfx(n), pfx(g, n)
    k = b.get('train', 0) + p.get('train', 0) + (b.get('cav_train', 0) if typ == 'cavalerie' else 0)
    return max(0.4, 1 - k)


def train_xp(g, n):
    return bfx(n).get('xp', 0) + pfx(g, n).get('xp', 0)


def upkeep(g, code):
    """Entretien des bâtiments d'emplacement, en livres par jour."""
    tot = 0.0
    for n in g.nodes:
        if n['owner'] == code and n.get('slots'):
            for c, lvl in n['slots'].items():
                if lvl > 0 and c in CHAINS:
                    tot += CHAINS[c]['levels'][min(lvl, len(CHAINS[c]['levels'])) - 1].get('up', 0)
    return tot


def prestige(nodes):
    """Un demi-point de rayonnement par niveau de bâtiment."""
    return sum(max(0, v) for n in nodes for v in (n.get('slots') or {}).values()) / 2


def set_policy(g, code, nid, k, same_type=False):
    if k not in POLICIES:
        return False, "Politique inconnue."
    n = g.nodes[nid]
    if n['owner'] != code:
        return False, "Cette ville ne vous appartient pas."
    typ = g.geo.nodes[nid]['type']
    targets = [m for m in g.owned_nodes(code) if g.geo.nodes[m['id']]['type'] == typ] if same_type else [n]
    changed = sum(1 for m in targets if _set_policy(g, m, k))
    lab = POLICIES[k]['label']
    if same_type:
        what = {'village': 'tous vos villages', 'fort': 'toutes vos places fortes', 'ville': 'toutes vos villes',
                'capitale': 'tous vos chefs-lieux'}[typ]
        return True, f"Politique « {lab} » dans {R.pl(changed, 'place')} de plus ({what})." if changed \
            else f"{what[0].upper() + what[1:]} suivent déjà la politique « {lab} »."
    if not changed:
        return True, f"{g.geo.nodes[nid]['name']} suit déjà la politique « {lab} »."
    return True, f"{g.geo.nodes[nid]['name']} : politique « {lab} », en place au prochain tour."


def _set_policy(g, n, k):
    p = n.get('pol')
    cur = p['k'] if p and p.get('o') == n['owner'] else 'equilibre'
    if cur == k:
        return False
    # en pleine transition, on repart de la politique qui dominait encore
    prev = cur if not p or policy_w(g, n) >= 0.5 else p.get('p', 'equilibre')
    n['pol'] = dict(k=k, p=prev, t=g.t, u=TT.deadline(g, POLICY_TOURS), o=n['owner'])
    g._dirty_income = True
    return True


# ------------------------------------------------------------------ chaque jour
def daily(g, d):
    for n in g.nodes:
        if n.get('slots') or n.get('depot') or n.get('pol') or n.get('tm'):
            sync(g, n)
    research(g)
    if not g.over:
        tick(g)


def college_k(g, code):
    """Jours de recherche gagnés chaque jour grâce aux collèges (au plus 0,15)."""
    return min(0.15, sum(bfx(n).get('research', 0) for n in g.owned_nodes(code) if n.get('slots')))


def research(g):
    """Les collèges forment des savants : les recherches en cours avancent un peu plus vite (au plus +15 %)."""
    for code, f in g.factions.items():
        if not f['alive']:
            continue
        k = college_k(g, code)
        if k > 0:
            for cur in f['research'].values():
                if cur:
                    cur['left'] -= k


# ------------------------------------------------------------------ événements locaux
def _river(g, nid):
    return [w for w in g.geo.ports.get(nid, []) if not g.geo.ways[w]['sea']]


def _hilly(g, nid):
    gn = g.geo.nodes[nid]
    from .geo import TERRAIN
    return TERRAIN[g.geo.terrain_at(gn['x'], gn['y'])][0] in ('Collines', 'Montagne', 'Haute montagne')


def _troops(g, n, code):
    if n['owner'] != code:
        return False
    if n['garrison']:
        return True
    return any(a['owner'] == code and a['at_node'] == n['id'] and a['state'] == 'idle' for a in g.armies.values())


def _w_incendie(g, n, gn, s):
    return {'été': 1.5, 'hiver': 1.2}.get(s, 1.0)


def _w_epidemie(g, n, gn, s):
    return {'été': 1.5, 'automne': 1.2}.get(s, 0.9) * (1.3 if n['id'] in g.geo.ports else 1.0)


def _w_disette(g, n, gn, s):
    f = g.factions[n['owner']]
    return {'hiver': 1.4, 'printemps': 1.6, 'été': 0.6, 'automne': 0.4}[s] * (3.0 if f.get('famine') else 1.0)


def _w_brigands(g, n, gn, s):
    wars = any(g.at_war(n['owner'], o) for o in g.factions if o != n['owner'] and g.factions[o]['alive'])
    return (1.5 if gn['type'] == 'village' else 1.0) * (1 + 2 * max(0.0, 0.8 - n['stab'])) * (1.3 if wars else 1.0)


def _w_foire(g, n, gn, s):
    if gn['type'] in ('village', 'fort') and not gn['spec']:
        return 0.0
    return {'printemps': 1.4, 'automne': 1.5, 'hiver': 0.3}.get(s, 1.0)


def _w_crue(g, n, gn, s):
    return 1.6 if s == 'printemps' and _river(g, n['id']) else 0.0


def _w_refugies(g, n, gn, s):
    if gn['type'] not in ('ville', 'capitale'):
        return 0.0
    wars = any(g.at_war(n['owner'], o) for o in g.factions if o != n['owner'] and g.factions[o]['alive'])
    return 3.0 if wars else 0.4


def _w_filon(g, n, gn, s):
    if (n.get('bo') or {}).get('fer'):
        return 0.0
    k = 2.0 if _hilly(g, n['id']) else 1.0
    if 'fer' in gn['spec'] or (gn.get('star') or [''])[0] == 'forge':
        k *= 2
    return k


def _w_emeute(g, n, gn, s):
    tax = g.factions[n['owner']].get('tax', 0.5)
    return 0.4 * (1 + 6 * max(0.0, 0.8 - n['stab'])) * (2.0 if tax > 0.6 else 1.0)


# Chaque choix : res (coût ou gain du camp, multiplié selon la taille de la place), v (effets sur la ville :
# pop, stab, tm {k: part} pendant days jours, add {ressource: par jour} durable), troops (garnison exigée), ai (poids).
LOCAL = [
    dict(id='incendie', short='incendies', w=3.0, weight=_w_incendie, title="L'incendie {de_ville}",
         text="Un soir de grand vent, le feu prend chez un boulanger et court de toit en toit : des rues entières "
              "{de_ville} partent en fumée.", base=dict(pop=-0.02),
         choices=[dict(label='Rebâtir en pierre et en tuile', res=dict(livres=-150, bois=-40), v=dict(stab=0.04), ai=2),
                  dict(label='Envoyer la garnison faire la chaîne', troops=True, v=dict(stab=0.02, tm=dict(prod=-0.10), days=60), ai=2),
                  dict(label='Laisser les habitants rebâtir', v=dict(stab=-0.06, tm=dict(prod=-0.25), days=120), ai=1)]),
    dict(id='epidemie', short='fièvres', w=2.5, weight=_w_epidemie, title='La fièvre {a_ville}',
         text="Une fièvre maligne se déclare dans les quartiers bas {de_ville}. Les médecins parlent de miasmes "
              "et réclament des mesures.", base=dict(pop=-0.015),
         choices=[dict(label='Quarantaine et médecins', res=dict(livres=-120), v=dict(stab=0.02), ai=2),
                  dict(label='Cordon sanitaire tenu par la garnison', troops=True, v=dict(tm=dict(prod=-0.15), days=45), ai=2),
                  dict(label="Laisser passer l'épidémie", v=dict(pop=-0.04, stab=-0.05), ai=1)]),
    dict(id='disette', short='disettes', w=2.5, weight=_w_disette, title='Disette {a_ville}',
         text="La soudure est difficile : le pain manque et son prix double sur le marché {de_ville}. "
              "On murmure contre les accapareurs.",
         choices=[dict(label='Ouvrir les greniers', res=dict(vivres=-80), v=dict(stab=0.04), ai=2),
                  dict(label='Faire venir du grain', res=dict(livres=-110), v=dict(stab=0.02), ai=2),
                  dict(label='Laisser faire le marché', v=dict(stab=-0.08, pop=-0.02), ai=1)]),
    dict(id='brigands', short='brigands', w=2.5, weight=_w_brigands, title='Des brigands près {de_ville}',
         text="Une bande de déserteurs et de faux-sauniers détrousse marchands et rouliers sur les chemins {de_ville}.",
         choices=[dict(label='Envoyer la garnison battre la campagne', troops=True, v=dict(stab=0.03), ai=3),
                  dict(label='Payer la maréchaussée', res=dict(livres=-90), ai=2),
                  dict(label='Fermer les yeux', v=dict(stab=-0.04, tm=dict(livres=-0.30), days=90), ai=1)]),
    dict(id='foire', short='foires', w=2.5, weight=_w_foire, title='La grande foire {de_ville}',
         text="Maquignons, drapiers et colporteurs affluent de tout le pays : la foire {de_ville} s'annonce "
              "comme la plus belle depuis des années.",
         choices=[dict(label='Accorder des franchises aux marchands', res=dict(livres=-60), v=dict(stab=0.02, tm=dict(livres=0.40), days=60), ai=2),
                  dict(label='Lever un droit sur les étals', res=dict(livres=90), v=dict(stab=-0.02), ai=1)]),
    dict(id='crue', short='crues', w=3.0, weight=_w_crue, title='Crue {a_ville}',
         text="Après les pluies et la fonte des neiges, {riviere} sort de son lit : les quais et les bas quartiers "
              "{de_ville} sont sous l'eau.",
         choices=[dict(label='Renforcer les digues', res=dict(livres=-100, bois=-50), v=dict(tm=dict(prod=-0.05), days=30), ai=2),
                  dict(label='Évacuer les bas quartiers', v=dict(tm=dict(prod=-0.15), days=45), ai=2),
                  dict(label='Attendre la décrue', res=dict(vivres=-40), v=dict(pop=-0.01, tm=dict(prod=-0.30), days=60), ai=1)]),
    dict(id='refugies', short='réfugiés', w=1.5, weight=_w_refugies, title='Des réfugiés {a_ville}',
         text="Des familles chassées par la guerre et la misère se pressent aux portes {de_ville}, "
              "leurs hardes entassées sur des charrettes.",
         choices=[dict(label='Les accueillir', res=dict(vivres=-60), v=dict(pop=0.03, stab=-0.02), ai=2),
                  dict(label='Enrôler les hommes valides', res=dict(recrues=120), v=dict(stab=-0.03), ai=1),
                  dict(label='Leur fermer les portes', v=dict(), ai=1)]),
    dict(id='filon', short='filons', w=0.7, weight=_w_filon, title='Un filon près {de_ville}',
         text="En creusant un puits, des paysans tombent sur une veine de minerai de fer. "
              "Un maître de forges propose de l'exploiter.",
         choices=[dict(label='Ouvrir une mine', res=dict(livres=-160, outils=-20), v=dict(add=dict(fer=0.4)), ai=2),
                  dict(label='Vendre la concession', res=dict(livres=120), ai=1)]),
    dict(id='emeute', short='émeutes', w=1.0, weight=_w_emeute, title='Émotion populaire {a_ville}',
         text="Des femmes du peuple s'attroupent devant l'hôtel de ville {de_ville} : on réclame du pain à juste prix "
              "et la fin de l'octroi.",
         choices=[dict(label="Disperser l'attroupement avec la garnison", troops=True, v=dict(stab=0.05), ai=2),
                  dict(label="Baisser l'octroi", res=dict(livres=-80), v=dict(stab=0.06), ai=2),
                  dict(label='Laisser gronder', v=dict(stab=-0.08, tm=dict(prod=-0.15), days=30), ai=1)]),
]
LOCAL_BY_ID = {e['id']: e for e in LOCAL}


def _fill(g, nid, s):
    gn = g.geo.nodes[nid]
    v = gn['name']
    a_ville = 'au ' + v[3:] if v.startswith('Le ') else ('aux ' + v[4:] if v.startswith('Les ') else f"à {v}")
    riv = _river(g, nid)
    riviere = {'Garonne': 'la Garonne', 'Dordogne': 'la Dordogne', 'Isle': "l'Isle", 'Lot': 'le Lot', 'Baïse': 'la Baïse',
               'Midouze': 'la Midouze', 'Adour': "l'Adour"}.get(riv[0] if riv else '', 'la rivière')
    return s.format(ville=v, de_ville=R.de(v), a_ville=a_ville, riviere=riviere)


def tick(g):
    """Chaque jour, chaque camp peut connaître un événement dans une de ses places."""
    st = stats(g)
    busy = {p.get('town') for p in g.pending_ev if p.get('kind') == 'ville'}
    for code, f in g.factions.items():
        if not f['alive']:
            continue
        if code == g.player and busy:
            continue   # une décision locale à la fois : le joueur n'est pas assailli
        mine = g.owned_nodes(code)
        if not mine:
            continue
        avg = sum(n['stab'] for n in mine) / len(mine)
        wars = any(g.at_war(code, o) for o in g.factions if o != code and g.factions[o]['alive'])
        p = EV_RATE * (1 + 2 * max(0.0, 0.75 - avg)) * (1.2 if wars else 1.0)
        if g.rng.random() >= p:
            continue
        cands = [n for n in mine if not n['siege'] and g.t - n.get('evt', -1e9) > CITY_GAP and n['id'] not in busy]
        if not cands:
            continue
        n = g.rng.choices(cands, [TOWN_W[g.geo.nodes[m['id']]['type']] for m in cands])[0]
        if fire(g, code, n):
            key = 'joueur' if code == g.player else 'ia'
            st['ev_' + key] = st.get('ev_' + key, 0) + 1


def weights(g, n):
    """Événements possibles dans cette place, avec leur poids (saison, ordre public, bâtiments, politique)."""
    gn = g.geo.nodes[n['id']]
    s = g.season()
    mods = {}
    _add(mods, {'ev': bfx(n).get('ev', {})})
    _add(mods, {'ev': pfx(g, n).get('ev', {})})
    mods = mods.get('ev', {})
    out = []
    for e in LOCAL:
        w = e['w'] * e['weight'](g, n, gn, s) * max(0.1, 1 + mods.get(e['id'], 0))
        if w > 0:
            out.append((e, w))
    return out


def fire(g, code, n):
    ev_w = weights(g, n)
    if not ev_w:
        return False
    ev = g.rng.choices([e for e, _ in ev_w], [w for _, w in ev_w])[0]
    nid = n['id']
    gn = g.geo.nodes[nid]
    n['evt'] = g.t
    k = SIZE_COST[gn['type']]
    title, text = _fill(g, nid, ev['title']), _fill(g, nid, ev['text'])
    if ev.get('base'):
        apply_local(g, code, dict(ev['base'], nid=nid))
    base = ', '.join(describe_local(g, dict(ev['base'], nid=nid))) if ev.get('base') else ''
    choices = []
    for c in ev['choices']:
        fx = dict(ville=dict(c.get('v', {}), nid=nid))
        if c.get('troops'):
            fx['ville']['troops'] = True
        if c.get('res'):
            fx['res'] = {r: round(q * k) for r, q in c['res'].items()}
        choices.append((c, fx))
    stats(g).setdefault('quoi', {}).setdefault(ev['id'], 0)
    stats(g)['quoi'][ev['id']] += 1
    if code != g.player:
        ok = [i for i, (c, fx) in enumerate(choices) if EV.affordable(g, code, fx)] or [len(choices) - 1]
        rich = g.factions[code]['res']['livres'] > 1500
        wts = [choices[i][0].get('ai', 1) * (2 if rich and (choices[i][1].get('res') or {}).get('livres', 0) < 0 else 1)
               for i in ok]
        i = g.rng.choices(ok, wts)[0]
        EV.apply(g, code, choices[i][1])
        return True
    g.pending_ev.append(dict(id=g.nid('e'), ev=ev['id'], kind='ville', title=title, text=text, town=nid,
                             base=base, until=TT.deadline(g, EV.ANSWER_TOURS), date=g.date_str(),
                             choices=[dict(label=c['label'], fx=fx, desc=EV.describe(g, code, fx, nid)) for c, fx in choices]))
    g.log('evenement', f"{title}. {text}" + (f" ({base})" if base else '') + " Une décision vous attend.",
          gn['x'], gn['y'], who=code, important=True)
    g.alert_pause(big=True)
    return True


def local_ok(g, code, v):
    """Ce choix est-il possible ? (place toujours à nous, garnison sur place si on l'envoie)"""
    n = g.nodes[v['nid']]
    if n['owner'] != code:
        return True   # la place est perdue : le choix ne fait plus rien, mais on peut le prendre
    return not v.get('troops') or _troops(g, n, code)


def tours_of(days):
    """Durée d'un effet d'événement local, écrite en jours dans LOCAL_EVENTS : en tours entiers (30 à 120 jours → 1 à 4)."""
    return max(1, int(days / 30 + 0.5))


def apply_local(g, code, v):
    n = g.nodes[v['nid']]
    if n['owner'] != code:
        return
    if v.get('pop'):
        n['pop'] = n.get('pop', 0) * (1 + v['pop'])
    if v.get('stab'):
        n['stab'] = max(0.0, min(1.0, n['stab'] + v['stab']))
    for k, x in (v.get('tm') or {}).items():
        n.setdefault('tm', []).append(dict(k=k, v=x, until=TT.deadline(g, tours_of(v.get('days', 60)))))
    for k, x in (v.get('add') or {}).items():
        bo = n.setdefault('bo', {})
        bo[k] = round(bo.get(k, 0) + x, 3)
    g._dirty_income = True


def _pct(v):
    return f"{'+' if v > 0 else '−'}{abs(round(v * 100))} %"


def describe_local(g, v):
    name = g.geo.nodes[v['nid']]['name']
    out = []
    if v.get('troops'):
        out.append('exige une garnison ou une armée au repos dans la place')
    if v.get('pop'):
        out.append(f"population {R.de(name)} {_pct(v['pop'])}")
    if v.get('stab'):
        out.append(f"ordre public {R.de(name)} {_pct(v['stab'])}")
    for k, x in (v.get('tm') or {}).items():
        n = tours_of(v.get('days', 60))
        out.append(f"{TM_LABEL.get(k, k)} {R.de(name)} {_pct(x)} pendant {R.pl(n, 'tour')}")
    for k, x in (v.get('add') or {}).items():
        out.append(f"+{_n(x * TT.TOUR_DAYS)} {R.RES_LABEL.get(k, k).lower()} par tour à {name} (durable)")
    return out


def stats(g):
    """Compteurs de la session (simulations) : non sauvegardés."""
    if not hasattr(g, 'city_stats'):
        g.city_stats = {}
    return g.city_stats


# ------------------------------------------------------------------ IA
AI_TASTE = dict(   # goût de chaque personnalité, selon sa branche de technologie préférée
    civil=dict(hospice=1.4, marche=1.2), industriel=dict(atelier=1.5, quai=1.1), agricole=dict(moulins=1.4, specialite=1.2),
    militaire=dict(caserne=1.5),
)


def _ai_value(g, ai, n, chain, lvl, mult):
    """Gain approché d'un niveau, en livres par jour, selon la place (mult : sa production) et la personnalité de l'IA."""
    f = ai.f
    code = ai.code
    gn = g.geo.nodes[n['id']]
    L = CHAINS[chain]['levels'][lvl - 1]
    prev = CHAINS[chain]['levels'][lvl - 2]['fx'] if lvl > 1 else {}
    fx = {k: v - prev.get(k, 0) for k, v in L['fx'].items() if isinstance(v, (int, float))}
    hungry = f['income'].get('vivres', 0) < 5 or f.get('famine')
    val = fx.get('livres', 0) + fx.get('trade', 0)
    val += fx.get('vivres', 0) * (0.9 if hungry else 0.35)
    val += fx.get('industrie', 0) * 0.6 + (fx.get('fer', 0) + fx.get('bois', 0)) * 0.5
    val += fx.get('recrues', 0) * (0.4 + 0.4 * ai.pers['aggr'])
    val *= SIZE_K[gn['type']]
    if fx.get('spec') and gn.get('star') and gn['star'][0] in R.SPECIALTY:
        sp = R.SPECIALTY[gn['star'][0]]
        kk = (1 + (g.mod(code, sp['boost']) if sp.get('boost') else 0)) * (R.SPECIALTY_CAPITAL if gn['type'] == 'capitale' else 1)
        val += fx['spec'] * kk * (sp.get('livres', 0) + 0.4 * sp.get('vivres', 0) + 0.5 * (sp.get('fer', 0) + sp.get('bois', 0))
                                  + 0.6 * sp.get('industrie', 0) + 0.4 * sp.get('recrues', 0))
    val *= mult
    val += fx.get('stab', 0) * (40 if n['stab'] < 0.8 else 8) + fx.get('grow', 0) * 1.5
    val += fx.get('train', 0) * (3 if gn['type'] in ('capitale', 'fort') else 1) + fx.get('research', 0) * 30
    val -= L.get('up', 0) - (CHAINS[chain]['levels'][lvl - 2].get('up', 0) if lvl > 1 else 0)
    val *= AI_TASTE.get(ai.pers['tech'], {}).get(chain, 1.0)
    if chain in ('marche', 'quai', 'specialite'):
        val *= 0.7 + 0.5 * ai.pers['trade']
    return val


def ai_build(ai, budget, wars):
    """Bâtir ou améliorer un bâtiment d'emplacement, là où il rapporte le plus pour ce qu'il coûte."""
    g, code = ai.g, ai.code
    if budget < 150 or g.t < getattr(ai, '_ct_clock', 0):
        return budget
    ai._ct_clock = g.t + 12   # un coup d'œil sur les chantiers toutes les deux semaines environ
    cands = []
    for n in g.owned_nodes(code):
        gn = g.geo.nodes[n['id']]
        if n['siege'] or len(n['queue']) >= 2 or (wars and ai.threat_at(n['id'], 45) > 0):
            continue
        if gn['type'] == 'village' and not gn['spec']:
            continue   # les simples villages gardent leur emplacement (un magasin aux vivres, en guerre)
        mult = None
        for chain in CHAIN_ORDER:
            if chain == 'depot' or (gn['type'] == 'fort' and chain != 'caserne'):
                continue   # le magasin aux vivres suit la guerre (AI.build_depot) ; une place forte loge des troupes
            lvl, why = check(g, code, n, chain)
            if why:
                continue
            if mult is None:
                mult = g.pop_factor(n) * max(0.3, n['stab']) * (0.7 + 0.3 * g.assim(n))
            cost = CHAINS[chain]['levels'][lvl - 1]['cost']
            price = sum(v * (1 if k == 'livres' else 1.6) for k, v in cost.items())
            val = _ai_value(g, ai, n, chain, lvl, mult) * g.assim(n)
            if val > 0:
                cands.append((val / price, n, chain, cost, price))
    cands.sort(key=lambda c: -c[0])
    built = 0
    for ratio, n, chain, cost, price in cands:
        if built >= (1 if wars else 2) or budget < 150 or ratio < 1 / 1500:
            break   # au-delà de quatre ans pour se rembourser, on attend
        extra = ai.provide(cost, budget)
        if extra is None:
            continue
        if slot_build(g, code, n['id'], chain)[0]:
            budget -= cost.get('livres', 0) + extra
            built += 1
            st = stats(g).setdefault('bati', {})
            st[code] = st.get(code, 0) + 1
    return budget


def _trading(g, nid):
    """Place de négoce : port, quai, vignoble ou spécialité vendue au loin."""
    gn = g.geo.nodes[nid]
    star = (gn.get('star') or [None])[0]
    return 'port' in gn['spec'] or 'vin' in gn['spec'] or nid in g.geo.ports \
        or R.SPECIALTY.get(star, {}).get('boost') in ('port', 'vin')


def ai_policies(ai):
    """Choisir l'orientation de chaque ville (les villages restent en équilibre), sans revenir sans cesse dessus."""
    g, code, f = ai.g, ai.code, ai.f
    wars = ai.wars()
    viv = f['income'].get('vivres', 0)
    rec = f['res']['recrues']
    for n in g.owned_nodes(code):
        gn = g.geo.nodes[n['id']]
        if gn['type'] == 'village' or n['siege']:
            continue
        p = n.get('pol')
        cur = p['k'] if p and p.get('o') == code else 'equilibre'
        if p and p.get('o') == code and g.t - p['t'] < 240:
            continue
        o = R.NODE_BASE[gn['type']]
        # on ne quitte une politique qu'une fois sa raison bien passée (pas d'allers-retours)
        if n['stab'] < (0.75 if cur == 'fetes' else 0.6):
            k = 'fetes'
        elif wars and rec < (800 if cur == 'recrutement' else 400) and gn['type'] in ('capitale', 'ville'):
            k = 'recrutement'
        elif wars and (gn['type'] == 'fort' or ai.threat_at(n['id'], 40) > 0):
            k = 'armes'
        elif (viv < (15 if cur == 'grenier' else 0) or f.get('famine')) and (o['vivres'] >= 1.3 or 'ble' in gn['spec']):
            k = 'grenier'
        elif _trading(g, n['id']) and ai.pers['trade'] >= 0.5:
            k = 'commerce'   # les places de négoce des camps marchands
        else:
            k = 'equilibre'
        if _set_policy(g, n, k):
            st = stats(g).setdefault('pol', {})
            st[k] = st.get(k, 0) + 1


# ------------------------------------------------------------------ vues et sauvegardes
def migrate(g):
    """Anciennes sauvegardes : le magasin aux vivres existant occupe un emplacement."""
    for n in g.nodes:
        slots(n)


def node_view(g, n):
    """Ce que le joueur voit de ses propres places : emplacements, politique, effets d'événements."""
    d = dict(sl=[[k, v] for k, v in slots(n).items()], sn=slot_count(g, n))
    p = n.get('pol')
    if p and p.get('o') == n['owner'] and (p['k'] != 'equilibre' or policy_w(g, n) < 1):
        d['pol'] = [p['k'], p.get('p', 'equilibre'), round(policy_w(g, n), 2),
                    TT.tours_left(g, p.get('u') or TT.turn_start_after(g, p['t'] + POLICY_OLD_DAYS))]
    tm = [e for e in n.get('tm') or () if e['until'] > g.t]
    if tm or n.get('bo'):
        d['tm'] = [f"{TM_LABEL.get(e['k'], e['k'])} {_pct(e['v'])} jusqu'au {g.date_str(e['until'])}" for e in tm] + \
                  [f"+{_n(x * TT.TOUR_DAYS)} {R.RES_LABEL.get(k, k).lower()} par tour ({'filon' if k == 'fer' else 'durable'})"
                   for k, x in (n.get('bo') or {}).items()]
    if any(p.get('kind') == 'ville' and p.get('town') == n['id'] for p in g.pending_ev):
        d['ev'] = 1
    return d


def rules_payload():
    chains = {}
    for k, c in CHAINS.items():
        chains[k] = dict(name=c['name'], icon=c['icon'], desc=c['desc'], where=c.get('where'),
                         levels=[dict(name=L['name'], cost=L['cost'], days=L['days'], dev=L.get('dev', 0),
                                      tech=L.get('tech'), up=L.get('up', 0), txt=fx_text(L['fx'])) for L in c['levels']])
    return dict(slots=SLOTS, size_k=SIZE_K, chains=chains, order=CHAIN_ORDER,
                spec_names={k: dict(names=v[0], tech=v[1]) for k, v in SPEC_NAMES.items()},
                policies={k: dict(label=p['label'], pro=p['pro'], con=p['con']) for k, p in POLICIES.items()},
                policy_order=POLICY_ORDER, tech_names={t['id']: t['name'] for t in R.TECH.values()})
