// Portraits des régiments, sur les cartes en portrait à la manière d'Ultimate General : en bataille (interface.js)
// comme sur la carte de campagne (ui.js). La figure du type de soldat (unites.js), à l'uniforme de l'année et aux
// couleurs du camp, dessinée dans un repère de 56 × 64 mis à l'échelle de la hauteur du canevas (calée en bas,
// centrée ; en portrait, les côtés sont rognés).
import { uniform, GUN_MODELS } from './battle/formes.js';

// sorte de figure d'après le régiment : cls (inf, cavalerie, artillerie), type, ordre dispersé, génération d'armes
export function figureKind({ cls, type, light = false, arm = 1, general = false, wagon = false }) {
  if (general || cls === 'cavalerie') return 'cav';
  if (cls === 'artillerie') return `canon.${type === 'mitrailleuses' ? 'reffye' : GUN_MODELS[Math.max(0, Math.min(GUN_MODELS.length - 1, arm ?? 0))]}`;
  if (wagon) return 'caisson';
  if (type === 'grenadiers' || type === 'garde') return 'gren';
  if (type === 'milice') return 'milice';
  if (light) return 'leger';
  return arm === 0 ? 'piquier' : 'inf';
}

// cv : canevas ; art : UnitArt (unites.js, son année donne les coiffures) ; kind : figureKind ; color : couleur du
// camp ; cls et name : pour l'habit d'époque (dragons compris)
export function drawPortrait(cv, art, kind, color, cls, name = '') {
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  const k = cv.height / 64 * (cv.height > cv.width * 1.3 ? 1.12 : 1);
  g.setTransform(k, 0, 0, k, (cv.width - 56 * k) / 2, cv.height - 64 * k);
  const H = kind === 'cav' ? 34 : kind.startsWith('canon') || kind === 'caisson' ? 38 : 50;
  const coat = uniform(art.year, cls, name, kind === 'milice' ? 'milice' : '').coat;
  const foot = kind === 'inf' || kind === 'gren' || kind === 'leger' || kind === 'milice' || kind === 'piquier';
  const sp = art.sprite(kind, color, foot ? 0 : 1, H, 0, coat);
  const sc = H / sp.h;
  if (kind.startsWith('canon')) {
    const s2 = art.sprite('servant', color, 0, 40, 0, coat);
    g.drawImage(s2.cv, 34 - s2.ax * (40 / s2.h), 60 - s2.ay * (40 / s2.h), s2.cv.width * 40 / s2.h, s2.cv.height * 40 / s2.h);
  }
  g.drawImage(sp.cv, 28 - sp.ax * sc, 60 - sp.ay * sc, sp.cv.width * sc, sp.cv.height * sc);
}

// ------------------------------------------------------------------ portraits des généraux (SPEC-SUITE G2)
// Un buste peint par le code, dans un médaillon : habit bleu à col et épaulettes d'or, visage tiré du nom (teint,
// cheveux, favoris ou moustache), coiffure de l'époque (tricorne et perruque poudrée avant 1790, bicorne à cocarde
// jusqu'en 1830, puis képi). Aucun fichier ; mis en cache par nom et par époque.
const seed = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const epoque = y => (y < 1790 ? 0 : y < 1830 ? 1 : 2);
// traits du visage d'après le nom et l'année : 0 à 1 chacun, et la coiffure
export function traitsGeneral(name, year) {
  const h = seed(name), r = k => ((h >>> (k * 4)) & 15) / 15;
  const ep = epoque(year);
  return {
    ep, teint: r(0), cheveux: ep === 0 ? 'perruque' : r(1) < 0.5 ? 'brun' : r(1) < 0.8 ? 'chatain' : 'gris',
    poil: ep === 0 ? 'rase' : ep === 1 ? (r(2) < 0.6 ? 'favoris' : 'rase') : r(2) < 0.4 ? 'moustache' : r(2) < 0.75 ? 'barbiche' : 'favoris',
    coiffe: ep === 0 ? 'tricorne' : ep === 1 ? 'bicorne' : 'kepi', age: r(3),
  };
}
const portraitCache = new Map();
// un canevas de 64 × 64 : le médaillon (fond, anneau à la couleur du camp, bordure d'or) et le buste
export function portraitGeneral(name, year, color = '#2b3d7a') {
  const key = `${name}|${epoque(year)}|${color}`;
  let cv = portraitCache.get(key);
  if (cv) return cv;
  const T = traitsGeneral(name, year);
  cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), TAU = Math.PI * 2;
  g.save();
  g.beginPath(); g.arc(32, 32, 29, 0, TAU); g.clip();
  const bg = g.createLinearGradient(0, 0, 0, 64); bg.addColorStop(0, '#5c6670'); bg.addColorStop(1, '#2a3036');
  g.fillStyle = bg; g.fillRect(0, 0, 64, 64);
  // buste : habit bleu, revers et col, épaulettes d'or
  g.fillStyle = '#26365f';
  g.beginPath(); g.moveTo(6, 64); g.quadraticCurveTo(8, 44, 22, 41); g.lineTo(42, 41); g.quadraticCurveTo(56, 44, 58, 64); g.fill();
  g.fillStyle = T.ep === 0 ? '#f1ece0' : '#f4f1e8';   // chemise, cravate
  g.beginPath(); g.moveTo(27, 41); g.lineTo(32, 52); g.lineTo(37, 41); g.fill();
  g.fillStyle = '#b8352a'; g.fillRect(25, 39, 14, 4);   // col rouge
  g.fillStyle = '#d9b45a';
  for (const x of [12, 52]) { g.beginPath(); g.ellipse(x, 45, 7, 3.2, x < 32 ? -0.35 : 0.35, 0, TAU); g.fill(); }
  g.strokeStyle = '#d9b45a'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(26, 44); g.lineTo(31, 56); g.moveTo(38, 44); g.lineTo(33, 56); g.stroke();
  // cou et visage
  const teint = ['#f0d2b4', '#e6bf9b', '#d6a77f', '#c99572'][Math.min(3, (T.teint * 4) | 0)];
  g.fillStyle = teint; g.fillRect(28, 34, 8, 7);
  g.beginPath(); g.ellipse(32, 28, 8.5, 10.5, 0, 0, TAU); g.fill();
  // cheveux
  const ch = { perruque: '#ece8de', brun: '#3b2a1e', chatain: '#6b4a2e', gris: '#9a958c' }[T.cheveux];
  g.fillStyle = ch;
  if (T.cheveux === 'perruque') { for (const x of [23, 41]) { g.beginPath(); g.ellipse(x, 30, 3, 4, 0, 0, TAU); g.fill(); } }
  else { g.beginPath(); g.ellipse(32, 21, 9, 5, 0, Math.PI, TAU); g.fill(); g.fillRect(23, 21, 2.5, 8); g.fillRect(38.5, 21, 2.5, 8); }
  // favoris, moustache, barbiche
  const poil = T.cheveux === 'perruque' ? '#6b5a48' : ch;
  g.fillStyle = poil;
  if (T.poil === 'favoris') { g.fillRect(23.5, 26, 2.5, 8); g.fillRect(38, 26, 2.5, 8); }
  if (T.poil === 'moustache' || T.poil === 'barbiche') { g.beginPath(); g.ellipse(32, 33, 4.5, 1.5, 0, 0, TAU); g.fill(); }
  if (T.poil === 'barbiche') g.fillRect(31, 35, 2, 3.5);
  // yeux, sourcils, nez, bouche
  g.fillStyle = '#2a2018'; g.fillRect(28, 27, 1.8, 1.6); g.fillRect(34.2, 27, 1.8, 1.6);
  g.fillRect(27.3, 24.6, 3.4, 0.9); g.fillRect(33.3, 24.6, 3.4, 0.9);
  g.fillStyle = 'rgba(120,70,50,0.35)'; g.fillRect(31.4, 28, 1.4, 4);
  if (T.poil !== 'moustache' && T.poil !== 'barbiche') { g.fillStyle = 'rgba(130,60,50,0.6)'; g.fillRect(30, 34.2, 4, 0.9); }
  if (T.age > 0.6) { g.strokeStyle = 'rgba(110,70,50,0.35)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(26.5, 30); g.lineTo(27.5, 32); g.moveTo(37.5, 30); g.lineTo(36.5, 32); g.stroke(); }
  // coiffure
  g.fillStyle = '#16171a';
  if (T.coiffe === 'tricorne') {
    g.beginPath(); g.moveTo(19, 20); g.quadraticCurveTo(32, 9, 45, 20); g.quadraticCurveTo(32, 15, 19, 20); g.fill();
    g.strokeStyle = '#d9b45a'; g.lineWidth = 1; g.beginPath(); g.moveTo(19.5, 19.6); g.quadraticCurveTo(32, 14.6, 44.5, 19.6); g.stroke();
  } else if (T.coiffe === 'bicorne') {
    g.beginPath(); g.moveTo(16, 19); g.quadraticCurveTo(32, 3, 48, 19); g.quadraticCurveTo(32, 15, 16, 19); g.fill();
    g.fillStyle = '#2b4f9a'; g.beginPath(); g.arc(36, 13, 2.6, 0, TAU); g.fill();
    g.fillStyle = '#f4f1e8'; g.beginPath(); g.arc(36, 13, 1.7, 0, TAU); g.fill();
    g.fillStyle = '#b8352a'; g.beginPath(); g.arc(36, 13, 0.8, 0, TAU); g.fill();
    g.strokeStyle = '#d9b45a'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(16.5, 18.6); g.quadraticCurveTo(32, 14.6, 47.5, 18.6); g.stroke();
  } else {
    g.fillStyle = '#b8352a'; g.beginPath(); g.moveTo(24, 20); g.lineTo(25, 11); g.lineTo(39, 11); g.lineTo(40, 20); g.fill();
    g.fillStyle = '#26365f'; g.fillRect(23.5, 17, 17, 3.5);
    g.fillStyle = '#16171a'; g.beginPath(); g.ellipse(32, 21, 9, 1.6, 0, 0, Math.PI); g.fill();
    g.strokeStyle = '#d9b45a'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(24.6, 14); g.lineTo(39.4, 14); g.stroke();
  }
  g.restore();
  // anneau du camp et bordure d'or
  g.lineWidth = 4; g.strokeStyle = color; g.beginPath(); g.arc(32, 32, 29, 0, TAU); g.stroke();
  g.lineWidth = 1.4; g.strokeStyle = '#e6c97f'; g.beginPath(); g.arc(32, 32, 31, 0, TAU); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(32, 32, 27, 0, TAU); g.stroke();
  if (portraitCache.size > 200) portraitCache.clear();
  portraitCache.set(key, cv);
  return cv;
}
