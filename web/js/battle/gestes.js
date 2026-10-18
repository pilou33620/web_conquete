// Vue tactique : les gestes des hommes. Logique pure, sans Three.js (bancs : tests/gestes.test.mjs). Les animations
// sont précalculées (dev/cuire.mjs, web/anims/soldat.*) ; troupes.js écrit dans les attributs de chaque figurine le
// geste choisi ici, et le vertex shader le joue.

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
export function pick({ act, actT, now, kind, rank, u, w, form, phase, volley, moving }) {
  const loop = name => [name, actT - phase];
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
