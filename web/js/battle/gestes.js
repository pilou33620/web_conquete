// Vue tactique : les gestes des hommes. Logique pure, sans Three.js (bancs : tests/gestes.test.mjs). Les animations
// sont précalculées (dev/cuire.mjs, web/anims/soldat.*) ; troupes.js écrit dans les attributs de chaque figurine le
// geste choisi ici, et le vertex shader le joue.
import { hash } from './formes.js';

// geste d'un homme du rang selon l'activité de son régiment
const GESTE = { repos: 'repos', marche: 'marche', charge: 'charge', deroute: 'course', ralliement: 'trot', feu: 'joue', recharge: 'recharge', melee: 'estoc' };
// officiers, tambours, porte-drapeau : ni fusil en joue ni baïonnette
const CADRE = { repos: 'repos', marche: 'marche', charge: 'course', deroute: 'course', ralliement: 'trot', feu: 'repos', recharge: 'repos', melee: 'repos' };

// activité d'un régiment : son état, ou la marche s'il se déplace sans charger ni fuir
export function activity(un, moving) {
  return moving && un.state !== 'charge' && un.state !== 'deroute' && un.state !== 'ralliement' ? 'marche' : un.state;
}

// geste d'une figurine (kind : sorte de troupes.js) pour une activité
export function gesture(act, kind) {
  const cadre = kind === 'officier' || kind === 'tambour' || kind === 'drapeau';
  if (kind === 'officier' && (act === 'repos' || act === 'feu' || act === 'recharge')) return 'parle';
  return (cadre ? CADRE : GESTE)[act] ?? 'repos';
}

// instant du coup dans « salve » et « salve-genou », et leur durée (s depuis leur début : épauler, viser, le coup,
// recharger ; dev/cuire.mjs)
export const SALVE_FEU = 0.7, SALVE_DUREE = 4.3;

// la salve se joue-t-elle encore à l'instant now (le dernier homme a fini de recharger après la fin du roulement) ?
export const firing = (volley, now) => !!volley && now <= volley.t + volley.dur + SALVE_DUREE;

// geste d'un homme et son début (horloge des effets) : [nom, début]. act, actT : activité du régiment et son début ;
// now : l'instant ; rank : son rang (0 le premier) ; u : sa place le long du front de largeur w ; phase : son décalage
// (s) dans les gestes en boucle ; volley : la dernière salve du régiment (effets.js : t, roll, dur) ; moving : le
// régiment se déplace
export function pick({ act, actT, now, kind, rank, u, w, form, phase, volley, moving, shots }) {
  const loop = name => [name, actT - phase];
  if (kind === 'servant') return serve(act, rank, now, shots, moving, loop);
  if (kind === 'tambour') return loop(act === 'marche' || act === 'charge' || act === 'ralliement' ? 'tambour-marche' : act === 'deroute' ? 'course' : 'tambour');
  if (kind === 'officier' && (act === 'feu' || act === 'recharge' || act === 'melee')) return loop('garde');
  // (une salve tirée à l'arrêt se joue même si l'état n'est pas « feu » : la maquette tire sans changer d'état)
  const tir = act === 'feu' || act === 'recharge' || (act === 'repos' && firing(volley, now));
  if (kind === 'officier' || kind === 'drapeau' || !tir) return loop(gesture(act, kind));
  if (form === 'tirailleurs') return loop('feu-libre');
  if (rank >= 2 || rank < 0) return loop('repos');
  const genou = rank === 0 && form === 'ligne' && !moving;
  // la salve roule d'un bout à l'autre du front : chaque file tire à son tour
  if (firing(volley, now)) {
    const at = volley.t + volley.dur * (volley.roll > 0 ? u / w + 0.5 : 0.5 - u / w);
    return [genou ? 'salve-genou' : 'salve', at - SALVE_FEU];
  }
  return loop(act === 'recharge' ? 'recharge' : genou ? 'genou' : 'joue');
}

// servants d'une pièce (rang 200 + 10 × pièce + rôle : 1 écouvillon, 2 porteur, 3 pointeur, 4 boutefeu, 0 chef de
// pièce) : ils s'affairent SERVICE s après le dernier coup de leur pièce (shots : instant du dernier coup de chaque
// pièce, effets.js), le boutefeu touche la lumière à l'instant du coup ; en route, ils marchent
export const BOUTEFEU_FEU = 0.3;
const SERVICE = 8;
function serve(act, rank, now, shots, moving, loop) {
  if (rank < 200 || moving || (act !== 'repos' && act !== 'feu' && act !== 'recharge')) return loop(gesture(act, 'inf'));
  const k = Math.floor((rank - 200) / 10), role = (rank - 200) % 10, shot = shots?.[k] ?? -99;
  if (role === 4) return ['boutefeu', shot - BOUTEFEU_FEU];
  if (role === 3) return loop('pointer');
  if (act !== 'feu' && act !== 'recharge' && now - shot > SERVICE) return loop('repos');
  return loop(role === 1 ? 'refouler' : role === 2 ? 'porter' : 'parle');
}
// une pièce de la batterie est-elle encore en action à l'instant now ?
export const serving = (shots, now) => Object.values(shots || {}).some(t => now - t <= SERVICE);

// variété d'un homme, tirée une fois pour toutes (seed : son régiment ; i : son numéro) : place (m, le long du front et
// vers l'avant), sens (rad), taille, nuance de l'habit (teinte, saturation, clarté), rythme dans les gestes en boucle,
// délai (s) avant de changer de geste : les hommes ne sont pas des clones
export function variety(seed, i) {
  const r = k => hash(i, k, seed), c = k => r(k) - 0.5;
  return { du: c(1) * 0.3, dv: c(2) * 0.3, da: c(3) * 0.2, size: 0.95 + r(4) * 0.1, hue: c(5) * 0.02, sat: c(6) * 0.14,
    light: c(7) * 0.08, speed: 0.94 + r(8) * 0.12, delay: r(9) * 0.4 };
}

// attributs d'un homme : aGest (geste, son début, geste d'avant, son début) et aMix (instant du fondu, vitesses du geste
// et du geste d'avant). cur, prev : [numéro du geste, début] (prev null : pas de fondu) ; switchT : instant du
// changement, retardé du délai de l'homme ; v : sa variété ; loopOf(numéro) : geste en boucle (joué à son rythme)
export function rows(cur, prev, switchT, v, loopOf) {
  const sp = id => (loopOf(id) ? v.speed : 1), p = prev ?? cur;
  return [[cur[0], cur[1], p[0], p[1]], [prev ? switchT + v.delay : -99, sp(cur[0]), sp(p[0]), 0]];
}
