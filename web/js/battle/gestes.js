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
