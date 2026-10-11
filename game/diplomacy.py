"""Diplomatie et commerce entre départements."""
from . import rules as R
from . import army_actions as AA

BASE_VALUE = dict(livres=1.0, vivres=0.6, fer=2.0, bois=1.0, armes=3.5, outils=3.0, recrues=0.5)




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
    if game.factions[b]['overlord'] == a:
        return False, f"{game.fname(b)} est votre vassal : un lien de vassalité ne se rompt pas ainsi."
    if b in fa['truce']:
        return False, f"Une trêve avec {game.fname(b)} court jusqu'au {game.date_str(fa['truce'][b])}."
    was_ally = game.status(a, b) == 'alliance'
    game.set_status(a, b, 'guerre')
    game.factions[a]['last_war'] = game.factions[b]['last_war'] = game.t
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
    game.log('diplo', f"{game.fname(a)} déclare la guerre à {game.fname(b)} !", who=a, important=True)
    if game.player in (a, b):
        game.alert_pause()
    # alliances et vassaux
    for o, f in game.factions.items():
        if not f['alive'] or o in (a, b):
            continue
        if f['overlord'] == b and a in f['truce']:
            continue   # une trêve signée se respecte, même pour secourir un allié
        if f['overlord'] == b or (game.status(o, b) == 'alliance' and f['rel'][b] > 15 and not game.at_war(o, a)
                                  and game.status(o, a) != 'alliance' and a not in f['truce']):
            game.set_status(o, a, 'guerre')
            f['trade'].pop(a, None)
            game.factions[a]['trade'].pop(o, None)
            f['war_since'][a] = game.t
            game.factions[a]['war_since'][o] = game.t
            game.log('diplo', f"{game.fname(o)} honore son alliance et entre en guerre contre {game.fname(a)}.", who=o, important=True)
        elif f['overlord'] == a and not game.at_war(o, b) and b not in f['truce']:
            game.set_status(o, b, 'guerre')
            f['trade'].pop(b, None)
            f['war_since'][b] = game.t
    return True, f"Guerre déclarée à {game.fname(b)}."


def make_peace(game, a, b):
    game.set_status(a, b, 'paix')
    game.factions[a]['last_war'] = game.factions[b]['last_war'] = game.t
    until = game.t + 120
    game.factions[a]['truce'][b] = until
    game.factions[b]['truce'][a] = until
    for x, y in ((a, b), (b, a)):
        game.factions[x]['rel'][y] = min(100, game.factions[x]['rel'][y] + 12)
        game.factions[x]['war_since'].pop(y, None)
    # les sièges et batailles en cours entre eux cessent
    for bt in list(game.battles.values()):
        if {bt['sides'][0]['owner'], bt['sides'][1]['owner']} == {a, b}:
            game.dissolve_battle(bt)
    for n in game.nodes:
        if n['siege'] and {n['siege']['by'], n['owner']} == {a, b}:
            n['siege'] = None
    for ar in game.armies.values():
        if ar['owner'] in (a, b):
            if ar['state'] == 'siege' and ar['at_node'] is not None and game.nodes[ar['at_node']]['siege'] is None:
                ar['state'] = 'idle'
            tgt = (ar.get('target') or {}).get('node')
            if tgt is not None and game.nodes[tgt]['owner'] in (a, b) and game.nodes[tgt]['owner'] != ar['owner']:
                ar['path'] = []   # la marche contre l'ancien ennemi s'arrête
                if ar['state'] == 'move':
                    ar['state'] = 'idle'
            ar['grace'] = game.t + 2
    game.log('diplo', f"Paix signée entre {game.fname(a)} et {game.fname(b)} (trêve de 120 jours).", who=a, important=True)


def held(game, a, b):
    """Prisonniers originaires de b détenus par a."""
    return int(game.factions[a].get('prisoners', {}).get(b, 0))


def exchange_prisoners(game, a, b):
    """Cartel d'échange : chacun rend les prisonniers de l'autre, homme pour homme, puis le surplus se rachète."""
    fa, fb = game.factions[a], game.factions[b]
    pa, pb = fa.setdefault('prisoners', {}), fb.setdefault('prisoners', {})
    A, B = held(game, a, b), held(game, b, a)
    k = min(A, B)
    out = []
    if k:
        pa[b] = A - k
        pb[a] = B - k
        game.add_recrues(a, k)
        game.add_recrues(b, k)
        out.append(f"{k} prisonniers rendus de part et d'autre")
    for x, y, fx, fy, surplus in ((a, b, fa, fb, A - k), (b, a, fb, fa, B - k)):
        if surplus <= 0:
            continue
        m = min(surplus, int(max(0.0, fy['res']['livres']) // R.PRISONER_RANSOM))
        if m <= 0:
            continue
        fy['res']['livres'] -= m * R.PRISONER_RANSOM
        fx['res']['livres'] += m * R.PRISONER_RANSOM
        fx['prisoners'][y] = fx['prisoners'].get(y, 0) - m
        game.add_recrues(y, m)
        out.append(f"{game.fname(y)} rachète {m} des siens pour {m * R.PRISONER_RANSOM} livres")
    for x, y in ((a, b), (b, a)):
        if game.factions[x]['prisoners'].get(y, 1) <= 0:
            del game.factions[x]['prisoners'][y]
        game.factions[x]['rel'][y] = min(100, game.factions[x]['rel'][y] + 5)
    txt = ' ; '.join(out) or 'aucun prisonnier rendu'
    game.log('diplo', f"Échange de prisonniers entre {game.fname(a)} et {game.fname(b)} : {txt}.", who=a,
             important=game.player in (a, b))
    return txt


def make_alliance(game, a, b):
    game.set_status(a, b, 'alliance')
    for x, y in ((a, b), (b, a)):
        game.factions[x]['rel'][y] = min(100, game.factions[x]['rel'][y] + 10)
    game.log('diplo', f"Alliance conclue entre {game.fname(a)} et {game.fname(b)}.", who=a, important=True)


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
        if {bt['sides'][0]['owner'], bt['sides'][1]['owner']} == {v, over}:
            game.dissolve_battle(bt)
    for n in game.nodes:
        if n['siege'] and {n['siege']['by'], n['owner']} == {v, over}:
            n['siege'] = None
    game.log('diplo', f"{game.fname(v)} se soumet à {game.fname(over)} et devient son vassal.", who=over, important=True)
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
        score = 32 * (pb / pa) + days / 5 + amount / 12 + op / 3 + diplo + 6 * lost_nodes(game, ai) + f.get('weary', 0) / 2 \
            - 6 * lost_nodes(game, frm) - 20 * pers['aggr']
        if score > 45:
            return True, f"{game.fname(ai)} accepte la paix."
        if pa > 1.4 * pb:
            return False, f"{game.fname(ai)} se croit en position de force et refuse."
        return False, f"{game.fname(ai)} refuse : « Proposez-nous mieux » (essayez avec un tribut en livres)."
    if action == 'alliance':
        if st == 'guerre':
            return False, "Faites d'abord la paix."
        if st == 'alliance':
            return False, "Déjà alliés."
        common = any(game.at_war(ai, o) and game.at_war(frm, o) for o in game.factions)
        score = op + diplo + (25 if common else 0) + 15 * min(1.5, pb / pa) + amount / 15
        if score >= 60:
            return True, f"{game.fname(ai)} accepte l'alliance."
        return False, f"{game.fname(ai)} ne vous fait pas encore assez confiance (relation {int(op)})."
    if action == 'commerce':
        if st == 'guerre':
            return False, "Impossible de commercer avec un ennemi."
        if frm in f['trade']:
            return False, "Accord déjà en vigueur."
        score = op + 30 * pers['trade'] + diplo + amount / 10
        if score >= 20:
            return True, f"{game.fname(ai)} signe l'accord commercial."
        return False, f"{game.fname(ai)} refuse de commercer (relation {int(op)})."
    if action == 'echange':
        if st == 'guerre':
            return False, "Pas d'échange avec un ennemi."
        (gr, gq), (wr, wq) = give, get
        if game.factions[ai]['res'].get(wr, 0) < wq:
            return False, f"{game.fname(ai)} n'a pas assez de {R.RES_LABEL[wr].lower()}."
        v_in = value_of(game, ai, gr, gq)
        v_out = value_of(game, ai, wr, wq) * (1.15 - op / 400 - diplo / 200)
        mkt = lambda r, q: q * (1.0 if r == 'livres' else game.market.get(r, BASE_VALUE[r]))
        if mkt(gr, gq) < mkt(wr, wq) * 0.95:
            return False, f"{game.fname(ai)} connaît les prix du marché et juge l'échange déséquilibré."
        if v_in >= v_out:
            return True, f"{game.fname(ai)} accepte l'échange."
        return False, f"{game.fname(ai)} juge l'échange déséquilibré."
    if action == 'passage':
        return AA.eval_passage(game, ai, frm, amount)
    if action == 'prisonniers':
        mine, theirs = held(game, ai, frm), held(game, frm, ai)
        if not mine and not theirs:
            return False, "Personne n'a de prisonniers à échanger."
        if op < -70:
            return False, f"{game.fname(ai)} refuse de traiter avec vous, même pour ses prisonniers."
        return True, f"{game.fname(ai)} accepte l'échange de prisonniers."
    if action == 'soumission':
        if st != 'guerre':
            return False, "On n'exige la soumission que d'un ennemi."
        lost = lost_nodes(game, ai)
        cap_threat = game.nodes[game.capital_of(ai)]['siege'] is not None
        if (pa < 0.3 * pb and (lost >= max(2, f['start_nodes'] * 0.4) or cap_threat)) or (pa < 0.15 * pb):
            return True, f"{game.fname(ai)} accepte de se soumettre."
        return False, f"{game.fname(ai)} refuse de se soumettre et combattra jusqu'au bout."
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
        game.factions[to]['rel'][frm] = max(-100, game.factions[to]['rel'][frm] - 25)
        game.log('diplo', f"{game.fname(frm)} rompt son alliance avec {game.fname(to)}.", who=frm, important=True)
        return True, "Alliance rompue."
    if action == 'fin_commerce':
        f['trade'].pop(to, None)
        game.factions[to]['trade'].pop(frm, None)
        game.factions[to]['rel'][frm] = max(-100, game.factions[to]['rel'][frm] - 8)
        game._dirty_income = True
        return True, "Accord commercial dénoncé."
    if action == 'fin_passage':
        return AA.revoke_passage(game, frm, to)
    if action == 'passage':
        st = game.status(frm, to)
        if st != 'paix':
            return False, "Le droit de passage se demande à un voisin en paix (vos alliés passent déjà librement)."
        if AA.has_passage(game, frm, to):
            return False, "Vous avez déjà le droit de passage."
    if action == 'cadeau':
        if amount <= 0:
            return False, "Indiquez un montant."
        f['res']['livres'] -= amount
        game.factions[to]['res']['livres'] += amount
        gain = min(30.0, amount / 8)
        game.factions[to]['rel'][frm] = min(100, game.factions[to]['rel'][frm] + gain)
        return True, f"{game.fname(to)} apprécie votre présent (relation {R.num(gain)})."
    if action == 'echange':
        if not give or not get or len(give) != 2 or len(get) != 2:
            return False, "Échange incomplet."
        if give[0] not in BASE_VALUE or get[0] not in BASE_VALUE or give[0] == get[0]:
            return False, "Échange invalide."
        give = (give[0], max(1, int(give[1])))
        get = (get[0], max(1, int(get[1])))
        if f['res'].get(give[0], 0) < give[1]:
            return False, "Stock insuffisant."
        if get[0] == 'recrues' and game.factions[frm]['res']['recrues'] + get[1] > max(game.recruit_cap(frm), 0):
            return False, "Vos casernes ne peuvent pas loger autant de recrues."
        if give[0] == 'livres' and amount + give[1] > f['res']['livres']:
            return False, "Livres insuffisantes pour l'échange et le tribut."
    if action == 'prisonniers' and not held(game, frm, to) and not held(game, to, frm):
        return False, "Personne n'a de prisonniers à échanger."
    if to == game.player:
        game.proposals.append(dict(id=game.nid('p'), frm=frm, action=action, amount=amount, give=give, get=get,
                                   expires=game.t + R.PROPOSAL_DAYS, date=game.date_str()))
        what = dict(paix='propose la paix', alliance='propose une alliance', commerce='propose un accord commercial',
                    echange='propose un échange', prisonniers='propose un échange de prisonniers',
                    passage='demande le droit de passage sur vos terres',
                    soumission='exige votre soumission').get(action, 'vous fait une proposition')
        game.log('diplo', f"{game.fname(frm)} {what} : répondez dans les {R.PROPOSAL_DAYS} jours.", who=frm, important=True)
        if action in ('paix', 'alliance', 'soumission'):
            game.alert_pause()   # le commerce et les échanges n'arrêtent pas les années de paix
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
        game.log('diplo', f"Accord commercial entre {game.fname(frm)} et {game.fname(to)}.", who=frm, important=frm == game.player or to == game.player)
    elif action == 'echange':
        (gr, gq), (wr, wq) = give, get
        f['res'][gr] -= gq
        g['res'][wr] -= wq
        for side, res, q in ((to, gr, gq), (frm, wr, wq)):
            if res == 'recrues':
                game.add_recrues(side, q)
            else:
                game.factions[side]['res'][res] += q
    elif action == 'soumission':
        make_vassal(game, to, frm)
    elif action == 'prisonniers':
        exchange_prisoners(game, frm, to)
    elif action == 'passage':
        AA.grant_passage(game, to, frm)


def answer(game, pid, accept):
    p = next((x for x in game.proposals if x['id'] == pid), None)
    if not p:
        return False, "Proposition expirée."
    game.proposals.remove(p)
    frm = p['frm']
    me = game.player
    if not game.factions[frm]['alive']:
        return False, f"{game.fname(frm)} n'existe plus : sa proposition tombe."
    if not accept:
        game.factions[frm]['rel'][me] = max(-100, game.factions[frm]['rel'][me] - 4)
        return True, "Proposition refusée."
    ff = game.factions[frm]['res']
    give_l = p['give'][1] if p['action'] == 'echange' and p['give'][0] == 'livres' else 0
    if p['amount'] and ff['livres'] < p['amount'] + give_l:
        return False, f"{game.fname(frm)} n'a plus de quoi payer le tribut promis."
    if p['action'] == 'echange':
        (gr, gq), (wr, wq) = p['give'], p['get']
        if game.factions[me]['res'].get(wr, 0) < wq or ff.get(gr, 0) < gq:
            return False, "Les stocks ne permettent plus cet échange."
    st = game.status(me, frm)
    if p['action'] == 'paix' and st != 'guerre':
        return False, "Nous ne sommes plus en guerre."
    if p['action'] in ('alliance', 'commerce', 'echange') and st == 'guerre':
        return False, "Nous sommes en guerre : cette proposition n'a plus lieu d'être."
    if p['action'] == 'alliance' and st == 'alliance':
        return False, "Déjà alliés."
    if p['action'] == 'passage' and st != 'paix':
        return False, "Nous ne sommes plus en paix : cette demande n'a plus lieu d'être."
    if p['action'] == 'prisonniers' and not held(game, me, frm) and not held(game, frm, me):
        return False, "Il n'y a plus de prisonniers à échanger."
    apply(game, frm, me, p['action'], p['amount'], p['give'], p['get'])
    return True, "Proposition acceptée."
