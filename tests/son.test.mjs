// Les sons (web/js/son.js) : coupés par défaut, ouverts par un geste, jamais deux fois le même coup sur coup.
//   node --test tests/son.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

// un faux contexte audio : il compte les sources lancées
let lances = 0, horloge = 0;
const noeud = () => ({ connect() {}, start() { lances++; }, stop() {}, type: '', buffer: null, frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 }, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
globalThis.AudioContext = class { constructor() { this.state = 'running'; this.sampleRate = 8000; this.destination = {}; } get currentTime() { return horloge; }
  createDynamicsCompressor() { return noeud(); } createGain() { return noeud(); } createBiquadFilter() { return noeud(); } createOscillator() { return noeud(); } createBufferSource() { return noeud(); }
  createBuffer(c, n) { return { getChannelData: () => new Float32Array(n) }; } resume() { this.state = 'running'; } suspend() { this.state = 'suspended'; } };
const { Son } = await import('../web/js/son.js');

test('coupé par défaut : rien ne joue', () => {
  assert.equal(Son.on, false);
  assert.equal(Son.jouer('salve'), false);
  assert.equal(lances, 0);
});
test('activé : chaque sorte joue, une sorte inconnue non', () => {
  assert.equal(Son.regler(true), true);
  for (const k of ['salve', 'canon', 'mitraille', 'explosion', 'tambour', 'charge', 'deroute', 'drapeau', 'victoire']) { horloge += 10; const n = lances; assert.equal(Son.jouer(k), true, k); assert.ok(lances > n, k); }
  assert.equal(Son.jouer('inconnu'), false);
});
test('pas deux salves dans le même dixième de seconde, ni de son inaudible', () => {
  horloge += 10;
  assert.equal(Son.jouer('salve'), true);
  horloge += 0.05; assert.equal(Son.jouer('salve'), false);
  horloge += 0.2; assert.equal(Son.jouer('salve'), true);
  horloge += 10; assert.equal(Son.jouer('canon', 0.01), false);
});
test('coupé : plus rien', () => {
  Son.regler(false); horloge += 10;
  const n = lances; assert.equal(Son.jouer('canon'), false); assert.equal(lances, n);
});
