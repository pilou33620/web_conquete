"""Mode Bataille : une bataille tactique isolée, sans campagne.

Le joueur choisit son camp, l'époque, jusqu'à MAX_UNITS régiments, le type de bataille (rase campagne ou place forte,
en attaquant ou en défenseur), et au besoin le lieu, la saison et la météo ; le reste est tiré au sort. Une petite
partie jetable (engine.Game) fournit les armes et les noms d'époque, les généraux et la carte : la bataille passe ensuite
par bridge.create_orders et se joue comme une bataille de campagne (« Donner mes ordres »). Elle n'est jamais
enregistrée et ne touche pas à la campagne en cours (server.App.skirmish, à côté de App.game).
"""
import datetime
import math
import random

from .. import rules as R
from ..geo import T_EAU, T_HAUTE, PLAYABLE
from . import bridge as TB
from .. import battle_log as BL
from .. import army_actions as AA

MAX_UNITS = 10
KINDS = ('bataille', 'forteresse', 'village')   # (village : sans remparts, barricadé ; au banc, pas dans l'écran)
SEASONS = ('printemps', 'été', 'automne', 'hiver')
SEASON_MONTH = {'printemps': 4, 'été': 7, 'automne': 10, 'hiver': 1}
# une place intacte (ni siège ni brèche : l'escalade) se prend à un contre deux : à ses
# régiments, l'assaillant ajoute un parc de siège et une colonne d'assaut (les grenadiers selon l'époque)
GARRISON_UNITS = 7
ASSAULT_BONUS = ('artillerie', 'artillerie', 'sapeurs', 'grenadiers', 'ligne')
ASSAULT_UNITS = 10 + len(ASSAULT_BONUS)
# l'adversaire tiré au sort : poids des armes (les grenadiers selon l'époque, les chasseurs pour les Basques)
FOE_MIX = dict(ligne=4.0, legere=1.5, cavalerie=2.0, artillerie=1.5, grenadiers=1.0, chasseurs=1.0)


def _fort(gn):
    return max(gn['fort'], 2) if gn['type'] == 'capitale' else gn['fort']


def _techs(era):
    tb = R.SCENARIOS[era].get('techs_before')
    return {t for t in R.TECH if tb and R.TECH_YEAR[t] <= tb}


def units_for(era, garrison=False):
    """Types de régiments qu'on peut aligner à cette époque (la Garde nationale ne quitte pas sa ville)."""
    techs = _techs(era)
    year = R.SCENARIOS[era]['date'][0]
    out = []
    for typ in R.UNIT_ORDER:
        u = R.UNITS[typ]
        if u['req'] and u['req'] not in techs:
            continue
        if u['garrison_only'] and (not garrison or year < 1789):
            continue
        out.append(typ)
    return out


def options(geo):
    """Choix offerts par l'écran du mode Bataille (envoyés avec la carte, /api/map)."""
    places = [dict(id=n['id'], name=n['name'], type=n['type'], fort=_fort(n)) for n in geo.nodes
              if n['type'] in ('capitale', 'ville', 'fort') and n['dept'] in PLAYABLE]
    places.sort(key=lambda p: p['name'])
    return dict(max=MAX_UNITS, kinds=KINDS, seasons=SEASONS, places=places,
                weather_w=R.WEATHER_W, assault_units=ASSAULT_UNITS, garrison_units=GARRISON_UNITS,
                assault_bonus=len(ASSAULT_BONUS),
                units={era: dict(field=units_for(era), garrison=units_for(era, True)) for era in R.SCENARIOS})


def _pick_weather(rng, season, weather):
    if weather in R.WEATHER:
        return weather
    w = R.WEATHER_W[season]
    return rng.choices(list(w), list(w.values()))[0]


def _pick_season(rng, season, weather):
    if season in SEASONS:
        return season
    ok = [s for s in SEASONS if weather not in R.WEATHER or weather in R.WEATHER_W[s]]
    return rng.choice(ok or list(SEASONS))


def _open_ground(geo, rng, x0, y0, r0, r1):
    """Un point de campagne à r0–r1 km de (x0, y0), sur la terre ferme et pas en haute montagne."""
    for _ in range(80):
        a = rng.random() * 2 * math.pi
        r = rng.uniform(r0, r1)
        x, y = x0 + math.cos(a) * r, y0 + math.sin(a) * r
        if geo.playable_at(x, y) and T_EAU < geo.terrain_at(x, y) != T_HAUTE:
            return x, y
    return x0, y0


def _local(typ, code):
    """Régiment qu'on ne lève que dans certains départements (chasseurs basques)."""
    w = R.UNITS[typ].get('where')
    return not w or code in w


def _foe_units(rng, era, code, n, assault):
    avail = [t for t in units_for(era) if t in FOE_MIX and _local(t, code)]
    out = rng.choices(avail, [FOE_MIX[t] for t in avail], k=n)
    if assault:
        out[:2] = ['artillerie', 'artillerie']   # pas d'assaut sans canons
    return out


def _count(units, allowed):
    """Liste des types demandés ({type: nombre}), ou un message d'erreur."""
    if not isinstance(units, dict):
        return None, 'Choisissez vos régiments.'
    out = []
    for typ, k in units.items():
        try:
            k = int(k)
        except (TypeError, ValueError):
            return None, 'Nombre de régiments invalide.'
        if k <= 0:
            continue
        if typ not in allowed:
            return None, f"{R.UNITS[typ]['name'] if typ in R.UNITS else typ} : indisponible pour cette bataille."
        out += [typ] * k
    if not out:
        return None, 'Choisissez au moins un régiment.'
    if len(out) > MAX_UNITS:
        return None, f'Au plus {MAX_UNITS} régiments.'
    return out, ''


def new(geo, body):
    """Nouvelle bataille isolée : (partie jetable, bid) ou (None, message)."""
    from ..engine import Game
    me = body.get('me')
    if me not in R.FACTIONS:
        return None, 'Choisissez votre camp.'
    era = body.get('era') if body.get('era') in R.SCENARIOS else '1790'
    kind = body.get('kind') if body.get('kind') in KINDS else 'bataille'
    attack = body.get('role') != 'def'
    place = kind in ('forteresse', 'village')   # (village : une place sans remparts, barricadée)
    rng = random.Random(body.get('seed'))   # (graine : bancs d'essai reproductibles ; sans graine, au hasard)
    foe = body.get('foe')
    if foe not in R.FACTIONS or foe == me:
        foe = rng.choice([c for c in R.FACTIONS if c != me])
    allowed = {t for t in units_for(era, garrison=place and not attack) if _local(t, me)}
    mine, msg = _count(body.get('units'), allowed)
    if mine is None:
        return None, msg

    g = Game(geo, me, body.get('difficulty', 'normal'), rng.randrange(1 << 30), era)
    g.ais = {}   # personne ne gouverne : seule la bataille compte
    g.armies.clear()
    for f in g.factions.values():
        f['army_count'] = 0
    # la date : la saison voulue, l'année de l'époque (ou la suivante si l'époque commence plus tard dans l'année)
    season = _pick_season(rng, body.get('season'), body.get('weather'))
    weather = _pick_weather(rng, season, body.get('weather'))
    y0 = R.SCENARIOS[era]['date'][0]
    d = datetime.date(y0, SEASON_MONTH[season], rng.randint(1, 28))
    if d.toordinal() < g.start_ord:
        d = d.replace(year=y0 + 1)
    g.t = float(d.toordinal() - g.start_ord) + 0.3
    g._cache_date = None

    # le lieu
    nid = body.get('place')
    try:
        nid = int(nid) if nid not in (None, '') else None
    except (TypeError, ValueError):
        nid = None
    if nid is not None and not (0 <= nid < len(geo.nodes) and geo.nodes[nid]['dept'] in PLAYABLE):
        nid = None
    if kind == 'forteresse':
        if nid is None or _fort(geo.nodes[nid]) < 1:
            nid = rng.choice([n['id'] for n in geo.nodes if _fort(n) >= 1 and n['dept'] in PLAYABLE])
        bx, by = geo.nodes[nid]['x'], geo.nodes[nid]['y']
    elif kind == 'village':
        if nid is None or _fort(geo.nodes[nid]) >= 1:
            nid = rng.choice([n['id'] for n in geo.nodes if n['type'] == 'village' and _fort(n) < 1
                              and n['dept'] in PLAYABLE])
        bx, by = geo.nodes[nid]['x'], geo.nodes[nid]['y']
    else:
        if nid is None:
            nid = rng.choice([n['id'] for n in geo.nodes if n['dept'] in PLAYABLE])
        bx, by = _open_ground(geo, rng, geo.nodes[nid]['x'], geo.nodes[nid]['y'], 3.5, 6.0)
    for z in g.weather:
        g.weather[z] = dict(kind=weather, left=5)

    att_code, def_code = (me, foe) if attack else (foe, me)
    if attack:
        att_types = mine
        if place:   # les renforts de l'assaillant d'une place
            ok = units_for(era)
            att_types = mine + [t if t in ok else 'ligne' for t in ASSAULT_BONUS]
        def_types = _foe_units(rng, era, foe, GARRISON_UNITS if place else len(mine), False)
    else:
        def_types = mine
        att_types = _foe_units(rng, era, foe, ASSAULT_UNITS if place else len(mine), place)
    ax, ay = _open_ground(geo, rng, bx, by, 1.2, 2.0)
    att = g.create_army(att_code, ax, ay, [g.new_reg(t, code=att_code) for t in att_types])
    sides = [dict(owner=att_code, armies=[att['id']], node=None)]
    if place:
        n = g.nodes[nid]
        n['owner'] = def_code
        n['fort'] = max(1, _fort(geo.nodes[nid])) if kind == 'forteresse' else 0
        if kind == 'village':
            n['aa'] = dict(bar=AA.BAR_LEVEL)   # barricades et palissades dressées
        n['garrison'] = []
        n['milice'] = float(min(n['milice_max'], 150 + 40 * n['fort']))
        n['siege'] = None   # la place est intacte : l'assaillant arrive devant ses remparts
        de = g.create_army(def_code, bx, by, [g.new_reg(t, code=def_code) for t in def_types], node=nid,
                           name=f"Garnison de {geo.nodes[nid]['name']}")
        sides.append(dict(owner=def_code, armies=[de['id']], node=nid))
    else:
        de = g.create_army(def_code, bx, by, [g.new_reg(t, code=def_code) for t in def_types])
        sides.append(dict(owner=def_code, armies=[de['id']], node=None))
        nid = None
    bid = f'esc{rng.randrange(1 << 30)}'
    bt = dict(id=bid, x=bx, y=by, node=nid, ambush=False, surprise=False, sides=sides)
    tb = TB.create_orders(g, bt)
    tb.spec['skirmish'] = True
    tb.spec['sk'] = dict(kind=kind, role='att' if attack else 'def', me=me, foe=foe, era=era,
                         place=bool(body.get('place')), season=bool(body.get('season') in SEASONS),
                         weather=bool(body.get('weather') in R.WEATHER), units=mine)   # (journal des batailles)
    tb.spec['date'] = f"{R.SEASON_LABEL[season]} {d.year}"
    g.tactical = {bid: tb}
    g.tac_done = {}
    return g, bid


def owns(g, bid):
    return g is not None and bid is not None and (bid in g.tactical or bid in g.tac_done)


def tick(g, dt):
    """Comme bridge.tick, sans campagne à prévenir : la bataille finie reste à lire (tac_done) jusqu'à « close »."""
    for tb in list(g.tactical.values()):
        TB.advance(tb, dt)
        if tb.phase == 'fin':
            TB.finish(g, tb)   # (aucune bataille de campagne derrière : elle passe seulement dans tac_done)
            BL.skirmish_end(tb)
