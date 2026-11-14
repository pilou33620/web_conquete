// Les sons du jeu, synthétisés (WebAudio) : rien à télécharger, rien d'emprunté (SPEC-RENDU.md). Salves, canons,
// mitraille, explosions, tambours qui battent la charge, clairons. Coupé par défaut : le navigateur n'ouvre le son
// qu'après un geste, d'où le bouton (barre de la bataille, réglages). Le choix est gardé sur l'appareil.
const CLE = 'conquete.son';
let on = false, ctx = null, sortie = null, souffle = null;
try { on = localStorage.getItem(CLE) === '1'; } catch (e) { /* stockage indisponible */ }
const dernier = {};   // sorte → instant du dernier son (s) : pas deux fois le même coup sur coup
const ECART = { salve: 0.1, canon: 0.14, mitraille: 0.14, explosion: 0.3, tambour: 5, charge: 6, deroute: 6, drapeau: 3, victoire: 5 };

function ouvrir() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return false;
  if (!ctx) {
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor(); sortie = ctx.createGain(); sortie.gain.value = 0.55;
    sortie.connect(comp); comp.connect(ctx.destination);
    souffle = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = souffle.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}
// un souffle filtré : t l'instant, f la fréquence du filtre, d la durée, v le volume
function bouffee(t, sorte, f, q, d, v) {
  const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = souffle; fl.type = sorte; fl.frequency.value = f; fl.Q.value = q;
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
  s.connect(fl); fl.connect(g); g.connect(sortie); s.start(t, Math.random() * 0.8, d + 0.02);
}
// une note : forme d'onde, fréquence de départ et d'arrivée, durée, volume
function note(t, forme, f0, f1, d, v) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = forme; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + d);
  g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + d);
  o.connect(g); g.connect(sortie); o.start(t); o.stop(t + d + 0.02);
}
const sonnerie = (t, notes, v) => notes.forEach(([f, d], i) => { const t0 = t + notes.slice(0, i).reduce((a, n) => a + n[1], 0); note(t0, 'square', f, f, d * 0.92, v * 0.35); note(t0, 'triangle', f, f, d * 0.92, v); });
const SOL = 392, DO = 523.25, MI = 659.25, SOL2 = 783.99;
const SONS = {
  // la salve : des coups secs qui se suivent, un roulement sourd dessous
  salve(t, v) { for (let i = 0, n = 7 + (Math.random() * 6 | 0); i < n; i++) bouffee(t + Math.random() * 0.32, 'highpass', 1400 + Math.random() * 1200, 0.7, 0.07, v * 0.5); bouffee(t, 'lowpass', 320, 0.8, 0.45, v * 0.6); },
  canon(t, v) { note(t, 'sine', 115, 36, 0.6, v * 1.3); bouffee(t, 'lowpass', 500, 0.7, 0.35, v); bouffee(t + 0.03, 'bandpass', 1800, 0.8, 0.12, v * 0.4); },
  mitraille(t, v) { note(t, 'sine', 130, 45, 0.4, v); bouffee(t, 'bandpass', 2600, 0.6, 0.4, v * 0.7); },
  explosion(t, v) { note(t, 'sine', 90, 26, 1.1, v * 1.5); bouffee(t, 'lowpass', 380, 0.6, 0.9, v * 1.2); },
  // le tambour bat la charge : ra-ta-plan
  tambour(t, v) { for (const [k, f] of [[0, 1], [0.1, 0.6], [0.2, 0.6], [0.34, 1], [0.6, 1], [0.7, 0.6], [0.8, 0.6], [0.94, 1]]) { bouffee(t + k, 'bandpass', 190, 2.2, 0.11, v * f * 1.6); bouffee(t + k, 'highpass', 3000, 0.7, 0.03, v * f * 0.3); } },
  charge(t, v) { SONS.tambour(t, v * 0.8); sonnerie(t + 0.1, [[SOL, 0.13], [DO, 0.13], [MI, 0.13], [SOL2, 0.34], [MI, 0.13], [SOL2, 0.42]], v * 0.5); },
  deroute(t, v) { sonnerie(t, [[SOL2, 0.22], [MI, 0.22], [DO, 0.22], [SOL, 0.5]], v * 0.4); },
  drapeau(t, v) { sonnerie(t, [[DO, 0.12], [DO, 0.12], [MI, 0.12], [SOL2, 0.5]], v * 0.5); },
  victoire(t, v) { sonnerie(t, [[SOL, 0.16], [DO, 0.16], [MI, 0.16], [SOL2, 0.3], [MI, 0.16], [SOL2, 0.7]], v * 0.6); SONS.tambour(t + 0.2, v * 0.6); },
};

export const Son = {
  get on() { return on; },
  // v : vrai pour ouvrir le son ; à appeler depuis un geste (clic, appui)
  regler(v) {
    on = !!v;
    try { localStorage.setItem(CLE, on ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
    if (on) ouvrir(); else ctx?.suspend?.();
    return on;
  },
  // sorte : salve, canon, mitraille, explosion, tambour, charge, deroute, drapeau, victoire ; vol de 0 à 1
  jouer(sorte, vol = 1) {
    if (!on || !SONS[sorte] || vol <= 0.02 || !ouvrir() || ctx.state !== 'running') return false;
    const t = ctx.currentTime;
    if (t - (dernier[sorte] ?? -99) < (ECART[sorte] || 0.1)) return false;
    dernier[sorte] = t; SONS[sorte](t + 0.01, Math.min(1, vol));
    return true;
  },
};
// réglage gardé d'une autre fois : le son s'ouvre au premier geste
if (on && typeof document !== 'undefined') document.addEventListener('pointerdown', () => on && ouvrir(), { once: true });
