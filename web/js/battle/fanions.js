// Vue tactique : fanions au-dessus des régiments, à la manière d'Ultimate General, sur le calque 2D (taille constante
// à l'écran) : un carré aux couleurs du camp portant le pictogramme de l'arme, puis l'effectif en blanc sur fond
// sombre, au bout d'une hampe plantée juste au-dessus des têtes. Pour ses troupes, le moral en liseré sous le fanion ;
// en déroute, le fanion pâlit et se barre ; un régiment deviné (plus en vue) montre « ? ». Les généraux : un médaillon
// rond et leur nom. Les fanions ne se chevauchent pas : celui qui gêne monte d'un cran.
import { clsOf, isGeneral, genName, clamp, TAU, mixHex } from './formes.js';

const SQ = 18, H = 18, PAD = 6;                 // carré du pictogramme, hauteur du fanion, marge du nombre (px)
const LIFT = 4.6;                               // la hampe part à 4,6 m au-dessus du sol (au-dessus des drapeaux)
const NUM = '700 12px "Helvetica Neue", Arial, sans-serif';
const lite = (c, k) => mixHex(c, '#ffffff', k);
const men = un => un.men >= 1000 ? (un.men / 1000).toFixed(1).replace('.', ',') + 'k' : String(Math.round(un.men));

// view : {toScreenH(x, y, dh) → [sx, sy, profondeur], vw, vh} ; opts : {sel, me, time} ; renvoie les rectangles des
// fanions (pour toucher un régiment par son fanion)
export function drawBanners(ctx, view, units, colors, opts) {
  ctx.font = NUM;
  const list = [];
  for (const un of units) {
    if (un.state === 'hors') continue;
    const [sx, sy, depth] = view.toScreenH(un.x, un.y, LIFT);
    if (depth <= 0) continue;
    const gen = isGeneral(un), w = gen ? 32 : SQ + PAD * 2 + Math.max(16, ctx.measureText(un._ghost ? '?' : men(un)).width);
    list.push({ un, sx, sy, w, h: gen ? 32 : H, top: sy - (gen ? 44 : 30) });
  }
  // de gauche à droite ; celui qui en gêne un autre déjà placé monte au-dessus
  list.sort((a, b) => a.sx - b.sx);
  const placed = [];
  for (const b of list) {
    let y = b.top;
    for (let tries = 0; tries < 4; tries++) {
      const hit = placed.find(p => Math.abs(p.sx - b.sx) < (p.w + b.w) / 2 + 2 && Math.abs(p.y - y) < (p.h + b.h) / 2 + 2);
      if (!hit) break;
      y = hit.y - (hit.h + b.h) / 2 - 3;
    }
    b.y = y;
    placed.push(b);
  }
  const out = [];
  for (const p of placed) {
    const { un, sx, sy } = p, col = colors[un.side] || '#777';
    const sel = opts.sel.has(String(un.id)), mine = un.side === opts.me, ghost = un._ghost;
    ctx.globalAlpha = ghost ? 0.55 : 1;
    // hampe
    ctx.strokeStyle = 'rgba(20,16,12,0.8)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, p.y + p.h / 2); ctx.stroke();
    if (isGeneral(un)) medallion(ctx, sx, p.y, col, un, sel);
    else banner(ctx, p, col, un, { sel, mine, ghost, time: opts.time });
    ctx.globalAlpha = 1;
    out.push({ id: String(un.id), x0: sx - p.w / 2 - 4, y0: p.y - p.h / 2 - 4, x1: sx + p.w / 2 + 4, y1: sy });
  }
  return out;
}

function banner(ctx, p, col, un, { sel, mine, ghost }) {
  const x0 = Math.round(p.sx - p.w / 2), y0 = Math.round(p.y - p.h / 2), w = p.w, h = p.h;
  const rout = un.state === 'deroute' && !ghost;
  ctx.fillStyle = 'rgba(6,10,16,0.35)'; ctx.fillRect(x0 + 1.5, y0 + 1.5, w, h);   // ombre
  ctx.fillStyle = rout ? 'rgba(70,66,60,0.88)' : 'rgba(28,30,34,0.86)'; ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = rout ? lite(col, 0.45) : col; ctx.fillRect(x0, y0, SQ, h);
  picto(ctx, clsOf(un), x0 + SQ / 2, y0 + h / 2, '#fff8ec');
  ctx.fillStyle = '#ffffff'; ctx.font = NUM; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ghost ? '?' : men(un), x0 + SQ + (w - SQ) / 2, y0 + h / 2 + 0.5);
  ctx.strokeStyle = sel ? '#ffd98a' : mine ? 'rgba(230,201,127,0.7)' : 'rgba(255,255,255,0.28)'; ctx.lineWidth = sel ? 2.2 : 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
  if (rout) {   // la barre
    ctx.strokeStyle = '#ffe2c8'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0 + 3, y0 + h - 3); ctx.lineTo(x0 + w - 3, y0 + 3); ctx.stroke();
    ctx.strokeStyle = '#b8352a'; ctx.lineWidth = 1; ctx.stroke(); ctx.lineCap = 'butt';
  }
  // moral : un liseré sous le fanion (vert → rouge) pour ses propres troupes
  if (mine) {
    const m = clamp((un.morale ?? 70) / 100, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x0, y0 + h + 1, w, 3);
    ctx.fillStyle = m > 0.5 ? '#8fcf6b' : m > 0.3 ? '#e6c45a' : '#e0604f'; ctx.fillRect(x0, y0 + h + 1, w * m, 3);
  }
}

// médaillon d'un général : cercle bordé de laiton, fond aux couleurs du camp, bicorne ; son nom dessous
function medallion(ctx, x, y, col, un, sel) {
  ctx.fillStyle = 'rgba(6,10,16,0.4)'; ctx.beginPath(); ctx.arc(x + 1.5, y + 1.5, 16, 0, TAU); ctx.fill();
  ctx.fillStyle = '#13233a'; ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.fill();
  ctx.strokeStyle = sel ? '#ffd98a' : '#c8a253'; ctx.lineWidth = sel ? 3 : 2; ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 12, 0, TAU); ctx.fill();
  // portrait : épaules, tête, bicorne
  ctx.fillStyle = '#1b2a44'; ctx.beginPath(); ctx.ellipse(x, y + 10, 8, 5, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#e8c39e'; ctx.beginPath(); ctx.arc(x, y + 1, 4, 0, TAU); ctx.fill();
  ctx.fillStyle = '#16120e';
  ctx.beginPath(); ctx.moveTo(x - 8, y - 2); ctx.quadraticCurveTo(x, y - 12, x + 8, y - 2); ctx.quadraticCurveTo(x, y - 5, x - 8, y - 2); ctx.fill();
  ctx.fillStyle = '#e6c97f'; ctx.beginPath(); ctx.arc(x, y - 6, 1.4, 0, TAU); ctx.fill();
  const name = (genName(un) || un.name || '').toUpperCase();
  ctx.font = '700 10px "Helvetica Neue", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(name).width + 10;
  ctx.fillStyle = 'rgba(20,24,30,0.88)'; ctx.fillRect(x - tw / 2, y + 19, tw, 13);
  ctx.fillStyle = '#f1ead8'; ctx.fillText(name, x, y + 26);
}

// pictogramme de l'arme : fusil (en biais, baïonnette au canon), tête de cheval, canon, roue, bicorne
export function picto(ctx, cls, x, y, col) {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round';
  if (cls === 'cavalerie') {
    ctx.beginPath(); ctx.moveTo(-3.5, 6); ctx.lineTo(-3, -1); ctx.lineTo(-1.5, -5); ctx.lineTo(-0.5, -7); ctx.lineTo(0.5, -5.2); ctx.lineTo(4.5, -1.5);
    ctx.lineTo(4, 0.5); ctx.lineTo(1, -0.5); ctx.lineTo(1.5, 6); ctx.closePath(); ctx.fill();
  } else if (cls === 'artillerie') {
    ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(-1.5, 3, 3.2, 0, TAU); ctx.stroke();
    ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-4, 1); ctx.lineTo(5.5, -3.5); ctx.stroke();
  } else if (cls === 'chariot') {
    ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(0, 1, 4.5, 0, TAU); ctx.moveTo(-4.5, 1); ctx.lineTo(4.5, 1); ctx.moveTo(0, -3.5); ctx.lineTo(0, 5.5); ctx.stroke();
  } else if (cls === 'general') {
    ctx.beginPath(); ctx.moveTo(-5, 1); ctx.quadraticCurveTo(0, -7, 5, 1); ctx.quadraticCurveTo(0, -2, -5, 1); ctx.fill();
  } else {
    // fusil : crosse en bas à gauche, canon et baïonnette vers le haut à droite
    ctx.rotate(-Math.PI / 4);
    ctx.fillRect(-7, -1.6, 4.2, 3.2);
    ctx.fillRect(-3, -0.9, 7.5, 1.8);
    ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(4.5, 0); ctx.lineTo(8, 0); ctx.stroke();
  }
  ctx.restore();
}
