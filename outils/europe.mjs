#!/usr/bin/env node
// La géographie du mode « Europe » (SPEC-FRANCE.md, étape 2) : l'Europe et l'Afrique du Nord au milieu du XVIIIe siècle,
// à 5 km la case. Écrit game/data/europe.json, places_europe.json, pays_europe.json et epoques_europe.json.
//
// Usage :  node outils/europe.mjs <dossier node_modules> [--apercu carte.svg]
// Sources et préparation du dossier de travail : outils/EUROPE.md. Déterministe : deux lancements, mêmes fichiers.
// Entrées écrites à la main (estimations, à quelques milliers près) : outils/europe/villes.json (villes et ports de 1790),
// outils/europe/epoques.json (populations de 1700 à 1900) ; ci-dessous : frontières, fleuves, caractère des pays.
//
// Méthode : tout passe par une grille fine (un tiers de case, 1,67 km). Chaque maille de terre (pays Natural Earth)
// reçoit un pays de 1750 d'après le pays d'aujourd'hui, sa région (Highcharts) ou une retouche écrite ci-dessous ; les
// contours sont ensuite retracés sur la grille et simplifiés arc par arc : deux pays voisins partagent exactement les
// mêmes points, il n'y a ni trou ni recouvrement. À la fin, l'outil refait le calcul du moteur (geo.rs : raster_ring,
// trous bouchés, lacs, terres hors jeu) à 5 km et vérifie tout ce qu'il écrit ; il s'arrête au premier défaut.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ICI, '..', 'game', 'data');
const NM = process.argv[2];
const APERCU = process.argv.includes('--apercu') ? process.argv[process.argv.indexOf('--apercu') + 1] : null;
const stop = msg => { console.error('ERREUR : ' + msg); process.exit(1); };
if (!NM || !fs.existsSync(path.join(NM, 'world-atlas'))) stop('usage : node outils/europe.mjs <dossier node_modules> [--apercu carte.svg] (voir outils/EUROPE.md)');
const NE = path.join(NM, '..', 'natural-earth');
const lire = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const lireNE = f => {
  const p = path.join(NE, f);
  if (!fs.existsSync(p)) stop(`il manque ${p} (Natural Earth, voir outils/EUROPE.md)`);
  return lire(p).features.filter(x => x.geometry);
};

// ------------------------------------------------------------------ étendue et grilles
const LON0 = -11, LON1 = 45, LAT0 = 29, LAT1 = 62, LAT_REF = 46, KM = 5;
const KX = 111.32 * Math.cos(LAT_REF * Math.PI / 180), KY = 110.95; // comme geo.rs
const W = Math.ceil((LON1 - LON0) * KX / KM), H = Math.ceil((LAT1 - LAT0) * KY / KM); // cases de 5 km
const F = 3, GW = W * F, GH = H * F, N = GW * GH; // grille fine
const gx = lon => (lon - LON0) * KX / KM * F, gy = lat => (LAT1 - lat) * KY / KM * F;
const lonDe = x => LON0 + x * KM / F / KX, latDe = y => LAT1 - y * KM / F / KY;
const km = (a, b) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY); // distance entre deux [lon, lat]
const dansCadre = p => p[0] >= LON0 && p[0] <= LON1 && p[1] >= LAT0 && p[1] <= LAT1;

// ------------------------------------------------------------------ les pays de 1750
// Estimations et choix d'auteur : les frontières sont celles du milieu du XVIIIe siècle, approchées par les pays et
// les régions d'aujourd'hui. « ~Nom » : terre hors jeu (lands).
const ENTIERS = {
  'United Kingdom': 'GB', Ireland: 'GB', 'Isle of Man': 'GB', Jersey: 'GB', Guernsey: 'GB', Gibraltar: 'GB',
  Andorra: 'ES', Portugal: 'PT', Netherlands: 'NL', Belgium: 'BE', Luxembourg: 'BE', Switzerland: 'CH', Monaco: 'FR',
  'San Marino': 'PO', Vatican: 'PO', Austria: 'AU', Czechia: 'AU', Slovakia: 'AU', Hungary: 'AU', Slovenia: 'AU', Liechtenstein: 'AU',
  Lithuania: 'PL', Belarus: 'PL', Estonia: 'RU', Sweden: 'SE', Finland: 'SE', 'Åland': 'SE',
  Denmark: 'DK', Norway: 'DK', 'Faeroe Is.': 'DK',
  Turkey: 'OT', Bulgaria: 'OT', Albania: 'OT', Macedonia: 'OT', Kosovo: 'OT', Montenegro: 'OT', 'Bosnia and Herz.': 'OT', Moldova: 'OT',
  Cyprus: 'OT', 'N. Cyprus': 'OT', 'Cyprus U.N. Buffer Zone': 'OT', Dhekelia: 'OT', Akrotiri: 'OT',
  Syria: 'OT', Lebanon: 'OT', Israel: 'OT', Palestine: 'OT',
  Morocco: 'MA', Tunisia: 'TU',
  Iraq: '~Mésopotamie', Iran: '~Perse', 'Saudi Arabia': '~Arabie', Georgia: '~Caucase', Armenia: '~Caucase', Azerbaijan: '~Caucase', Malta: 'ML',
};
// pays coupés : carte de régions Highcharts (facultative), région → pays, pays par défaut, retouche (lon, lat, région)
const sousDvina = (lon, lat) => lat < 56.95 - (lon - 24.1) * 0.45; // au sud-ouest de la Dvina, de Riga à Dunabourg
const COUPES = {
  France: { carte: 'fr/fr-all-all', regions: { Savoy: 'SA', 'Upper Savoy': 'SA', 'Haute-Corse': 'GE', 'South Corsica': 'GE' }, defaut: 'FR', // la Corse, génoise jusqu'en 1768
    retouche: (lon, lat, r) => r === 'Maritime Alps' && lon > 7.2 ? 'SA' : null }, // le comté de Nice, à l'est du Var
  Spain: { defaut: 'ES', retouche: (lon, lat) => lon > -5.42 && lon < -5.30 && lat > 36.10 && lat < 36.20 ? 'GB' : null }, // Gibraltar
  Italy: { carte: 'it/it-all', defaut: 'NA',
    regions: { Piemonte: 'SA', "Valle d'Aosta / Vallée d'Aoste": 'SA', 'Sardigna/Sardegna': 'SA', Veneto: 'VE', 'Friuli-Venezia Giulia': 'VE',
      Liguria: 'GE', Toscana: 'IT', Lombardia: 'IT', 'Emilia-Romagna': 'PO', Lazio: 'PO', Umbria: 'PO', Marche: 'PO', 'Trentino-Alto Adige/Südtirol': 'AU' },
    retouche: (lon, lat, r) =>
      r === 'Emilia-Romagna' && lon < 11.15 ? 'IT' // Parme, Plaisance, Modène, Reggio
      : r === 'Lombardia' && lon > 9.4 && lat >= 46.02 ? 'CH' // la Valteline aux Grisons
      : r === 'Lombardia' && lon > 9.45 && lat > 45.42 ? 'VE' // Bergame et Brescia
      : r === 'Friuli-Venezia Giulia' && lon > 13.45 && lat < 46.0 ? 'AU' // Gorizia et Trieste
      : r === 'Lazio' && lon > 13.45 && lat < 41.62 ? 'NA' // Gaète et la Terre de Labour
      : null },
  Germany: { carte: 'de/de-all', defaut: 'HA',
    regions: { Bayern: 'BA', Sachsen: 'SX', 'Thüringen': 'SX', Brandenburg: 'PR', Berlin: 'PR', 'Sachsen-Anhalt': 'PR', 'Schleswig-Holstein': 'DK',
      'Baden-Württemberg': 'WU', 'Nordrhein-Westfalen': 'WE', 'Rheinland-Pfalz': 'WE', Saarland: 'WE', Hessen: 'WE' } },
  Poland: { carte: 'pl/pl-all', defaut: 'PL',
    regions: { 'West Pomeranian': 'PR', Lubusz: 'PR', 'Lower Silesian': 'PR', Opole: 'PR', Silesian: 'PR', 'Warmian-Masurian': 'PR' } },
  Ukraine: { carte: 'ua/ua-all', defaut: 'PL',
    regions: { Odessa: 'OT', Kherson: 'CR', Mykolayiv: 'CR', Crimea: 'CR', Sevastopol: 'CR', Zaporizhzhya: 'CR', Chernivtsi: 'OT', Transcarpathia: 'AU',
      Sumy: 'RU', "Donets'k": 'RU', "Dnipropetrovs'k": 'RU', Kharkiv: 'RU', "Luhans'k": 'RU', Poltava: 'RU', Chernihiv: 'RU',
      Kiev: 'RU', 'Kiev City': 'RU', Kirovohrad: 'RU' } },
  Croatia: { carte: 'hr/hr-all', defaut: 'AU',
    regions: { Istarska: 'VE', Zadarska: 'VE', 'Šibensko-Kninska': 'VE', 'Splitsko-Dalmatinska': 'VE', 'Dubrovacko-Neretvanska': 'VE' } },
  Greece: { carte: 'gr/gr-all', defaut: 'OT', regions: { 'Ionioi Nisoi': 'VE' } },
  Romania: { carte: 'ro/ro-all', defaut: 'OT',
    regions: Object.fromEntries(['Caras-Severin', 'Timis', 'Arad', 'Bihor', 'Satu Mare', 'Maramures', 'Salaj', 'Cluj', 'Bistrita-Nasaud', 'Alba',
      'Hunedoara', 'Mures', 'Sibiu', 'Brasov', 'Covasna', 'Harghita'].map(r => [r, 'AU'])) },
  Serbia: { carte: 'rs/rs-all', defaut: 'OT',
    regions: Object.fromEntries(['Južno-Backi', 'Zapadno-Backi', 'Severno-Backi', 'Severno-Banatski', 'Srednje-Banatski', 'Južno-Banatski', 'Sremski'].map(r => [r, 'AU'])) },
  Latvia: { defaut: 'RU', retouche: (lon, lat) => lon > 26 ? 'PL' : sousDvina(lon, lat) ? 'CO' : null }, // Latgale ; Courlande
  Russia: { defaut: 'RU', retouche: (lon, lat) => lon < 23 ? 'PR' : lat < 46.3 ? (lon > 32.3 && lon < 36.7 && lat > 44.3 ? 'CR' : '~Caucase') : null }, // Königsberg ; la Crimée ; le Kouban
  Algeria: { defaut: 'AL', retouche: (lon, lat) => lat < 32.3 ? '~Sahara' : null },
  Libya: { defaut: 'TR', retouche: (lon, lat) => lat < 30 ? '~Sahara' : null },
  Egypt: { defaut: 'OT', retouche: (lon, lat) => lon < 29.3 && lat < 30.6 ? '~Sahara' : null },
  Jordan: { defaut: 'OT', retouche: (lon) => lon > 37 ? '~Arabie' : null },
};
// détroits rouverts sur 7,5 km de large (la grille les fermerait) : la mer Noire, la Baltique restent des mers ouvertes
const DETROITS = [
  ['Bosphore', [[29.14, 41.25], [29.07, 41.12], [29.0, 41.0], [28.97, 40.93]]],
  ['Dardanelles', [[26.72, 40.45], [26.6, 40.33], [26.4, 40.2], [26.38, 40.1], [26.18, 40.02]]],
  ['Sund', [[12.62, 56.1], [12.68, 56.0], [12.8, 55.85], [12.85, 55.6]]],
  ['Petit Belt', [[9.75, 55.62], [9.72, 55.52], [9.85, 55.4], [9.95, 55.25], [10.0, 55.1]]],
  ['Messine', [[15.66, 38.3], [15.62, 38.2], [15.58, 38.05]]],
  ['Kertch', [[36.6, 45.45], [36.6, 45.3], [36.45, 45.15]]],
];

// ------------------------------------------------------------------ fleuves : estimations (source et embouchure, à 30 km près)
// [nom, rang (1 fleuve, 2 grande rivière, 3 rivière), [lon, lat] vers la source, [lon, lat] à l'embouchure ou au confluent,
// noms Natural Earth admis pour ces deux points (facultatif, quand un autre cours d'eau passe plus près)].
// Le tracé est celui de Natural Earth (lignes de 10 m), suivi d'un point à l'autre ; à défaut, des points écrits de mémoire.
const FLEUVES = [
  ['Danube', 1, [8.3, 48.0], [29.65, 45.15]], ['Rhin', 1, [9.4, 46.8], [4.1, 51.97]], ['Elbe', 1, [15.8, 50.5], [9.8, 53.55]],
  ['Oder', 1, [17.6, 49.7], [14.6, 53.6], /^Oder$/], ['Vistule', 1, [18.9, 49.6], [18.95, 54.35]], ['Niémen', 1, [27.0, 53.4], [21.3, 55.3]],
  ['Dvina', 1, [32.5, 56.85], [24.05, 57.05]], ['Dniepr', 1, [33.7, 55.85], [32.6, 46.55]], ['Dniestr', 1, [22.9, 49.2], [30.45, 46.1]],
  ['Don', 1, [38.3, 54.0], [39.4, 47.1]], ['Volga', 1, [32.6, 57.0], [45.2, 56.1]], ['Basse Volga', 1, [45.6, 50.5], [45.3, 48.5]],
  ['Tage', 1, [-1.8, 40.5], [-8.8, 39.1], /^(Tajo|Tejo)$/], ['Èbre', 1, [-4.2, 43.0], [0.87, 40.72]], ['Douro', 1, [-2.9, 42.0], [-8.65, 41.15]],
  ['Guadalquivir', 1, [-2.9, 38.0], [-6.3, 36.85]], ['Guadiana', 2, [-3.2, 39.2], [-7.4, 37.2]],
  ['Loire', 1, [4.2, 44.85], [-2.1, 47.28]], ['Seine', 1, [4.7, 47.5], [0.3, 49.45]], ['Rhône', 1, [8.3, 46.6], [4.8, 43.35], /^Rh.?ne$/],
  ['Garonne', 1, [0.9, 42.65], [-0.5, 44.9], /^Garonne$/], ['Dordogne', 2, [2.8, 45.55], [-0.5, 45.02]], ['Marne', 2, [5.4, 47.85], [2.42, 48.82]],
  ['Saône', 2, [6.2, 48.1], [4.83, 45.73]], ['Moselle', 2, [6.9, 47.95], [7.6, 50.36]], ['Meuse', 2, [5.6, 48.0], [4.3, 51.75]],
  ['Escaut', 2, [3.3, 50.0], [4.25, 51.35]], ['Pô', 1, [7.1, 44.7], [12.5, 44.97]], ['Adige', 2, [10.6, 46.8], [12.3, 45.15]],
  ['Tibre', 2, [12.1, 43.8], [12.23, 41.74]], ['Arno', 3, [11.7, 43.4], [10.28, 43.68]],
  ['Tamise', 2, [-2.0, 51.7], [0.5, 51.48]], ['Severn', 2, [-3.7, 52.5], [-2.5, 51.7]], ['Trent', 3, [-2.2, 53.05], [-0.7, 53.7]],
  ['Shannon', 2, [-8.0, 54.2], [-8.9, 52.6]],
  ['Weser', 2, [10.9, 50.5], [8.5, 53.5]], ['Main', 2, [11.5, 49.95], [8.3, 50.0]], ['Inn', 2, [9.7, 46.4], [13.47, 48.57]],
  ['Vltava', 3, [13.6, 49.0], [14.47, 50.35]], ['Warta', 2, [19.5, 50.5], [14.63, 52.6]], ['Bug', 2, [24.9, 49.9], [20.7, 52.42]],
  ['Drave', 2, [12.3, 46.7], [18.9, 45.55]], ['Save', 2, [13.75, 46.45], [20.45, 44.82]], ['Tisza', 2, [24.2, 48.05], [20.25, 45.15]],
  ['Mureș', 3, [25.6, 46.65], [20.2, 46.25]], ['Olt', 3, [25.8, 46.7], [24.8, 43.72]], ['Prout', 2, [24.6, 48.3], [28.2, 45.47]],
  ['Morava', 2, [21.3, 42.3], [21.03, 44.7]], ['Drina', 3, [19.5, 42.75], [19.37, 44.9]], ['Maritsa', 2, [23.8, 42.25], [26.05, 40.73]],
  ['Vardar', 2, [20.9, 41.8], [22.72, 40.5]],
  ['Boug méridional', 2, [26.5, 49.6], [31.75, 47.1], /^Southern Bug$/],
  ['Donets', 2, [36.9, 51.0], [40.9, 47.6]], ['Oka', 2, [36.2, 52.4], [44.0, 56.3]], ['Neva', 2, [31.0, 59.95], [30.25, 59.93]],
  ['Volkhov', 3, [31.3, 58.45], [32.33, 60.1]], ['Glomma', 2, [11.6, 61.5], [10.95, 59.2]], ['Dalälven', 2, [14.6, 61.0], [17.45, 60.63]],
  ['Göta älv', 3, [12.3, 58.38], [11.9, 57.7]],
  ['Kızılırmak', 2, [38.4, 39.9], [35.95, 41.72]], ['Sakarya', 2, [31.0, 39.0], [30.65, 41.12]], ['Euphrate', 1, [38.8, 38.9], [45.2, 31.3], /^(Firat|Al Furat|Euphrates)$/],
  ['Jourdain', 3, [35.6, 33.2], [35.55, 31.76]],
  ['Nil', 1, [31.0, 28.5], [30.4, 31.45]], ['Nil (branche de Damiette)', 2, [31.15, 30.2], [31.83, 31.52]],
  ['Moulouya', 2, [-5.3, 32.6], [-2.35, 35.1]], ['Sebou', 2, [-5.0, 33.2], [-6.65, 34.27]], ['Oum Er-Rbia', 2, [-5.1, 33.0], [-8.33, 33.3]],
  // absents de Natural Earth : points connus du cours, de la source à l'embouchure (de mémoire, à quelques km près)
  ['Chélif', 2, [[2.9, 35.2], [2.75, 35.88], [2.55, 36.15], [2.22, 36.26], [1.85, 36.22], [1.33, 36.17], [0.9, 36.05], [0.55, 36.0], [0.13, 36.04]]],
  ['Medjerda', 2, [[7.95, 36.28], [8.43, 36.45], [8.78, 36.5], [8.97, 36.61], [9.45, 36.55], [9.6, 36.65], [9.84, 36.83], [10.2, 37.03]]],
];
const LAC_MIN_KM2 = 100; // lacs gardés (Natural Earth, hors retenues modernes)
const LIEN_KM = 6; // raccord entre deux tronçons de Natural Earth

// ------------------------------------------------------------------ les pays : le format des camps du jeu (rules.rs, FACTIONS)
// Choix d'auteur, dans le ton des départements du mode France. mods : seulement des clés que le moteur lit déjà.
const CLES_MODS = ['livres', 'vivres', 'fer', 'bois', 'recrues', 'trade', 'vin', 'industrie', 'port', 'upkeep', 'inf_power', 'cav_power', 'art_power', 'art_cost',
  'cav_cost', 'fort_bonus', 'road_speed', 'mountain', 'ambush', 'marsh_attr', 'stealth', 'attrition', 'research_speed', 'siege_speed', 'morale', 'diplo'];
const P = (name, short, adj, color, title, pros, cons, mods, [aggr, trade, expand, tech], specialty) =>
  ({ name, short, capital: '', color, adj, title, pros, cons, mods, personality: { aggr, trade, expand, tech }, specialty });
const PAYS = {
  FR: P('Royaume de France', 'France', 'français', '#2b3fc4', 'Le Grand Royaume', ['Royaume le plus peuplé : recrues +15 %', 'Corps royal de l\'artillerie : artillerie +10 %', 'Places de Vauban : fortifications +10 %'], ['Finances obérées : livres −10 %'],
    { recrues: 0.15, art_power: 0.1, fort_bonus: 0.1, livres: -0.1 }, [0.65, 0.6, 0.7, 'militaire'], 'recrues'),
  GB: P('Royaume de Grande-Bretagne', 'G.-Bretagne', 'britannique', '#c0392b', 'La Maîtresse des mers', ['Négoce des Indes : accords commerciaux +30 %', 'Ports +20 %', 'Manufactures : industrie +20 %'], ['Petite armée de terre : recrues −20 %'],
    { trade: 0.3, port: 0.2, industrie: 0.2, recrues: -0.2 }, [0.5, 0.95, 0.6, 'industriel'], 'livres'),
  ES: P("Royaume d'Espagne", 'Espagne', 'espagnol', '#e0a526', "L'Empire des Indes", ['Argent des Amériques : livres +15 %', 'Guérilla : embuscades +20 %'], ['Industrie −15 %', 'Routes de montagne −5 %'],
    { livres: 0.15, ambush: 0.2, industrie: -0.15, road_speed: -0.05 }, [0.5, 0.6, 0.55, 'civil'], 'livres'),
  PT: P('Royaume de Portugal', 'Portugal', 'portugais', '#1e8449', "Le Comptoir de l'Atlantique", ['Or du Brésil : accords commerciaux +25 %', 'Vins de Porto : +20 % de revenus viticoles'], ['Petit royaume : recrues −15 %'],
    { trade: 0.25, vin: 0.2, recrues: -0.15 }, [0.3, 0.9, 0.4, 'civil'], 'livres'),
  NL: P('Provinces-Unies', 'Prov.-Unies', 'hollandais', '#e67e22', 'Les Rouliers des mers', ["Bourse d'Amsterdam : livres +25 %", 'Accords commerciaux +25 %', 'Digues et inondations : fortifications +10 %'], ['Milice bourgeoise : infanterie −8 %', 'Recrues −15 %'],
    { livres: 0.25, trade: 0.25, fort_bonus: 0.1, inf_power: -0.08, recrues: -0.15 }, [0.3, 0.95, 0.4, 'civil'], 'livres'),
  BE: P('Pays-Bas du Sud', 'Pays-Bas S.', 'belge', '#f4d03f', 'Les Bonnes Villes de Flandre et de Brabant', ['Villes drapières : industrie +15 %', 'Riches campagnes : vivres +15 %'], ['Souverain lointain : recrues −10 %'],
    { industrie: 0.15, vivres: 0.15, recrues: -0.1 }, [0.3, 0.8, 0.4, 'industriel'], 'vivres'),
  CH: P('Confédération des XIII cantons', 'Suisse', 'suisse', '#a93226', 'Les Cantons et leurs régiments', ['Infanterie +12 %', 'Combat et marche en montagne +25 %'], ['Commerce −10 %', 'Vivres −10 %'],
    { inf_power: 0.12, mountain: 0.25, trade: -0.1, vivres: -0.1 }, [0.35, 0.5, 0.3, 'militaire'], 'recrues'),
  SA: P('États de Savoie', 'Savoie', 'savoyard', '#7f8c8d', 'Les Portiers des Alpes', ['Combat et marche en montagne +20 %', 'Citadelles : fortifications +15 %'], ['Livres −10 %'],
    { mountain: 0.2, fort_bonus: 0.15, livres: -0.1 }, [0.55, 0.5, 0.7, 'militaire'], 'recrues'),
  VE: P('République de Venise', 'Venise', 'vénitien', '#148f77', 'La Sérénissime', ['Négoce du Levant : accords commerciaux +25 %', "L'Arsenal : ports +15 %"], ['République vieillie : recrues −20 %', 'Infanterie −6 %'],
    { trade: 0.25, port: 0.15, recrues: -0.2, inf_power: -0.06 }, [0.2, 0.9, 0.3, 'civil'], 'livres'),
  GE: P('République de Gênes', 'Gênes', 'génois', '#d35400', 'La Superbe', ['Banque de Saint-Georges : livres +25 %', 'Ports +15 %'], ['Corse rebelle : recrues −20 %', 'Vivres −10 %'],
    { livres: 0.25, port: 0.15, recrues: -0.2, vivres: -0.1 }, [0.25, 0.9, 0.25, 'civil'], 'livres'),
  IT: P('Toscane et Milanais', 'Toscane-Mil.', 'toscan', '#af7ac5', 'Les Soyeux et les Banquiers', ['Soieries et banque : livres +20 %', 'Plaine du Pô : vivres +15 %'], ['États divisés : recrues −15 %', 'Infanterie −6 %'],
    { livres: 0.2, vivres: 0.15, recrues: -0.15, inf_power: -0.06 }, [0.3, 0.85, 0.4, 'civil'], 'livres'),
  PO: P('États pontificaux', 'États pont.', 'pontifical', '#f7e9a0', 'Le Patrimoine de saint Pierre', ['Prestige du Saint-Siège : diplomatie +15'], ['Soldats du pape : infanterie −10 %', 'Industrie −15 %'],
    { diplo: 15, inf_power: -0.1, industrie: -0.15 }, [0.15, 0.6, 0.2, 'civil'], 'vivres'),
  NA: P('Royaume de Naples et de Sicile', 'Naples', 'napolitain', '#5dade2', 'Les Deux-Siciles', ['Blé de Sicile et des Pouilles : vivres +25 %', 'Vins +15 %'], ['Industrie −20 %', 'Routes −5 %'],
    { vivres: 0.25, vin: 0.15, industrie: -0.2, road_speed: -0.05 }, [0.3, 0.6, 0.35, 'agricole'], 'vivres'),
  BA: P('Électorat de Bavière', 'Bavière', 'bavarois', '#2e86c1', 'La Maison de Wittelsbach', ['Riches campagnes : vivres +20 %', 'Recrues +10 %'], ['Commerce −10 %'],
    { vivres: 0.2, recrues: 0.1, trade: -0.1 }, [0.45, 0.55, 0.55, 'agricole'], 'vivres'),
  SX: P('Électorat de Saxe', 'Saxe', 'saxon', '#7dcea0', 'Les Mines et les Foires de Saxe', ["Mines de l'Erzgebirge : fer +30 %", 'Foires de Leipzig : accords commerciaux +15 %', 'Manufactures : industrie +10 %'], ['Petite armée : recrues −10 %'],
    { fer: 0.3, trade: 0.15, industrie: 0.1, recrues: -0.1 }, [0.35, 0.75, 0.4, 'industriel'], 'fer'),
  HA: P('Électorat de Hanovre', 'Hanovre', 'hanovrien', '#6c8ebf', 'Les Guelfes et les villes de la Hanse', ['Hambourg et Brême : ports +15 %', 'Mines du Harz : fer +15 %'], ['Sables et landes : vivres −10 %'],
    { port: 0.15, fer: 0.15, vivres: -0.1 }, [0.35, 0.75, 0.4, 'civil'], 'livres'),
  WU: P('Duché de Wurtemberg', 'Wurtemberg', 'wurtembergeois', '#8e44ad', 'Le Cercle de Souabe', ['Vignobles du Neckar et du Rhin : +20 % de revenus viticoles', 'Recrues +10 %'], ['Princes désunis : livres −10 %'],
    { vin: 0.2, recrues: 0.1, livres: -0.1 }, [0.35, 0.6, 0.4, 'agricole'], 'vivres'),
  WE: P('Cercles de Westphalie et du Rhin', 'Westphalie', 'westphalien', '#1d6b3a', 'Les Électeurs ecclésiastiques', ['Foires de Francfort : accords commerciaux +15 %', 'Troupes à louer : recrues +10 %'], ['Princes désunis : entretien des troupes +10 %'],
    { trade: 0.15, recrues: 0.1, upkeep: 0.1 }, [0.3, 0.7, 0.35, 'civil'], 'recrues'),
  PR: P('Royaume de Prusse', 'Prusse', 'prussien', '#34495e', "L'Armée qui possède un État", ['Discipline : infanterie +15 %', 'Système des cantons : recrues +15 %', 'Entretien des troupes −10 %'], ['Sables du Brandebourg : vivres −15 %', 'Livres −10 %'],
    { inf_power: 0.15, recrues: 0.15, upkeep: -0.1, vivres: -0.15, livres: -0.1 }, [0.8, 0.45, 0.85, 'militaire'], 'recrues'),
  AU: P('Monarchie de Habsbourg', 'Autriche', 'autrichien', '#e8e8e8', "La Maison d'Autriche", ['Hussards et Croates : cavalerie +12 %', 'Peuples nombreux : recrues +10 %'], ['Lourde administration : entretien des troupes +10 %', 'Routes −5 %'],
    { cav_power: 0.12, recrues: 0.1, upkeep: 0.1, road_speed: -0.05 }, [0.5, 0.6, 0.6, 'civil'], 'recrues'),
  PL: P('République des Deux Nations', 'Pologne', 'polonais', '#e74c8b', 'La République nobiliaire', ['Cavalerie nationale : cavalerie +15 %', 'Greniers de la Vistule : vivres +25 %'], ['Liberum veto : livres −15 %', 'Fortifications −15 %', 'Industrie −15 %'],
    { cav_power: 0.15, vivres: 0.25, livres: -0.15, fort_bonus: -0.15, industrie: -0.15 }, [0.3, 0.55, 0.3, 'agricole'], 'vivres'),
  CO: P('Duché de Courlande', 'Courlande', 'courlandais', '#1abc9c', 'Les Ducs de Mitau', ['Bois et mâts de la Baltique : bois +25 %', 'Ports +10 %'], ['Petit duché : recrues −20 %'],
    { bois: 0.25, port: 0.1, recrues: -0.2 }, [0.2, 0.75, 0.2, 'civil'], 'bois'),
  RU: P('Empire de Russie', 'Russie', 'russe', '#27632a', "L'Empire des tsars", ['Masses paysannes : recrues +25 %', 'Général Hiver : usure −20 %', 'Forêts : bois +20 %'], ['Immensité : routes −10 %', 'Industrie −10 %'],
    { recrues: 0.25, attrition: -0.2, bois: 0.2, road_speed: -0.1, industrie: -0.1 }, [0.7, 0.45, 0.9, 'militaire'], 'recrues'),
  SE: P('Royaume de Suède', 'Suède', 'suédois', '#f5b041', 'Les Carolins et le fer de Dalécarlie', ['Fer de Bergslagen : fer +35 %', 'Forêts : bois +25 %', 'Infanterie +8 %'], ['Pays peu peuplé : recrues −20 %', 'Vivres −15 %'],
    { fer: 0.35, bois: 0.25, inf_power: 0.08, recrues: -0.2, vivres: -0.15 }, [0.5, 0.6, 0.5, 'industriel'], 'fer'),
  DK: P('Royaume de Danemark et de Norvège', 'Danemark', 'danois', '#922b21', 'Les Gardiens du Sund', ['Péage du Sund : livres +15 %', 'Bois et mâts de Norvège : bois +30 %', 'Ports +10 %'], ['Recrues −15 %'],
    { livres: 0.15, bois: 0.3, port: 0.1, recrues: -0.15 }, [0.3, 0.8, 0.35, 'civil'], 'bois'),
  OT: P('Empire ottoman', 'Ottomans', 'ottoman', '#6b8e23', 'La Sublime Porte', ['Sipahis : cavalerie +12 %', 'Empire immense : recrues +20 %', 'Caravanes du Levant : accords commerciaux +10 %'], ['Artillerie vieillie : −10 %', 'Industrie −20 %', 'Savoirs lents à venir : recherche −15 %'],
    { cav_power: 0.12, recrues: 0.2, trade: 0.1, art_power: -0.1, industrie: -0.2, research_speed: -0.15 }, [0.6, 0.55, 0.6, 'militaire'], 'recrues'),
  CR: P('Khanat de Crimée', 'Crimée', 'tatar', '#c39bd3', 'La Horde des Giray', ['Cavaliers tatars : cavalerie +15 %', 'Razzias : embuscades +30 %', 'Gens de la steppe : usure −20 %'], ['Ni canons ni remparts : artillerie −15 %, fortifications −15 %', 'Industrie −30 %'],
    { cav_power: 0.15, ambush: 0.3, attrition: -0.2, art_power: -0.15, fort_bonus: -0.15, industrie: -0.3 }, [0.8, 0.35, 0.5, 'militaire'], 'recrues'),
  MA: P('Empire chérifien', 'Maroc', 'marocain', '#a04000', 'Le Makhzen des sultans alaouites', ['Cavaliers des tribus : cavalerie +15 %', "Gens de l'Atlas : montagne +20 %", 'Embuscades +20 %'], ['Industrie −25 %', 'Commerce −15 %'],
    { cav_power: 0.15, mountain: 0.2, ambush: 0.2, industrie: -0.25, trade: -0.15 }, [0.5, 0.4, 0.4, 'militaire'], 'recrues'),
  AL: P("Régence d'Alger", 'Alger', 'algérois', '#45b39d', "Les Corsaires d'Alger", ['Course : ports +25 %', 'Janissaires : infanterie +8 %', 'Embuscades +15 %'], ['Industrie −25 %', 'Nid de pirates : diplomatie −10'],
    { port: 0.25, inf_power: 0.08, ambush: 0.15, industrie: -0.25, diplo: -10 }, [0.7, 0.5, 0.4, 'militaire'], 'livres'),
  TU: P('Régence de Tunis', 'Tunis', 'tunisien', '#f1948a', 'Le Beylik de Tunis', ['Huile, blé et chéchias : accords commerciaux +15 %', 'Vivres +15 %', 'Ports +10 %'], ['Industrie −20 %', 'Recrues −15 %'],
    { trade: 0.15, vivres: 0.15, port: 0.1, industrie: -0.2, recrues: -0.15 }, [0.35, 0.75, 0.3, 'civil'], 'vivres'),
  TR: P('Régence de Tripoli', 'Tripoli', 'tripolitain', '#5b2c6f', 'Les Corsaires de Barbarie', ['Course : ports +20 %', 'Caravanes du Sahara : accords commerciaux +15 %', 'Gens du désert : usure −20 %'], ['Vivres −25 %', 'Industrie −25 %', 'Recrues −15 %'],
    { port: 0.2, trade: 0.15, attrition: -0.2, vivres: -0.25, industrie: -0.25, recrues: -0.15 }, [0.55, 0.6, 0.3, 'militaire'], 'livres'),
  ML: P('Ordre de Saint-Jean de Jérusalem', 'Malte', 'maltais', '#111111', 'Les Chevaliers de Malte', ['Bastions de La Valette : fortifications +25 %', 'Galères de la Religion : ports +20 %', 'Chevaliers : infanterie +10 %'], ['Une île : recrues −30 %', 'Vivres −20 %'],
    { fort_bonus: 0.25, port: 0.2, inf_power: 0.1, recrues: -0.3, vivres: -0.2 }, [0.4, 0.6, 0.1, 'militaire'], 'livres'),
};
const NOM_PAYS = Object.fromEntries(Object.entries(PAYS).map(([c, p]) => [c, p.name]));

// ------------------------------------------------------------------ outils de géométrie
function topo(f, objet) {
  const t = lire(f), tr = t.transform;
  const arcs = t.arcs.map(a => { let x = 0, y = 0; return a.map(p => tr ? [(x += p[0]) * tr.scale[0] + tr.translate[0], (y += p[1]) * tr.scale[1] + tr.translate[1]] : p); });
  const ring = ids => { const r = []; for (const i of ids) { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; r.push(...(r.length ? a.slice(1) : a)); } return r; };
  const o = objet ? t.objects[objet] : Object.values(t.objects)[0];
  return o.geometries.filter(g => g.arcs).map(g => ({ p: g.properties, polys: (g.type === 'Polygon' ? [g.arcs] : g.arcs).map(pl => pl.map(ring)) }));
}
// Remplit un polygone (anneaux [lon, lat], règle pair-impair : les trous comptent) sur une grille gw × gh ; cb(maille).
// Le même balayage que raster_ring de geo.rs : une maille est prise si son centre est dans le polygone.
function remplir(rings, fx, fy, gw, gh, cb) {
  const rows = new Map();
  for (const ring of rings) {
    for (let k = 0, n = ring.length; k < n; k++) {
      const a = ring[k], b = ring[(k + 1) % n];
      const x1 = fx(a[0]), y1 = fy(a[1]), x2 = fx(b[0]), y2 = fy(b[1]);
      if (y1 === y2) continue;
      const j0 = Math.max(0, Math.ceil(Math.min(y1, y2) - 0.5)), j1 = Math.min(gh - 1, Math.floor(Math.max(y1, y2) - 0.5));
      for (let j = j0; j <= j1; j++) {
        const yc = j + 0.5;
        if ((y1 <= yc) !== (y2 <= yc)) { let r = rows.get(j); if (!r) rows.set(j, r = []); r.push(x1 + (yc - y1) * (x2 - x1) / (y2 - y1)); }
      }
    }
  }
  for (const [j, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] - 0.5)), i1 = Math.min(gw - 1, Math.floor(xs[k + 1] - 0.5));
      for (let i = i0; i <= i1; i++) cb(j * gw + i);
    }
  }
}
// Douglas-Peucker (sans récursion profonde)
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const garde = new Uint8Array(pts.length); garde[0] = garde[pts.length - 1] = 1;
  const pile = [[0, pts.length - 1]];
  while (pile.length) {
    const [a, b] = pile.pop();
    const [ax, ay] = pts[a], ux = pts[b][0] - ax, uy = pts[b][1] - ay, n = Math.hypot(ux, uy);
    let m = -1, im = -1;
    for (let i = a + 1; i < b; i++) {
      const d = n ? Math.abs(ux * (pts[i][1] - ay) - uy * (pts[i][0] - ax)) / n : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > m) { m = d; im = i; }
    }
    if (m > eps) { garde[im] = 1; pile.push([a, im], [im, b]); }
  }
  return pts.filter((_, i) => garde[i]);
}
const aire2 = r => { let s = 0; for (let k = 0, n = r.length; k < n; k++) { const a = r[k], b = r[(k + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return s; };
const voisins4 = (c, f) => { const i = c % GW; if (i > 0) f(c - 1); if (i < GW - 1) f(c + 1); if (c >= GW) f(c - GW); if (c < N - GW) f(c + GW); };
const arr3 = v => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------------ 1. la grille des pays
const NOMS = ['']; // étiquette → code de pays ou « ~terre hors jeu » ; 0 : la mer
const etiq = code => { let k = NOMS.indexOf(code); if (k < 0) { k = NOMS.length; NOMS.push(code); } return k; };
const L = new Uint8Array(N);
{
  const pays = topo(path.join(NM, 'world-atlas', 'countries-10m.json'), 'countries');
  const C = new Uint8Array(N), noms = [''];
  for (const g of pays) {
    const polys = g.polys.filter(pl => pl[0].some(p => p[0] > LON0 - 1 && p[0] < LON1 + 1 && p[1] > LAT0 - 1 && p[1] < LAT1 + 1));
    if (!polys.length) continue;
    noms.push(g.p.name);
    for (const pl of polys) remplir(pl, gx, gy, GW, GH, c => { C[c] = noms.length - 1; });
  }
  const vus = new Set(C);
  for (const k of vus) if (k && !ENTIERS[noms[k]] && !COUPES[noms[k]]) stop(`pays Natural Earth sans règle : ${noms[k]}`);
  for (let c = 0; c < N; c++) if (C[c] && ENTIERS[noms[C[c]]]) L[c] = etiq(ENTIERS[noms[C[c]]]);
  for (const [nom, regle] of Object.entries(COUPES)) {
    const k = noms.indexOf(nom);
    if (k < 0) stop(`pays à couper absent de Natural Earth : ${nom}`);
    const R = new Uint16Array(N), regs = [''];
    if (regle.carte) {
      const vues = new Set();
      for (const g of topo(path.join(NM, '@highcharts', 'map-collection', 'countries', regle.carte + '.topo.json'))) {
        regs.push(g.p.name); vues.add(g.p.name);
        for (const pl of g.polys) remplir(pl, gx, gy, GW, GH, c => { R[c] = regs.length - 1; });
      }
      for (const r of Object.keys(regle.regions)) if (!vues.has(r)) stop(`région inconnue de la carte ${regle.carte} : ${r}`);
      // les mailles du pays hors de toute région (les deux sources ne se recouvrent pas au km près) : la région la plus proche
      const file = []; for (let c = 0; c < N; c++) if (R[c]) file.push(c);
      for (let q = 0; q < file.length; q++) voisins4(file[q], v => { if (!R[v]) { R[v] = R[file[q]]; file.push(v); } });
    }
    for (let c = 0; c < N; c++) {
      if (C[c] !== k) continue;
      const lon = lonDe(c % GW + 0.5), lat = latDe(Math.floor(c / GW) + 0.5), r = regs[R[c]];
      L[c] = etiq((regle.retouche && regle.retouche(lon, lat, r)) || (regle.regions && regle.regions[r]) || regle.defaut);
    }
  }
}
// détroits rouverts
for (const [, pts] of DETROITS) {
  const ray = 3.75 / KM * F;
  for (let k = 0; k + 1 < pts.length; k++) {
    const x1 = gx(pts[k][0]), y1 = gy(pts[k][1]), x2 = gx(pts[k + 1][0]), y2 = gy(pts[k + 1][1]), n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
    for (let s = 0; s <= n; s++) {
      const x = x1 + (x2 - x1) * s / n, y = y1 + (y2 - y1) * s / n;
      for (let j = Math.floor(y - ray); j <= Math.ceil(y + ray); j++) for (let i = Math.floor(x - ray); i <= Math.ceil(x + ray); i++)
        if (i >= 0 && i < GW && j >= 0 && j < GH && Math.hypot(i + 0.5 - x, j + 0.5 - y) <= ray) L[j * GW + i] = 0;
    }
  }
}
// ménage : composantes connexes de chaque étiquette. Une enclave sans côte, un liseré de quelques mailles collé à un
// voisin : au voisin ; un îlot de moins de 5 mailles (14 km²) : à la mer. Une poche de mer fermée : un lac (« waters »).
const POCHE = 255; NOMS[POCHE] = '~poche';
const poches = []; // [centre lon, lat, mailles]
{
  const vu = new Uint8Array(N);
  // la mer ouverte : celle qui touche le bord du cadre
  const file = [];
  for (let c = 0; c < N; c++) { const i = c % GW, j = (c - i) / GW; if (!L[c] && (i === 0 || j === 0 || i === GW - 1 || j === GH - 1)) { vu[c] = 1; file.push(c); } }
  for (let q = 0; q < file.length; q++) voisins4(file[q], v => { if (!L[v] && !vu[v]) { vu[v] = 1; file.push(v); } });
  for (let c0 = 0; c0 < N; c0++) {
    if (vu[c0]) continue;
    const e = L[c0], comp = [c0], bord = new Map(); vu[c0] = 1;
    for (let q = 0; q < comp.length; q++) voisins4(comp[q], v => { if (L[v] === e) { if (!vu[v]) { vu[v] = 1; comp.push(v); } } else bord.set(L[v], (bord.get(L[v]) || 0) + 1); });
    let vers = e;
    if (e === 0) {
      if (comp.length >= 9) { vers = POCHE; let sx = 0, sy = 0; for (const c of comp) { sx += c % GW; sy += Math.floor(c / GW); } poches.push([arr3(lonDe(sx / comp.length)), arr3(latDe(sy / comp.length)), comp.length]); }
      else vers = [...bord].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    } else {
      const terres = [...bord].filter(b => b[0] !== 0 && b[0] !== POCHE).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      if (!bord.has(0) && terres.length && comp.length < 600) vers = terres[0][0];
      else if (terres.length && comp.length < 6) vers = terres[0][0];
      else if (!terres.length && comp.length < 5) vers = 0;
    }
    if (vers !== e) for (const c of comp) L[c] = vers;
  }
}

// ------------------------------------------------------------------ 2. des mailles aux contours
// Les arêtes entre deux étiquettes différentes forment des arcs (d'un nœud, où trois frontières se rejoignent, au
// suivant) ; chaque arc est simplifié une seule fois et sert aux deux voisins.
const EPS = 1.1; // tolérance de simplification, en mailles (1,8 km)
const contours = new Map(); // étiquette → anneaux [[lon, lat], …] (extérieurs seulement)
{
  const VW = GW + 1, lab = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH) ? 0 : L[j * GW + i];
  const aH = (i, j) => i >= 0 && i < GW && j >= 0 && j <= GH && lab(i, j - 1) !== lab(i, j); // arête du sommet (i, j) vers (i+1, j)
  const aV = (i, j) => i >= 0 && i <= GW && j >= 0 && j < GH && lab(i - 1, j) !== lab(i, j); // … vers (i, j+1)
  const DIR = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const arete = (i, j, d) => d === 0 ? aH(i, j) : d === 1 ? aV(i, j) : d === 2 ? aH(i - 1, j) : aV(i, j - 1);
  const degre = (i, j) => arete(i, j, 0) + arete(i, j, 1) + arete(i, j, 2) + arete(i, j, 3);
  const faite = new Uint8Array(VW * (GH + 1)); // bit 0 : arête horizontale partie du sommet, bit 1 : verticale
  const marque = (i, j, d) => { if (d === 0) faite[j * VW + i] |= 1; else if (d === 1) faite[j * VW + i] |= 2; else if (d === 2) faite[j * VW + i - 1] |= 1; else faite[(j - 1) * VW + i] |= 2; };
  const estFaite = (i, j, d) => d === 0 ? faite[j * VW + i] & 1 : d === 1 ? faite[j * VW + i] & 2 : d === 2 ? faite[j * VW + i - 1] & 1 : faite[(j - 1) * VW + i] & 2;
  const cotes = (i, j, d) => d === 0 ? [lab(i, j - 1), lab(i, j)] : d === 1 ? [lab(i, j), lab(i - 1, j)] : d === 2 ? [lab(i - 1, j), lab(i - 1, j - 1)] : [lab(i - 1, j - 1), lab(i, j - 1)]; // [gauche, droite]
  const arcs = [];
  const suivre = (i0, j0, d0) => {
    const pts = [[i0, j0]], [g, dr] = cotes(i0, j0, d0);
    let i = i0, j = j0, d = d0;
    for (;;) {
      marque(i, j, d); i += DIR[d][0]; j += DIR[d][1]; pts.push([i, j]);
      if ((i === i0 && j === j0) || degre(i, j) !== 2) break;
      d = [0, 1, 2, 3].find(k => k !== (d + 2) % 4 && arete(i, j, k));
    }
    arcs.push({ pts, g, d: dr });
  };
  for (let j = 0; j <= GH; j++) for (let i = 0; i <= GW; i++) { const n = degre(i, j); if (n && n !== 2) for (let d = 0; d < 4; d++) if (arete(i, j, d) && !estFaite(i, j, d)) suivre(i, j, d); }
  for (let j = 0; j <= GH; j++) for (let i = 0; i <= GW; i++) for (let d = 0; d < 2; d++) if (arete(i, j, d) && !estFaite(i, j, d)) suivre(i, j, d); // boucles sans nœud
  for (const a of arcs) {
    const p = a.pts;
    if (p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) { // boucle : coupée au point le plus loin du départ
      let m = 0, im = 0; for (let k = 1; k < p.length - 1; k++) { const d = Math.hypot(p[k][0] - p[0][0], p[k][1] - p[0][1]); if (d > m) { m = d; im = k; } }
      a.simple = [...rdp(p.slice(0, im + 1), EPS).slice(0, -1), ...rdp(p.slice(im), EPS)];
    } else a.simple = rdp(p, EPS);
  }
  // les anneaux de chaque étiquette : ses arcs mis bout à bout, l'étiquette toujours à gauche
  const cle = p => p[1] * VW + p[0];
  for (let e = 1; e < NOMS.length; e++) {
    if (!NOMS[e]) continue;
    const parts = new Map(); // sommet de départ → parcours
    for (const a of arcs) {
      const t = a.g === e ? { pts: a.simple, brut: a.pts } : a.d === e ? { pts: a.simple.slice().reverse(), brut: a.pts.slice().reverse() } : null;
      if (!t) continue;
      const k = cle(t.brut[0]); if (!parts.has(k)) parts.set(k, []); parts.get(k).push(t);
    }
    const rings = [];
    for (const liste of parts.values()) {
      while (liste.length) {
        let t = liste.pop(); const ring = [], brut = [], k0 = cle(t.brut[0]);
        for (;;) {
          ring.push(...t.pts.slice(0, -1)); brut.push(...t.brut.slice(0, -1));
          const k = cle(t.brut[t.brut.length - 1]);
          if (k === k0) break;
          const suite = parts.get(k);
          if (!suite || !suite.length) stop(`contour ouvert pour ${NOMS[e]}`);
          t = suite.pop();
        }
        // sens : étiquette à gauche et y vers le bas, un anneau extérieur a une aire signée négative ; les trous (lacs
        // fermés, déjà rendus à part) sont laissés : geo.rs remplit chaque anneau
        if (aire2(brut) < 0 && ring.length >= 3 && Math.abs(aire2(ring)) >= 6) rings.push(ring.map(p => [arr3(lonDe(p[0])), arr3(latDe(p[1]))]));
      }
    }
    rings.sort((a, b) => Math.abs(aire2(b)) - Math.abs(aire2(a)) || a[0][0] - b[0][0] || a[0][1] - b[0][1]);
    contours.set(e, rings);
  }
}
const CODES = NOMS.filter(c => c && c[0] !== '~').sort();
console.log(`grille ${W} × ${H} cases de ${KM} km ; ${CODES.length} pays : ${CODES.join(' ')}`);
if (poches.length) console.log('poches de mer fermées, rendues comme des lacs : ' + poches.map(p => `${p[0]},${p[1]} (${p[2]})`).join(' ; '));

// ------------------------------------------------------------------ 3. lacs
const waters = [];
{
  const NOM_LAC = { IJsselmeer: 'Zuiderzee', Pihkva: 'Lac de Pskov', Syvach: 'Sivach', 'Lake Milh': 'Lac Milh', 'Côme': 'Lac de Côme', Garde: 'Lac de Garde', Constance: 'Lac de Constance',
    'Neuchâtel': 'Lac de Neuchâtel', Zurich: 'Lac de Zurich', 'Tibériade': 'Lac de Tibériade', Van: 'Lac de Van' };
  const vus = [];
  for (const f of ['ne_10m_lakes.geojson', 'ne_10m_lakes_europe.geojson']) {
    for (const x of lireNE(f)) {
      const p = x.properties;
      if (p.featurecla === 'Reservoir' && !/Il.?men/.test((p.name_fr || '') + (p.name || ''))) continue; // retenues du XXe siècle
      for (const pl of x.geometry.type === 'Polygon' ? [x.geometry.coordinates] : x.geometry.coordinates) {
        if (!pl[0].some(dansCadre)) continue;
        const r = pl[0].map(q => [Math.min(LON1, Math.max(LON0, q[0])), Math.min(LAT1, Math.max(LAT0, q[1]))]); // (l'Onega dépasse du cadre)
        const a = Math.abs(aire2(r.map(q => [q[0] * KX, q[1] * KY]))) / 2;
        if (a < LAC_MIN_KM2) continue;
        const c = [r.reduce((s, q) => s + q[0], 0) / r.length, r.reduce((s, q) => s + q[1], 0) / r.length];
        if (vus.some(v => km(v, c) < 10)) continue; // le même lac dans les deux fichiers
        vus.push(c);
        let nom = p.name_fr || p.name || 'Lac'; // noms français de Natural Earth
        nom = NOM_LAC[nom] || (/^(Lac|Lagune|Loch|Lough|mer|étang)/.test(nom) ? nom : 'Lac ' + nom);
        const ring = rdp(r.map(q => [gx(q[0]), gy(q[1])]), 0.5).map(q => [arr3(lonDe(q[0])), arr3(latDe(q[1]))]);
        waters.push({ name: nom, ring, _a: a });
      }
    }
  }
  waters.sort((a, b) => b._a - a._a || a.ring[0][0] - b.ring[0][0]);
  for (const w of waters) delete w._a;
  for (const ring of contours.get(POCHE) || []) waters.push({ name: 'Bras de mer', ring });
}

// ------------------------------------------------------------------ 4. fleuves
const rivers = [];
{
  // le réseau de Natural Earth : un nœud par point, les bouts de ligne raccordés au point voisin d'une autre ligne (3 km)
  const X = [], Y = [], adj = [], ligneDe = [], noms = [], idx = new Map();
  const noeud = (p, l) => { const k = Math.round(p[0] * 1e4) + ':' + Math.round(p[1] * 1e4); let n = idx.get(k); if (n === undefined) { n = X.length; idx.set(k, n); X.push(p[0]); Y.push(p[1]); adj.push([]); ligneDe.push(l); } return n; };
  const lien = (a, b) => { if (a === b) return; const d = km([X[a], Y[a]], [X[b], Y[b]]); adj[a].push([b, d]); adj[b].push([a, d]); };
  const bouts = [];
  let nl = 0;
  for (const f of ['ne_10m_rivers_lake_centerlines.geojson', 'ne_10m_rivers_europe.geojson']) {
    for (const x of lireNE(f)) {
      for (const l of x.geometry.type === 'LineString' ? [x.geometry.coordinates] : x.geometry.coordinates) {
        if (!l.some(p => p[0] > LON0 - 3 && p[0] < LON1 + 3 && p[1] > LAT0 - 3 && p[1] < LAT1 + 3)) continue;
        if (/Canal|Csatorna|Kanal/i.test(x.properties.name || '')) continue; // les canaux raccourciraient les fleuves
        noms.push(x.properties.name || '?');
        const ns = l.map(p => noeud(p, nl));
        for (let k = 0; k + 1 < ns.length; k++) lien(ns[k], ns[k + 1]);
        bouts.push([ns[0], nl], [ns[ns.length - 1], nl]);
        nl++;
      }
    }
  }
  const casier = new Map(), cas = (x, y) => Math.floor(x / 0.05) + ':' + Math.floor(y / 0.05);
  for (let n = 0; n < X.length; n++) { const k = cas(X[n], Y[n]); if (!casier.has(k)) casier.set(k, []); casier.get(k).push(n); }
  for (const [b, l] of bouts) {
    let m = LIEN_KM, im = -1;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const n of casier.get(cas(X[b] + dx * 0.05, Y[b] + dy * 0.05)) || []) {
      if (ligneDe[n] === l || n === b) continue;
      const d = km([X[b], Y[b]], [X[n], Y[n]]); if (d < m) { m = d; im = n; }
    }
    if (im >= 0) lien(b, im);
  }
  const proche = (p, re) => { let m = 1e9, im = -1; for (let n = 0; n < X.length; n++) { if (re && !re.test(noms[ligneDe[n]])) continue; const d = km(p, [X[n], Y[n]]); if (d < m) { m = d; im = n; } } return [im, m]; };
  const chemin = (a, b) => { // Dijkstra, tas binaire
    const dist = new Float64Array(X.length).fill(Infinity), prec = new Int32Array(X.length).fill(-1), tas = [[0, a]]; dist[a] = 0;
    const monte = i => { while (i > 0) { const p = (i - 1) >> 1; if (tas[p][0] <= tas[i][0]) break; [tas[p], tas[i]] = [tas[i], tas[p]]; i = p; } };
    const descend = i => { for (;;) { let m = i; const g = 2 * i + 1, d = g + 1; if (g < tas.length && tas[g][0] < tas[m][0]) m = g; if (d < tas.length && tas[d][0] < tas[m][0]) m = d; if (m === i) break; [tas[m], tas[i]] = [tas[i], tas[m]]; i = m; } };
    while (tas.length) {
      const [d, n] = tas[0]; const fin = tas.pop(); if (tas.length) { tas[0] = fin; descend(0); }
      if (d > dist[n]) continue;
      if (n === b) break;
      for (const [v, w] of adj[n]) if (d + w < dist[v]) { dist[v] = d + w; prec[v] = n; tas.push([d + w, v]); monte(tas.length - 1); }
    }
    if (dist[b] === Infinity) return null;
    const out = []; for (let n = b; n >= 0; n = prec[n]) out.push(n);
    return out.reverse();
  };
  const journal = [];
  for (const [nom, rang, a, b, re] of FLEUVES) {
    let pts, note = 'points écrits à la main';
    if (b) {
      const [na, da] = proche(a, re), [nb, db] = proche(b, re);
      if (da > 30 || db > 30) stop(`fleuve ${nom} : pas de tracé Natural Earth à moins de 30 km de la source (${da.toFixed(0)} km) ou de l'embouchure (${db.toFixed(0)} km)`);
      const ch = chemin(na, nb);
      if (!ch) stop(`fleuve ${nom} : la source et l'embouchure ne sont pas reliées dans Natural Earth`);
      pts = ch.map(n => [X[n], Y[n]]);
      note = [...new Set(ch.map(n => noms[ligneDe[n]]))].join('/');
    } else pts = a;
    // la partie dans le cadre (la plus longue), simplifiée à 1 km
    let best = [], cur = [];
    for (const p of [...pts, null]) { if (p && dansCadre(p)) cur.push(p); else { if (cur.length > best.length) best = cur; cur = []; } }
    if (best.length < 2) stop(`fleuve ${nom} : hors du cadre`);
    const coupe = best.length < pts.length;
    pts = rdp(best.map(p => [gx(p[0]), gy(p[1])]), 0.6).map(p => [arr3(lonDe(p[0])), arr3(latDe(p[1]))]);
    rivers.push({ name: nom, rank: rang, pts, _coupe: coupe });
    let long = 0; for (let k = 0; k + 1 < pts.length; k++) long += km(pts[k], pts[k + 1]);
    journal.push(`${nom} ${Math.round(long)} km [${note}]`);
  }
  // l'embouchure : à la mer (prolongée jusqu'à la première maille d'eau, 40 km au plus), à un confluent ou au bord du cadre
  const eau = (x, y) => { const i = Math.floor(x), j = Math.floor(y); return i < 0 || j < 0 || i >= GW || j >= GH || L[j * GW + i] === 0 || L[j * GW + i] === POCHE; };
  const dSeg = (p, a, b) => { const ux = (b[0] - a[0]) * KX, uy = (b[1] - a[1]) * KY, px = (p[0] - a[0]) * KX, py = (p[1] - a[1]) * KY, n = ux * ux + uy * uy, t = n ? Math.max(0, Math.min(1, (px * ux + py * uy) / n)) : 0; return Math.hypot(px - t * ux, py - t * uy); };
  const defauts = [];
  for (const r of rivers) {
    const fin = r.pts[r.pts.length - 1], x = gx(fin[0]), y = gy(fin[1]);
    let ok = eau(x, y) || r._coupe && (fin[0] > LON1 - 0.3 || fin[1] < LAT0 + 0.3);
    if (!ok) for (const o of rivers) { if (o !== r) for (let k = 0; k + 1 < o.pts.length && !ok; k++) ok = dSeg(fin, o.pts[k], o.pts[k + 1]) < 8; }
    if (!ok) for (const lac of waters) { if (lac.ring.some(q => km(q, fin) < 8)) { ok = true; break; } }
    if (!ok) {
      let m = 24, cible = null;
      for (let j = Math.floor(y) - 24; j <= y + 24; j++) for (let i = Math.floor(x) - 24; i <= x + 24; i++) { const d = Math.hypot(i + 0.5 - x, j + 0.5 - y); if (d < m && eau(i, j)) { m = d; cible = [arr3(lonDe(i + 0.5)), arr3(latDe(j + 0.5))]; } }
      if (!cible) { defauts.push(`fleuve ${r.name} : il finit à ${fin} sans mer, lac ni confluent à moins de 40 km`); continue; }
      r.pts.push(cible);
    }
    // un fleuve ne traverse pas la mer : au plus quelques points d'estuaire
    const enMer = r.pts.slice(0, -1).filter(p => { const c = Math.floor(gy(p[1])) * GW + Math.floor(gx(p[0])); return L[c] === 0; }).length;
    if (enMer > 4 && enMer > r.pts.length * 0.1) defauts.push(`fleuve ${r.name} : ${enMer} points sur ${r.pts.length} en pleine mer`);
    if (!r.pts.every(dansCadre)) stop(`fleuve ${r.name} : hors du cadre`);
    delete r._coupe;
  }
  if (defauts.length) stop(defauts.join('\n         '));
  console.log(`${rivers.length} fleuves : ` + journal.join(' ; '));
}

// ------------------------------------------------------------------ 5. le fichier de la carte, et le calcul du moteur refait
for (const c of CODES) if (!NOM_PAYS[c]) stop(`pays sans nom : ${c}`);
for (const c of Object.keys(NOM_PAYS)) if (!CODES.includes(c)) stop(`pays sans territoire : ${c}`);
const geo = { bounds: { lon0: LON0, lon1: LON1, lat0: LAT0, lat1: LAT1 }, lat_ref: LAT_REF, km_case: KM, depts: {}, rivers, waters, lands: [] };
for (const c of CODES) geo.depts[c] = { name: NOM_PAYS[c], playable: true, rings: contours.get(NOMS.indexOf(c)) };
for (let e = 1; e < NOMS.length; e++) if (NOMS[e] && NOMS[e][0] === '~' && e !== POCHE) for (const ring of contours.get(e)) geo.lands.push({ name: NOMS[e].slice(1), ring });

// geo.rs, _generate, à 5 km : pays (dans l'ordre des codes), trous bouchés, lacs, terres hors jeu
const fx = lon => (lon - LON0) * KX / KM, fy = lat => (LAT1 - lat) * KY / KM, NC = W * H;
const dept = new Uint8Array(NC), eauC = new Uint8Array(NC), hors = new Uint8Array(NC);
CODES.forEach((c, k) => { for (const ring of geo.depts[c].rings) remplir([ring], fx, fy, W, H, m => { dept[m] = k + 1; }); });
let bouchees = 0;
{
  const v4 = (c, f) => { const i = c % W; if (i < W - 1) f(c + 1); if (i > 0) f(c - 1); if (c < NC - W) f(c + W); if (c >= W) f(c - W); };
  const dehors = new Uint8Array(NC), file = [];
  for (let c = 0; c < NC; c++) { const i = c % W, j = (c - i) / W; if (!dept[c] && (i === 0 || i === W - 1 || j === 0 || j === H - 1)) { dehors[c] = 1; file.push(c); } }
  for (let q = 0; q < file.length; q++) v4(file[q], v => { if (!dehors[v] && !dept[v]) { dehors[v] = 1; file.push(v); } });
  for (let t = 0; t < 4; t++) for (let c = 0; c < NC; c++) if (!dept[c] && !dehors[c]) { let pris = 0; v4(c, v => { if (!pris && dept[v]) pris = dept[v]; }); if (pris) { dept[c] = pris; bouchees++; } }
}
for (const w of waters) remplir([w.ring], fx, fy, W, H, m => { eauC[m] = 1; });
for (const l of geo.lands) remplir([l.ring], fx, fy, W, H, m => { hors[m] = 1; });
// 0 mer, 1 lac, 2 terre hors jeu, 3 + k : pays k
const caseDe = new Uint8Array(NC);
for (let c = 0; c < NC; c++) caseDe[c] = eauC[c] ? 1 : dept[c] ? 2 + dept[c] : hors[c] ? 2 : 0;
const aires = Object.fromEntries(CODES.map(c => [c, 0]));
let ecarts = 0, terres = 0;
for (let c = 0; c < NC; c++) {
  if (caseDe[c] > 2) aires[CODES[caseDe[c] - 3]]++;
  const ref = L[(Math.floor(c / W) * F + 1) * GW + (c % W) * F + 1], attendu = !ref || ref === POCHE ? 0 : NOMS[ref][0] === '~' ? 2 : 3 + CODES.indexOf(NOMS[ref]);
  if (attendu) terres++;
  if (!eauC[c] && attendu !== caseDe[c]) ecarts++;
}
console.log(`calcul du moteur refait : ${ecarts} cases sur ${terres} de terre diffèrent de la grille de départ (${(100 * ecarts / terres).toFixed(2)} %), ${bouchees} cases de trou bouchées`);
if (ecarts > terres * 0.02) stop('les contours simplifiés s\'écartent de plus de 2 % de la grille de départ');
const codeCase = (lon, lat) => { const i = Math.floor(fx(lon)), j = Math.floor(fy(lat)); if (i < 0 || j < 0 || i >= W || j >= H) return null; const v = caseDe[j * W + i]; return v > 2 ? CODES[v - 3] : v === 2 ? '~' : v === 1 ? 'lac' : 'mer'; };

// ------------------------------------------------------------------ 6. places
// [nom, lat, lon, pays, type, étiquettes, remparts, population de 1790], comme places_france.json
const ROLES = ['arsenal', 'commerce', 'peche'];
const ESPACE_KM = Number(process.env.ESPACE || 115); // un bourg GeoNames est ajouté quand aucune place du pays n'est plus près
const places = [];
const recap = {};
{
  const cites = createRequire(path.join(path.resolve(NM), '_.js'))('all-the-cities') // GeoNames (villes de plus de 1 000 habitants)
    .filter(c => dansCadre(c.loc.coordinates)).sort((a, b) => b.population - a.population || a.cityId - b.cityId);
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const parNom = new Map();
  for (const c of cites) { const k = norm(c.name); if (!parNom.has(k)) parNom.set(k, []); parNom.get(k).push(c); }
  // la case du pays la plus proche d'un point, à 3 cases (15 km) au plus : [distance en cases, lon, lat du centre]
  const versPays = (lon, lat, code) => {
    if (codeCase(lon, lat) === code) return [0, lon, lat];
    const x = fx(lon), y = fy(lat), i0 = Math.floor(x), j0 = Math.floor(y); let m = 3.01, out = null;
    for (let j = j0 - 3; j <= j0 + 3; j++) for (let i = i0 - 3; i <= i0 + 3; i++) {
      if (i < 0 || j < 0 || i >= W || j >= H || caseDe[j * W + i] !== 3 + CODES.indexOf(code)) continue;
      const d = Math.hypot(i + 0.5 - x, j + 0.5 - y); if (d < m) { m = d; out = [d, LON0 + (i + 0.5) * KM / KX, LAT1 - (j + 0.5) * KM / KY]; }
    }
    return out;
  };
  const presDe = (lon, lat, r, quoi) => { const i0 = Math.floor(fx(lon)), j0 = Math.floor(fy(lat)); for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) if (i < 0 || j < 0 || i >= W || j >= H ? quoi(0) : quoi(caseDe[j * W + i])) return true; return false; };
  const dRiv = p => { let m = 1e9; for (const r of rivers) for (const q of r.pts) m = Math.min(m, km(q, p)); return m; };
  const villes = lire(path.join(ICI, 'europe', 'villes.json'));
  const defauts = [], deplacees = [], portsLoin = [];
  for (const c of Object.keys(villes)) if (c !== '_note' && !CODES.includes(c)) stop(`villes.json : pays inconnu ${c}`);
  for (const code of CODES) {
    const liste = [];
    (villes[code] || []).forEach((ligne, rang) => {
      const [nom, geo, pop, spec, fort] = ligne.split('|').map(s => s.trim());
      let trouve = null;
      for (const alt of geo ? geo.split('/') : [nom]) {
        if (alt[0] === '@') { const [la, lo] = alt.slice(1).split(',').map(Number); const v = versPays(lo, la, code); if (v) trouve = v; }
        else for (const c of parNom.get(norm(alt)) || []) { const v = versPays(c.loc.coordinates[0], c.loc.coordinates[1], code); if (v && (!trouve || v[0] === 0 && trouve[0] > 0)) { trouve = v; if (v[0] === 0) break; } }
        if (trouve) break;
      }
      if (!trouve) {
        const ou = (geo || nom).split('/').flatMap(a => (parNom.get(norm(a)) || []).slice(0, 2).map(c => `${c.name} (${c.country}, ${codeCase(...c.loc.coordinates)})`));
        defauts.push(`${nom}|${code} introuvable dans GeoNames sous « ${geo || nom} »` + (ou.length ? ` ; homonymes ailleurs : ${ou.join(', ')}` : ''));
        return;
      }
      if (trouve[0] > 0) deplacees.push(`${nom}|${code} (${(trouve[0] * KM).toFixed(0)} km)`);
      const etiq = spec ? spec.split(/\s+/) : [];
      for (const e of etiq) if (e !== 'port' && !ROLES.includes(e)) stop(`villes.json : étiquette inconnue « ${e} » (${nom}|${code})`);
      if (etiq.some(e => ROLES.includes(e)) && !etiq.includes('port')) stop(`villes.json : ${nom}|${code} a un rôle de port sans l'étiquette port`);
      liste.push({ nom, lon: trouve[1], lat: trouve[2], pop: Math.round(Number(pop) * 1000), etiq, fort: Number(fort), rang });
    });
    if (!liste.length) { defauts.push(`${code} : aucune ville dans villes.json`); continue; }
    // types : la capitale, les 24 plus grandes et toute ville de 10 000 âmes sont des villes, le reste des bourgs
    const parPop = liste.slice(1).sort((a, b) => b.pop - a.pop || a.rang - b.rang);
    liste.forEach(v => { v.type = v.rang === 0 ? 'capitale' : parPop.indexOf(v) < 24 || v.pop >= 10000 ? 'ville' : 'village'; });
    for (const v of liste) {
      const cote = presDe(v.lon, v.lat, 1, t => t === 0);
      if (v.type !== 'village' && cote && !v.etiq.includes('port')) v.etiq.unshift('port'); // toute ville côtière est un port
      // (Glasgow sur la Clyde, Nikolaïev sur le liman du Boug : estuaires trop étroits pour la carte)
      if (v.etiq.includes('port') && !presDe(v.lon, v.lat, 5, t => t < 2) && dRiv([v.lon, v.lat]) > 12 && !['Glasgow|GB', 'Nikolaïev|CR'].includes(v.nom + '|' + code)) portsLoin.push(`${v.nom}|${code}`);
    }
    // bourgs de complément : les villes d'aujourd'hui les plus peuplées, là où aucune place du pays n'est à moins de ESPACE_KM
    const k = 3 + CODES.indexOf(code), noms = new Set(liste.map(v => norm(v.nom)));
    for (const c of cites) {
      const [lon, lat] = c.loc.coordinates, i = Math.floor(fx(lon)), j = Math.floor(fy(lat));
      if (i < 0 || j < 0 || i >= W || j >= H || caseDe[j * W + i] !== k || noms.has(norm(c.name)) || !norm(c.name)) continue;
      if (liste.some(v => km([v.lon, v.lat], [lon, lat]) < ESPACE_KM)) continue;
      noms.add(norm(c.name));
      const pop = Math.round((800 + 3200 * Math.min(1, Math.max(0, (Math.log10(Math.max(c.population, 1000)) - 3) / 3))) / 100) * 100; // 800 à 4 000 âmes
      liste.push({ nom: c.name, lon, lat, pop, etiq: [], fort: 0, type: 'village', bourg: true });
    }
    for (const v of liste) places.push([v.nom, Math.round(v.lat * 1e4) / 1e4, Math.round(v.lon * 1e4) / 1e4, code, v.type, v.etiq, v.fort, v.pop]);
    recap[code] = { villes: liste.filter(v => v.type !== 'village').length, ports: liste.filter(v => v.etiq.includes('port')).length,
      bourgs: liste.filter(v => v.type === 'village').length, pop25: [liste[0], ...parPop.slice(0, 24)].reduce((s, v) => s + v.pop, 0), loin: 0, max: 0 };
    PAYS[code].capital = liste[0].nom;
  }
  if (defauts.length) stop(defauts.join('\n         '));
  if (deplacees.length) console.log(`places ramenées dans leur pays (contour simplifié, île ou rivage) : ${deplacees.join(', ')}`);
  if (portsLoin.length) stop('ports à plus de 25 km de la mer, d\'un lac ou d\'un fleuve de la carte : ' + portsLoin.join(', '));

  // vérifications
  const vus = new Set(), slugs = new Set();
  for (const p of places) {
    const [nom, lat, lon, code, type, etiq, fort, pop] = p, cle = nom + '|' + code;
    if (vus.has(cle)) stop(`doublon ${cle}`); vus.add(cle);
    if (!dansCadre([lon, lat])) stop(`${cle} hors du cadre`);
    if (codeCase(lon, lat) !== code) stop(`${cle} n'est pas dans son pays (case : ${codeCase(lon, lat)})`);
    if (!Number.isInteger(pop) || pop <= 0) stop(`${cle} : population ${pop}`);
    if (!['capitale', 'ville', 'village'].includes(type) || !(fort >= 0 && fort <= 4) || !Number.isInteger(fort)) stop(`${cle} : type ou remparts`);
    if (type === 'village' && !etiq.length && (pop < 100 || pop > 9999)) stop(`${cle} : bourg de ${pop} âmes`);
  }
  for (const code of CODES) {
    if (places.filter(p => p[3] === code && p[4] === 'capitale').length !== 1) stop(`${code} : il faut une capitale et une seule`);
    if (places.filter(p => p[3] === code).length < 3) stop(`${code} : moins de 3 places`);
  }
  // aucun point habité d'un pays à plus de 150 km d'une de ses places (habité : une ville GeoNames du pays à moins de 30 km)
  const habite = new Uint8Array(NC);
  for (const c of cites) { const [lon, lat] = c.loc.coordinates, i0 = Math.floor(fx(lon)), j0 = Math.floor(fy(lat)); if (i0 < 0 || j0 < 0 || i0 >= W || j0 >= H) continue; const k = caseDe[j0 * W + i0]; if (k < 3) continue;
    for (let j = Math.max(0, j0 - 6); j <= Math.min(H - 1, j0 + 6); j++) for (let i = Math.max(0, i0 - 6); i <= Math.min(W - 1, i0 + 6); i++) if (caseDe[j * W + i] === k && Math.hypot(i - i0, j - j0) <= 6) habite[j * W + i] = 1; }
  const parPays = Object.fromEntries(CODES.map(c => [c, places.filter(p => p[3] === c).map(p => [fx(p[2]), fy(p[1])])]));
  for (let c = 0; c < NC; c++) {
    if (caseDe[c] < 3) continue;
    const code = CODES[caseDe[c] - 3], x = c % W + 0.5, y = Math.floor(c / W) + 0.5; let m = 1e9;
    for (const q of parPays[code]) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < m) m = d; }
    if (m * KM > 150) { recap[code].loin++; if (habite[c]) stop(`${code} : un point habité (${lonDe(x * F).toFixed(2)}, ${latDe(y * F).toFixed(2)}) est à ${(m * KM).toFixed(0)} km de toute place`); }
    if (habite[c] && m * KM > recap[code].max) recap[code].max = m * KM;
  }
}

// ------------------------------------------------------------------ 7. époques
const epoques = {};
{
  const ETIQ = ['paix', 'guerres', 'ville', 'bourg', 'declin', 'grande_ville', 'capitale_fr', 'industrie', 'mines', 'grand_port', 'port_neuf', 'arsenal', 'ville_neuve', 'hivernants', 'thermes', 'bains', 'forges', 'gare'];
  const src = lire(path.join(ICI, 'europe', 'epoques.json')), pop = new Map(places.map(p => [p[0] + '|' + p[3], p[7]]));
  for (const [cle, pts] of Object.entries(src)) {
    if (cle === '_note') continue;
    const p0 = pop.get(cle);
    if (!p0) stop(`epoques.json : ${cle} n'est pas une place`);
    if (pts.length < 4 || pts.length > 8 || pts[0][0] !== 1700 || pts[pts.length - 1][0] !== 1900) stop(`epoques.json : ${cle} : 4 à 8 points, de 1700 à 1900`);
    pts.forEach((p, k) => { if (k && p[0] <= pts[k - 1][0] || !(p[1] > 0) || !ETIQ.includes(p[2])) stop(`epoques.json : ${cle} : point ${JSON.stringify(p)}`); });
    const p1790 = pts.find(p => p[0] === 1790);
    if (!p1790 || Math.round(p1790[1] * 1000) !== p0) stop(`epoques.json : ${cle} : la population de 1790 doit être celle de villes.json (${p0 / 1000})`);
    epoques[cle] = pts.map(p => [p[0], p[0] === 1790 ? 1.0 : Math.round(p[1] * 1000 / p0 * 1000) / 1000, p[2]]);
  }
}

// ------------------------------------------------------------------ 8. pays
{
  const hex = c => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
  const voisins = new Set();
  for (let c = 0; c < NC; c++) for (const v of [c + 1, c + W]) if (v < NC && caseDe[c] > 2 && caseDe[v] > 2 && caseDe[c] !== caseDe[v]) voisins.add([caseDe[c], caseDe[v]].sort((a, b) => a - b).join(','));
  for (const [c, p] of Object.entries(PAYS)) {
    if (!/^#[0-9a-f]{6}$/.test(p.color)) stop(`${c} : couleur ${p.color}`);
    for (const k of Object.keys(p.mods)) if (!CLES_MODS.includes(k)) stop(`${c} : le moteur ne lit pas le mod « ${k} »`);
    if (!['livres', 'vivres', 'fer', 'bois', 'armes', 'outils', 'recrues'].includes(p.specialty) || !['civil', 'militaire', 'industriel', 'agricole'].includes(p.personality.tech)) stop(`${c} : spécialité ou penchant`);
    if (p.short.length > 12 || !places.some(q => q[3] === c && q[4] === 'capitale' && q[0] === p.capital)) stop(`${c} : nom court ou capitale`);
  }
  const proches = [];
  for (const v of voisins) { const [a, b] = v.split(',').map(k => CODES[k - 3]), [x, y] = [hex(PAYS[a].color), hex(PAYS[b].color)]; if (Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 70) proches.push(`couleurs trop proches entre voisins : ${a} ${PAYS[a].color} et ${b} ${PAYS[b].color}`); }
  if (proches.length) stop(proches.join('\n         '));
}

// ------------------------------------------------------------------ sorties
const ecrire = (f, o) => { fs.writeFileSync(path.join(DATA, f), o); JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); return `${f} ${(o.length / 1024).toFixed(0)} Ko`; };
const tailles = [
  ecrire('europe.json', JSON.stringify(geo) + '\n'),
  ecrire('places_europe.json', '[\n' + places.map(p => JSON.stringify(p)).join(',\n') + '\n]\n'),
  ecrire('pays_europe.json', '{\n' + CODES.map(c => JSON.stringify(c) + ': ' + JSON.stringify(PAYS[c])).join(',\n') + '\n}\n'),
  ecrire('epoques_europe.json', '{\n' + Object.entries(epoques).map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(',\n') + '\n}\n'),
];
if (APERCU) {
  const E = 2, X = lon => (fx(lon) * E).toFixed(1), Y = lat => (fy(lat) * E).toFixed(1), d = r => 'M' + r.map(p => X(p[0]) + ' ' + Y(p[1])).join('L') + 'Z';
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * E}" height="${H * E}" font-family="sans-serif"><rect width="100%" height="100%" fill="#cfe3f2"/>`;
  for (const l of geo.lands) s += `<path d="${d(l.ring)}" fill="#d9d6c8" stroke="#999" stroke-width=".5"/>`;
  for (const c of CODES) s += `<path d="${geo.depts[c].rings.map(d).join('')}" fill="${PAYS[c].color}" fill-opacity=".55" stroke="#333" stroke-width=".6"/>`;
  for (const w of waters) s += `<path d="${d(w.ring)}" fill="#8fbfe6" stroke="#4a86b8" stroke-width=".4"/>`;
  for (const r of rivers) s += `<path d="M${r.pts.map(p => X(p[0]) + ' ' + Y(p[1])).join('L')}" fill="none" stroke="#1d5fa8" stroke-width="${[0, 1.6, 1.1, 0.8][r.rank]}"/>`;
  for (const p of places) if (p[4] !== 'capitale') s += `<circle cx="${X(p[2])}" cy="${Y(p[1])}" r="${p[4] === 'village' ? 1.3 : 2.2}" fill="${p[5].includes('port') ? '#0b3d91' : p[4] === 'village' ? '#555' : '#b3261e'}"/>`
    + (process.env.NOMS ? `<text x="${+X(p[2]) + 3}" y="${+Y(p[1]) + 2}" font-size="5">${esc(p[0])}</text>` : '');
  for (const c of CODES) { const r = geo.depts[c].rings[0]; s += `<text x="${X(r.reduce((a, p) => a + p[0], 0) / r.length)}" y="${Y(r.reduce((a, p) => a + p[1], 0) / r.length)}" font-size="18" font-weight="bold" fill="#0007" text-anchor="middle">${c}</text>`; }
  for (const p of places) if (p[4] === 'capitale') s += `<circle cx="${X(p[2])}" cy="${Y(p[1])}" r="3.5" fill="#000" stroke="#fff"/><text x="${+X(p[2]) + 5}" y="${+Y(p[1]) + 4}" font-size="11" font-weight="bold" stroke="#fff" stroke-width="2.5" paint-order="stroke">${esc(p[0])}</text>`;
  fs.writeFileSync(APERCU, s + '</svg>\n');
  console.log('aperçu : ' + APERCU);
}
console.log(`\n${places.length} places, ${Object.keys(epoques).length} trajectoires d'époque, ${rivers.length} fleuves, ${waters.length} lacs, ${geo.lands.length} terres hors jeu`);
console.log('pays  villes  ports  bourgs  pop. des 25  aire (cases)  cases à > 150 km (désert)  place la plus loin d\'un lieu habité');
for (const c of CODES) { const r = recap[c]; console.log(`${c}  ${String(r.villes).padStart(6)} ${String(r.ports).padStart(6)} ${String(r.bourgs).padStart(7)} ${String(r.pop25).padStart(12)} ${String(aires[c]).padStart(13)} ${String(r.loin).padStart(12)} ${(r.max.toFixed(0) + ' km').padStart(22)}  ${PAYS[c].name}`); }
if (places.length < 900 || places.length > 1400) stop(`${places.length} places : on en vise 900 à 1 400 (régler ESPACE_KM)`);
console.log('écrit : ' + tailles.join(' ; '));
