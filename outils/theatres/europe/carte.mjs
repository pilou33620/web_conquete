// Le théâtre « Europe » (géographie 5, SPEC-FRANCE.md, étape 2) : l'Europe et l'Afrique du Nord au milieu du XVIIIe
// siècle, à 5 km la case. Lu par outils/theatre.mjs (voir outils/THEATRES.md) ; villes.json et epoques.json à côté.
// Estimations et choix d'auteur : frontières, fleuves, caractère des pays.

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
  ['Świna', [[14.24, 53.97], [14.22, 53.86]]], // la lagune de l'Oder (Stettin) et la Baltique
  ['Drøbak', [[10.60, 59.55], [10.62, 59.66], [10.62, 59.75]]], // le fond du fjord d'Oslo (Christiania)
  ['Hals', [[10.40, 56.98], [10.25, 57.0], [10.05, 57.05], [9.95, 57.06], [9.85, 57.07]]], // le Limfjord (Aalborg) et le Cattégat
  ['Saltsjön', [[18.25, 59.33], [18.10, 59.32], [17.95, 59.32]]], // le lac Mälar et la Baltique, à Stockholm
  ['Solent', [[-1.62, 50.66], [-1.50, 50.71], [-1.35, 50.77], [-1.20, 50.77], [-1.05, 50.75]]], // l'île de Wight
];
// estuaires creusés (la grille de 5 km les fermerait ou les couperait : un port au fond n'aurait pas la mer) :
// [nom, largeur en km, axe [lon, lat] de la mer vers l'amont, arrêté à moins de 10 km du port (marine::case_port)]
const ESTUAIRES = [
  ['Gironde', 10, [[-1.12, 45.62], [-1.06, 45.615], [-1.02, 45.59], [-0.945, 45.51], [-0.85, 45.43], [-0.784, 45.35], [-0.745, 45.27], [-0.715, 45.19],
    [-0.70, 45.13], [-0.675, 45.09], [-0.62, 45.05], [-0.56, 45.03]]],
  ['Garonne maritime', 7.5, [[-0.56, 45.03], [-0.535, 44.98], [-0.53, 44.92]]],
  ['Loire', 7.5, [[-2.27, 47.21], [-2.15, 47.245], [-2.03, 47.275], [-1.93, 47.25], [-1.80, 47.21], [-1.67, 47.20]]],
  ['Seine', 7.5, [[0.15, 49.45], [0.30, 49.45], [0.47, 49.47], [0.60, 49.50], [0.73, 49.52], [0.82, 49.47], [0.90, 49.44], [0.98, 49.43]]],
  ['Tamise', 7.5, [[0.90, 51.50], [0.65, 51.49], [0.50, 51.47], [0.37, 51.45], [0.24, 51.47], [0.10, 51.49], [0.0, 51.49]]],
  ['Escaut', 7.5, [[3.45, 51.42], [3.65, 51.42], [3.80, 51.38], [3.95, 51.40], [4.05, 51.38], [4.20, 51.36], [4.30, 51.29]]],
  ['Elbe', 7.5, [[8.55, 53.93], [8.75, 53.88], [8.95, 53.86], [9.25, 53.84], [9.40, 53.76], [9.50, 53.68], [9.60, 53.60], [9.75, 53.565], [9.85, 53.555]]],
  ['Weser', 7.5, [[8.52, 53.62], [8.55, 53.52], [8.49, 53.42], [8.48, 53.32], [8.47, 53.24], [8.58, 53.18], [8.68, 53.13]]],
  ['Meuse', 7.5, [[4.05, 51.99], [4.15, 51.96], [4.25, 51.92], [4.33, 51.90]]],
  ['Guadalquivir', 7.5, [[-6.42, 36.79], [-6.33, 36.85], [-6.25, 36.93], [-6.20, 37.00], [-6.13, 37.10], [-6.10, 37.20], [-6.06, 37.28], [-6.04, 37.31]]],
  ['Humber', 7.5, [[0.15, 53.58], [0.0, 53.60], [-0.10, 53.64], [-0.20, 53.70], [-0.25, 53.71]]],
  ['Mersey', 7.5, [[-3.15, 53.48], [-3.06, 53.45], [-3.02, 53.40], [-2.95, 53.35]]],
  ['Southampton Water', 7.5, [[-1.30, 50.78], [-1.36, 50.86]]], ['lough de Belfast', 7.5, [[-5.60, 54.72], [-5.75, 54.68], [-5.85, 54.65]]],
  ['Shannon', 7.5, [[-9.75, 52.55], [-9.45, 52.6], [-9.15, 52.62], [-8.95, 52.64], [-8.75, 52.66]]],
  ['Trave', 7.5, [[10.95, 54.0], [10.87, 53.96], [10.80, 53.92]]], ['Oder (Stettin)', 7.5, [[14.45, 53.72], [14.58, 53.62], [14.60, 53.52]]],
  ['Pregel', 7.5, [[20.05, 54.62], [20.25, 54.68], [20.42, 54.71]]], ['Nogat (Elbing)', 7.5, [[19.55, 54.38], [19.45, 54.27], [19.42, 54.21]]],
  ['Hollands Diep', 7.5, [[3.95, 51.85], [4.10, 51.80], [4.30, 51.73], [4.50, 51.74], [4.60, 51.78]]],
  ['Bråviken', 7.5, [[16.9, 58.62], [16.6, 58.63], [16.35, 58.61]]], ['Byfjorden', 7.5, [[11.55, 58.29], [11.72, 58.33], [11.85, 58.34]]],
  // remontés par les navires de mer jusqu'au port : la Clyde (Glasgow, creusée depuis 1770), l'IJ (Zaandam), le bas Danube
  // par le bras de Sulina (Tulcea, Galatz, Braïla), le delta du Don (Azov, Rostov)
  ['Clyde', 7.5, [[-4.62, 55.94], [-4.50, 55.92], [-4.42, 55.90], [-4.35, 55.88]]],
  ['IJ', 7.5, [[5.00, 52.42], [4.92, 52.425]]],
  ['bas Danube', 7.5, [[29.62, 45.16], [29.45, 45.15], [29.30, 45.15], [29.12, 45.16],
    [28.95, 45.19], [28.80, 45.215], [28.64, 45.235], [28.46, 45.27],
    [28.33, 45.36], [28.26, 45.44], [28.15, 45.44], [28.06, 45.41], [28.01, 45.35], [27.98, 45.30]]],
  ['Don', 7.5, [[39.25, 47.13], [39.40, 47.15], [39.52, 47.18], [39.62, 47.21]]],
];
// passages connus, vérifiés sur la grille (outils/theatre.mjs) : [nom, [lon, lat] du large, [lon, lat] du fond], reliés
// d'eau en eau (les deltas et les embouchures étroites : par les fleuves, finis à la mer)
const PASSAGES = [
  ['Gironde', [-1.3, 45.6], [-0.53, 44.93]], ['Loire', [-2.4, 47.2], [-1.68, 47.2]], ['Seine', [0.0, 49.5], [0.97, 49.43]],
  ['baie de Somme', [1.3, 50.25], [1.6, 50.2]], ['Tage', [-9.5, 38.65], [-9.0, 38.75]], ['Guadalquivir', [-6.5, 36.75], [-6.05, 37.3]],
  ['Tamise', [1.2, 51.5], [0.0, 51.49]], ['Severn', [-4.0, 51.3], [-2.7, 51.55]], ['Humber', [0.3, 53.55], [-0.25, 53.71]],
  ['Escaut', [3.3, 51.45], [4.29, 51.3]], ['Meuse et Rhin', [3.9, 52.0], [4.32, 51.9]], ['Elbe', [8.3, 54.0], [9.84, 53.555]],
  ['Weser', [8.3, 53.8], [8.67, 53.135]], ['Ems (Dollart)', [6.8, 53.65], [7.2, 53.3]], ['Mersey', [-3.3, 53.5], [-3.06, 53.45]],
  ["lagune de l'Oder", [14.3, 54.1], [14.2, 53.8]], ['lagune de la Vistule', [19.6, 54.8], [19.85, 54.5]],
  ['golfe de Finlande et Neva', [23.0, 59.5], [30.0, 59.95]], ['lagune de Venise', [12.6, 45.3], [12.3, 45.42]],
  ['Zuiderzee', [4.6, 53.1], [5.4, 52.6]], ['Bosphore', [29.1, 41.3], [28.95, 40.9]], ['Dardanelles', [26.0, 40.0], [26.8, 40.5]],
  ['détroit de Gibraltar', [-6.2, 35.9], [-5.0, 36.0]], ['détroit de Messine', [15.65, 38.4], [15.55, 37.95]],
  ['bouches de Bonifacio', [8.8, 41.35], [9.5, 41.35]], ['pas de Calais', [1.3, 50.6], [1.7, 51.2]], ['Sund', [12.45, 56.2], [12.85, 55.5]],
  ['Grand Belt', [11.0, 55.9], [11.0, 55.1]], ['Petit Belt', [9.75, 55.62], [10.0, 55.1]], ['détroit de Kertch', [36.6, 45.5], [36.55, 45.1]],
  ['Clyde', [-4.93, 55.8], [-4.36, 55.88]], ['IJ', [5.2, 52.5], [4.92, 52.425]], ['bouches du Danube', [29.8, 45.15], [27.98, 45.31]],
  ['Don', [38.9, 46.95], [39.61, 47.21]],
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

// lacs : noms français de Natural Earth retouchés
const NOM_LAC = { IJsselmeer: 'Zuiderzee', Pihkva: 'Lac de Pskov', Syvach: 'Sivach', 'Lake Milh': 'Lac Milh', 'Côme': 'Lac de Côme', Garde: 'Lac de Garde', Constance: 'Lac de Constance',
  'Neuchâtel': 'Lac de Neuchâtel', Zurich: 'Lac de Zurich', 'Tibériade': 'Lac de Tibériade', Van: 'Lac de Van' };

// ------------------------------------------------------------------ les pays : le format des camps du jeu (rules.rs, FACTIONS)
// Choix d'auteur, dans le ton des départements du mode France. mods : seulement des clés que le moteur lit déjà.
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
// moyens de départ (armée de paix en milliers d'hommes au début de 1700, 1790, 1813 et 1870 ; trésor en multiples des
// 500 livres d'un département), maisons (la régnante de 1700 d'abord) et familles culturelles : ceux du moteur (rules.rs)
const MOYENS = {
  FR: [[150, 170, 400, 400], 3], // la plus grande armée d'Europe
  GB: [[30, 45, 250, 180], 4.5], // petite armée, mais le plus riche
  RU: [[110, 300, 450, 700], 1.4],
  AU: [[100, 300, 250, 280], 2],
  OT: [[120, 150, 150, 200], 2.5],
  ES: [[30, 80, 100, 100], 2.2],
  PR: [[40, 190, 230, 400], 1.4],
  SE: [[70, 50, 40, 40], 1.2],
  DK: [[30, 70, 40, 40], 1.2],
  NL: [[45, 40, 20, 60], 3.5], // les banquiers de l'Europe
  PL: [[30, 60, 50, 30], 0.6],
  PT: [[20, 40, 50, 30], 1.5],
  NA: [[20, 30, 40, 60], 1],
  SA: [[25, 40, 30, 70], 0.9],
  VE: [[20, 10, 10, 10], 1.4],
  BA: [[20, 30, 50, 60], 0.8],
  SX: [[25, 30, 30, 30], 1],
  HA: [[15, 25, 20, 20], 0.8],
  CH: [[15, 20, 15, 30], 0.8],
  IT: [[10, 10, 30, 30], 1],
  WE: [[15, 15, 20, 20], 0.6],
  BE: [[15, 15, 15, 40], 0.6],
  MA: [[40, 30, 30, 30], 0.6],
  CR: [[40, 20, 20, 20], 0.3], // la horde : des cavaliers, peu d'argent
  AL: [[15, 15, 15, 10], 0.5],
  TU: [[10, 10, 10, 10], 0.4],
  TR: [[5, 5, 5, 5], 0.25],
  GE: [[5, 5, 5, 5], 1],
  PO: [[5, 5, 5, 10], 0.8],
  WU: [[5, 6, 15, 20], 0.4],
  CO: [[2, 2, 2, 2], 0.2],
  ML: [[1.5, 2, 1.5, 1.5], 0.4], // l'Ordre : quelques centaines de chevaliers, 1 à 2 000 soldats
};
const MAISONS = {
  AL: ['Mezzomorto', 'Baba Hassan', 'Hadj Moustafa', 'Ali Chaouch', 'Kurd Abdi', 'Baba Ali', 'Hussein', 'Omar Agha'],
  AU: ['Habsbourg', 'Lorraine', 'Liechtenstein', 'Esterházy', 'Schwarzenberg', 'Kaunitz', 'Metternich', 'Lobkowicz'],
  BA: ['Wittelsbach', 'Montgelas', 'Törring', 'Preysing', 'Seinsheim', 'Arco', 'La Rosée', 'Oettingen'],
  BE: ["d'Arenberg", 'de Ligne', 'de Croÿ', 'de Mérode', "d'Ursel", 'de Lannoy', 'de Lalaing', 'de Trazegnies'],
  CH: ['de Watteville', "d'Erlach", 'de Diesbach', 'de Reding', 'Pfyffer', 'de Salis', 'de Steiger', 'Escher'],
  CO: ['Kettler', 'Biron', 'Medem', 'Keyserling', 'Korff', 'Fircks', 'Lieven', 'Behr'],
  CR: ['Giray', 'Chirine', 'Mansour', 'Baryn', 'Argyn', 'Sedjeut', 'Nogaï', 'Kiptchak'],
  DK: ['Oldenbourg', 'Rantzau', 'Ahlefeldt', 'Reventlow', 'Bernstorff', 'Moltke', 'Danneskiold', 'Holstein'],
  ES: ['Bourbon', 'Alvarez de Toledo', 'Medinaceli', 'Osuna', 'Grimaldo', 'Ensenada', 'Aranda', 'Floridablanca'],
  FR: ['Bourbon', "d'Orléans", 'de Noailles', 'de Villars', 'de Vendôme', 'de Choiseul', 'de Broglie', 'de Rohan'],
  GB: ['Stuart', 'Hanovre', 'Churchill', 'Russell', 'Cavendish', 'Pitt', 'Pelham', 'Walpole'],
  GE: ['Doria', 'Spinola', 'Grimaldi', 'Durazzo', 'Brignole', 'Pallavicini', 'De Mari', 'Lomellini'],
  HA: ['Brunswick-Lunebourg', 'Münchhausen', 'Bernstorff', 'Platen', 'Hardenberg', 'Grote', 'Busche', 'Wangenheim'],
  IT: ['Médicis', 'Lorraine', 'Strozzi', 'Corsini', 'Riccardi', 'Borromée', 'Visconti', 'Litta'],
  MA: ['Alaouite', 'Saâdien', 'Er-Riffi', 'Ben Ali', 'Ouazzani', 'Glaoui', 'Mtougui', 'Goundafi'],
  ML: ['Perellos', 'Zondadari', 'Vilhena', 'Despuig', 'Pinto', 'Ximenes', 'de Rohan', 'Hompesch'],
  NA: ['Bourbon-Sicile', 'Caracciolo', 'Pignatelli', 'Carafa', 'Colonna', 'Ruffo', 'Tanucci', 'Acton'],
  NL: ['Orange-Nassau', 'Heinsius', 'De Witt', 'Bentinck', 'Van Haren', 'Fagel', 'Van Slingelandt', 'Van Hogendorp'],
  OT: ['Osman', 'Köprülü', 'Kara Moustafa', 'Damad', 'Çandarlı', 'Sokollu', 'Djezzar', 'Tchapanoğlou'],
  PL: ['Wettin', 'Sobieski', 'Leszczyński', 'Poniatowski', 'Czartoryski', 'Radziwiłł', 'Potocki', 'Lubomirski'],
  PO: ['Albani', 'Orsini', 'Colonna', 'Barberini', 'Corsini', 'Rezzonico', 'Braschi', 'Chigi'],
  PR: ['Hohenzollern', 'Dohna', 'Finckenstein', 'Hardenberg', 'Stein', 'Bismarck', 'Arnim', 'Schulenburg'],
  PT: ['Bragance', 'Pombal', 'Cadaval', 'Távora', 'Aveiro', 'Palmela', 'Saldanha', 'Sá da Bandeira'],
  RU: ['Romanov', 'Narychkine', 'Galitzine', 'Dolgorouki', 'Troubetskoï', 'Menchikov', 'Orlov', 'Volkonski'],
  SA: ['Savoie', 'Carignan', 'San Martino', 'Solaro', 'Thaon de Revel', 'Cavour', "d'Azeglio", 'Balbo'],
  SE: ['Deux-Ponts', 'Vasa', 'De la Gardie', 'Oxenstierna', 'Brahe', 'Wrangel', 'Horn', 'Bernadotte'],
  SX: ['Wettin', 'Brühl', 'Flemming', 'Schönburg', 'Einsiedel', 'Löser', 'Bünau', 'Vitzthum'],
  TR: ['Karamanli', 'Djerbi', 'Gurgi', 'Mukni', 'Ben Châbane', 'Arnaout', 'Dghiss', 'Siala'],
  TU: ['Husseinite', 'Mouradite', 'Ben Ayed', 'Khaznadar', 'Djellouli', 'Ben Diaf', 'Kheireddine', 'Lasram'],
  VE: ['Mocenigo', 'Morosini', 'Contarini', 'Grimani', 'Dandolo', 'Foscari', 'Loredan', 'Manin'],
  WE: ['Neubourg', 'Plettenberg', 'Fürstenberg', 'Metternich', 'Salm', 'Wied', 'Nesselrode', 'Spee'],
  WU: ['Wurtemberg', 'Grävenitz', 'Montmartin', 'Zeppelin', 'Leutrum', 'Gemmingen', 'Phull', 'Normann'],
};
// la France garde les prénoms et les noms des départements
const CULTURE = Object.fromEntries(Object.entries({ britannique: 'GB', allemande: 'AU PR BA SX HA WU WE CH CO', russe: 'RU', espagnole: 'ES', portugaise: 'PT', italienne: 'NA SA VE GE PO IT ML', ottomane: 'OT CR AL TU TR MA', scandinave: 'SE DK', polonaise: 'PL', neerlandaise: 'NL BE', francaise: 'FR' })
  .flatMap(([k, codes]) => codes.split(' ').map(c => [c, k])));
for (const [c, p] of Object.entries(PAYS)) Object.assign(p, { moyens: MOYENS[c], maisons: MAISONS[c], culture: CULTURE[c] });

export default {
  id: 'europe', geo: 5, nom: 'Europe',
  cadre: { LON0: -11, LON1: 45, LAT0: 29, LAT1: 62, LAT_REF: 46, KM: 5 },
  places: [900, 1400],
  ENTIERS, COUPES, DETROITS, ESTUAIRES, PASSAGES, FLEUVES, NOM_LAC,
  // (Nikolaïev sur le liman du Boug : estuaire trop étroit pour la carte)
  PORTS_ADMIS: ['Nikolaïev|CR'],
  NE: { rivieres: ['ne_10m_rivers_europe'], lacs: ['ne_10m_lakes_europe'] },
  PAYS,
  CULTURES: {},
};
