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
