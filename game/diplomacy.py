"""Diplomatie et commerce entre départements."""
from . import rules as R

BASE_VALUE = dict(livres=1.0, vivres=0.6, fer=2.0, bois=1.0, armes=3.5, outils=3.0, recrues=0.5)


def fn(code):
    return R.FACTIONS[code]['name']


def lost_nodes(game, code):
    f = game.factions[code]
    return max(0, f['start_nodes'] - len(game.owned_nodes(code)))


def borders(game, a, b):
    for e in game.geo.edges:
        oa, ob = game.nodes[e['a']]['owner'], game.nodes[e['b']]['owner']
        if (oa == a and ob == b) or (oa == b and ob == a):
            return True
    return False


def value_of(game, code, res, qty):
    stock = game.factions[code]['res'].get(res, 0)
    need = 1.6 if stock < 80 else (1.0 if stock < 400 else 0.6)
    if res == 'livres':
        need = 1.3 if stock < 150 else 1.0
    return qty * BASE_VALUE[res] * need


# ------------------------------------------------------------------ effets
def declare_war(game, a, b, quiet=False):
    if game.at_war(a, b):
        return False, "Déjà en guerre."
    fa = game.factions[a]
    if fa['overlord']:
        return False, "Un vassal ne déclare pas la guerre seul."
    if b in fa['truce']:
        return False, f"Une trêve avec {fn(b)} court jusqu'au {game.date_str(fa['truce'][b])}."
    was_ally = game.status(a, b) == 'alliance'
    game.set_status(a, b, 'guerre')
    for x, y in ((a, b), (b, a)):
        game.factions[x]['trade'].pop(y, None)
        game.factions[x]['war_since'][y] = game.t
    game.factions[b]['rel'][a] = max(-100, game.factions[b]['rel'][a] - (70 if was_ally else 45))
    for o, f in game.factions.items():
        if o in (a, b) or not f['alive']:
            continue
        if game.at_war(o, b):
            f['rel'][a] = min(100, f['rel'][a] + 8)
        else:
            f['rel'][a] = max(-100, f['rel'][a] - (14 if was_ally else 7))
    game.log('diplo', f"{fn(a)} déclare la guerre à {fn(b)} !", who=a, important=True)
    # alliances et vassaux
    for o, f in game.factions.items():
        if not f['alive'] or o in (a, b):
            continue
        if f['overlord'] == b or (game.status(o, b) == 'alliance' and f['rel'][b] > 15 and not game.at_war(o, a)
                                  and game.status(o, a) != 'alliance'):
            game.set_status(o, a, 'guerre')
            f['trade'].pop(a, None)
            game.factions[a]['trade'].pop(o, None)
            f['war_since'][a] = game.t
            game.factions[a]['war_since'][o] = game.t
            game.log('diplo', f"{fn(o)} honore son alliance et entre en guerre contre {fn(a)}.", who=o, important=True)
        elif f['overlord'] == a and not game.at_war(o, b):
            game.set_status(o, b, 'guerre')
            f['trade'].pop(b, None)
            f['war_since'][b] = game.t
    return True, f"Guerre déclarée à {fn(b)}."


def make_peace(game, a, b):
    game.set_status(a, b, 'paix')
    until = game.t + 120
    game.factions[a]['truce'][b] = until
    game.factions[b]['truce'][a] = until
    for x, y in ((a, b), (b, a)):
        game.factions[x]['rel'][y] = min(100, game.factions[x]['rel'][y] + 12)
        game.factions[x]['war_since'].pop(y, None)
    # les sièges et batailles en cours entre eux cessent
    for bt in list(game.battles.values()):
        owners = {bt['sides'][0]['owner'], bt['sides'][1]['owner']}
        if owners == {a, b}:
            for side in bt['sides']:
                for aid in side['armies']:
                    ar = game.armies.get(aid)
                    if ar:
                        ar['state'] = 'idle'
                        ar['battle'] = None
                        ar['grace'] = game.t + 2
            del game.battles[bt['id']]
    for n in game.nodes:
        if n['siege'] and {n['siege']['by'], n['owner']} == {a, b}:
            n['siege'] = None
    for ar in game.armies.values():
        if ar['state'] == 'siege' and ar['at_node'] is not None and game.nodes[ar['at_node']]['siege'] is None:
            ar['state'] = 'idle'
    game.log('diplo', f"Paix signée entre {fn(a)} et {fn(b)} (trêve de 120 jours).", who=a, important=True)


def make_alliance(game, a, b):
    game.set_status(a, b, 'alliance')
    for x, y in ((a, b), (b, a)):
        game.factions[x]['rel'][y] = min(100, game.factions[x]['rel'][y] + 10)
    game.log('diplo', f"Alliance conclue entre {fn(a)} et {fn(b)}.", who=a, important=True)


def make_vassal(game, v, over):
    fv = game.factions[v]
    fv['overlord'] = over
    game.set_status(v, over, 'alliance')
    fv['truce'].pop(over, None)
    for o in game.factions:
        if o in (v, over) or not game.factions[o]['alive']:
            continue
        if game.at_war(over, o):
            game.set_status(v, o, 'guerre')
        elif game.at_war(v, o):
            game.set_status(v, o, 'paix')
    for bt in list(game.battles.values()):
        owners = {bt['sides'][0]['owner'], bt['sides'][1]['owner']}
        if owners == {v, over}:
            for side in bt['sides']:
                for aid in side['armies']:
                    ar = game.armies.get(aid)
                    if ar:
                        ar['state'] = 'idle'
                        ar['battle'] = None
            del game.battles[bt['id']]
    for n in game.nodes:
        if n['siege'] and {n['siege']['by'], n['owner']} == {v, over}:
            n['siege'] = None
    game.log('diplo', f"{fn(v)} se soumet à {fn(over)} et devient son vassal.", who=over, important=True)
    game.check_end()


# ------------------------------------------------------------------ évaluation par une IA
def ai_evaluate(game, ai, frm, action, amount=0, give=None, get=None):
    f = game.factions[ai]
    op = f['rel'][frm]
    pa = max(1.0, game.faction_power(ai))
    pb = max(1.0, game.faction_power(frm))
    pers = R.FACTIONS[ai]['personality']
    diplo = game.mod(frm, 'diplo') + game.mod(frm, 'prestige')
    st = game.status(ai, frm)
    if action == 'paix':
        if st != 'guerre':
            return False, "Nous ne sommes pas en guerre."
        days = game.t - f['war_since'].get(frm, game.t)
        score = 32 * (pb / pa) + days / 5 + amount / 12 + op / 3 + diplo + 6 * lost_nodes(game, ai) \
            - 6 * lost_nodes(game, frm) - 20 * pers['aggr']
        if score > 45:
            return True, f"{fn(ai)} accepte la paix."
        if pa > 1.4 * pb:
            return False, f"{fn(ai)} se croit en position de force et refuse."
        return False, f"{fn(ai)} refuse : « Proposez-nous mieux » (essayez avec un tribut en livres)."
    if action == 'alliance':
        if st == 'guerre':
            return False, "Faites d'abord la paix."
        if st == 'alliance':
            return False, "Déjà alliés."
        common = any(game.at_war(ai, o) and game.at_war(frm, o) for o in game.factions)
        score = op + diplo + (25 if common else 0) + 15 * min(1.5, pb / pa) + amount / 15
        if score >= 60:
            return True, f"{fn(ai)} accepte l'alliance."
        return False, f"{fn(ai)} ne vous fait pas encore assez confiance (relation {int(op)})."
    if action == 'commerce':
        if st == 'guerre':
            return False, "Impossible de commercer avec un ennemi."
        if frm in f['trade']:
            return False, "Accord déjà en vigueur."
        score = op + 30 * pers['trade'] + diplo + amount / 10
        if score >= 20:
            return True, f"{fn(ai)} signe l'accord commercial."
        return False, f"{fn(ai)} refuse de commercer (relation {int(op)})."
    if action == 'echange':
        if st == 'guerre':
            return False, "Pas d'échange avec un ennemi."
        (gr, gq), (wr, wq) = give, get
        if game.factions[ai]['res'].get(wr, 0) < wq:
            return False, f"{fn(ai)} n'a pas assez de {R.RES_LABEL[wr].lower()}."
        v_in = value_of(game, ai, gr, gq)
        v_out = value_of(game, ai, wr, wq) * (1.15 - op / 400 - diplo / 200)
        if v_in >= v_out:
            return True, f"{fn(ai)} accepte l'échange."
        return False, f"{fn(ai)} juge l'échange déséquilibré."
    if action == 'soumission':
        if st != 'guerre':
            return False, "On n'exige la soumission que d'un ennemi."
        lost = lost_nodes(game, ai)
        cap_threat = game.nodes[game.capital_of(ai)]['siege'] is not None
        if (pa < 0.3 * pb and (lost >= max(2, f['start_nodes'] * 0.4) or cap_threat)) or (pa < 0.15 * pb):
            return True, f"{fn(ai)} accepte de se soumettre."
        return False, f"{fn(ai)} refuse de se soumettre et combattra jusqu'au bout."
    return False, "Proposition inconnue."


# ------------------------------------------------------------------ point d'entrée
def act(game, frm, to, action, amount=0, give=None, get=None):
    if to not in game.factions or not game.factions[to]['alive'] or to == frm:
        return False, "Département invalide."
    f = game.factions[frm]
    amount = max(0, int(amount or 0))
    if amount > f['res']['livres']:
        return False, "Livres insuffisantes."
    if action == 'guerre':
        return declare_war(game, frm, to)
    if action == 'rompre':
        if game.status(frm, to) != 'alliance':
            return False, "Pas d'alliance à rompre."
        if game.factions[to]['overlord'] == frm or f['overlord'] == to:
            return False, "Un lien de vassalité ne se rompt pas ainsi."
        game.set_status(frm, to, 'paix')
        game.factions[to]['rel'][frm] -= 25
        game.log('diplo', f"{fn(frm)} rompt son alliance avec {fn(to)}.", who=frm, important=True)
        return True, "Alliance rompue."
    if action == 'fin_commerce':
        f['trade'].pop(to, None)
        game.factions[to]['trade'].pop(frm, None)
        game.factions[to]['rel'][frm] -= 8
        game._dirty_income = True
        return True, "Accord commercial dénoncé."
    if action == 'cadeau':
        if amount <= 0:
            return False, "Indiquez un montant."
        f['res']['livres'] -= amount
        game.factions[to]['res']['livres'] += amount
        gain = min(30.0, amount / 8)
        game.factions[to]['rel'][frm] = min(100, game.factions[to]['rel'][frm] + gain)
        return True, f"{fn(to)} apprécie votre présent (+{gain:.0f} relation)."
    if action == 'echange':
        if not give or not get:
            return False, "Échange incomplet."
        give = (give[0], max(1, int(give[1])))
        get = (get[0], max(1, int(get[1])))
        if f['res'].get(give[0], 0) < give[1]:
            return False, "Stock insuffisant."
    if to == game.player:
        game.proposals.append(dict(id=game.nid('p'), frm=frm, action=action, amount=amount, give=give, get=get,
                                   expires=game.t + 15, date=game.date_str()))
        return None, "Proposition envoyée."
    ok, msg = ai_evaluate(game, to, frm, action, amount, give, get)
    if ok:
        apply(game, frm, to, action, amount, give, get)
    else:
        game.factions[to]['rel'][frm] = max(-100, game.factions[to]['rel'][frm] - 1)
    return ok, msg


def apply(game, frm, to, action, amount=0, give=None, get=None):
    f, g = game.factions[frm], game.factions[to]
    if amount:
        f['res']['livres'] -= amount
        g['res']['livres'] += amount
    if action == 'paix':
        make_peace(game, frm, to)
    elif action == 'alliance':
        make_alliance(game, frm, to)
    elif action == 'commerce':
        f['trade'][to] = True
        g['trade'][frm] = True
        game._dirty_income = True
        game.log('diplo', f"Accord commercial entre {fn(frm)} et {fn(to)}.", who=frm, important=frm == game.player or to == game.player)
    elif action == 'echange':
        (gr, gq), (wr, wq) = give, get
        f['res'][gr] -= gq
        g['res'][gr] += gq
        g['res'][wr] -= wq
        f['res'][wr] += wq
    elif action == 'soumission':
        make_vassal(game, to, frm)


def answer(game, pid, accept):
    p = next((x for x in game.proposals if x['id'] == pid), None)
    if not p:
        return False, "Proposition expirée."
    game.proposals.remove(p)
    frm = p['frm']
    me = game.player
    if not accept:
        game.factions[frm]['rel'][me] = max(-100, game.factions[frm]['rel'][me] - 4)
        return True, "Proposition refusée."
    if p['action'] == 'echange':
        (gr, gq), (wr, wq) = p['give'], p['get']
        if game.factions[me]['res'].get(wr, 0) < wq or game.factions[frm]['res'].get(gr, 0) < gq:
            return False, "Les stocks ne permettent plus cet échange."
    if p['action'] == 'paix' and not game.at_war(me, frm):
        return False, "Nous ne sommes plus en guerre."
    apply(game, frm, me, p['action'], p['amount'], p['give'], p['get'])
    return True, "Proposition acceptée."
