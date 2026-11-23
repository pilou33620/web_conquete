// Le théâtre « Indes orientales » (géographie 11), théâtre commercial d'après le découpage d'Empire: Total War :
// l'archipel indonésien, la péninsule malaise et les Philippines vers 1700, à 5 km la case. Lu par outils/theatre.mjs
// (voir outils/THEATRES.md) ; villes.json et epoques.json à côté. Estimations et choix d'auteur : frontières, fleuves,
// caractère des pays.
//
// Dans Empire, les Indes orientales sont une zone de mer avec des points de commerce (épices) ; ici c'est une carte
// terrestre : les sultanats et royaumes de 1700, la VOC et les comptoirs européens. Les points de commerce d'Empire
// deviennent des places « port commerce ».
// Cadre : de Sumatra (94,8° E) à la péninsule de la Tête d'Oiseau (135° E), de Rote (11,2° S) au nord de Luçon (19,2° N) :
// 893 × 675 cases, 0,60 million. Coupés : la Nouvelle-Guinée à l'est de 135° E (hors jeu de toute façon), les îles
// Babuyan et Batanes au nord de Luçon. Le continent (Siam, Cambodge, Annam, Birmanie) est hors jeu, sauf le sud malais.
// Choix pour les petits établissements :
//  - VOC (ONL) : Batavia et le Priangan, Malacca, les Moluques du Sud (Ambon, Banda) ; enclaves par retouche (cercles)
//    à Makassar (10 km), Padang (15 km), Kupang (15 km) et Manado (12 km).
//  - Bencoolen (OGB, Compagnie anglaise des Indes) : la province de Bengkulu, la côte du poivre que tenait la Compagnie.
//  - Les Portugais de Timor et les Topasses de Larantuka (OPT) : Timor (sauf Kupang), Flores, Solor, Sumba et Alor.
//  - Sumbawa (Bima, Sumbawa, Dompu) va aux royaumes de Bone et de Gowa (OGO), dont elle était l'alliée et la vassale.
//  - Jambi va à Palembang (OPL) ; Siak, Kampar et Indragiri, dépendances de Johor en 1700, à Johor-Riau (OJO).
//  - Le nord-est de Bornéo (Sabah à l'est de 116,6° E), cédé par Brunei au sultan de Sulu en 1704, va à Sulu (OSU).
//  - Petites îles : Ternate, Tidore et Saparua sont à l'échelle (plus de 14 km²) ; les îles Banda (la muscade) sont trop
//    petites pour la grille et rendues à la mer : la VOC garde Ambon et Saparua.

const LAT_REF = 4;
const KX = 111.32 * Math.cos(LAT_REF * Math.PI / 180), KY = 110.95; // comme geo.rs
const pres = (lon, lat, p, km) => Math.hypot((lon - p[0]) * KX, (lat - p[1]) * KY) <= km;
// enclaves de la VOC : [lon, lat, rayon en km]
const ENCLAVES_VOC = [[119.42, -5.14, 10], [100.36, -0.95, 15], [123.60, -10.17, 15], [124.84, 1.49, 12]]; // Makassar, Padang, Kupang, Manado
const voc = (lon, lat) => ENCLAVES_VOC.some(([x, y, r]) => pres(lon, lat, [x, y], r));

// ------------------------------------------------------------------ les pays de 1700
// Estimations et choix d'auteur : frontières de 1700 approchées par les pays et les régions d'aujourd'hui.
// « ~Nom » : terre hors jeu (lands).
const ENTIERS = {
  Brunei: 'OBR', Singapore: 'OJO', 'Timor-Leste': 'OPT',
  Vietnam: '~Annam', Cambodia: '~Cambodge', Laos: '~Laos', Myanmar: '~Birmanie', China: '~Chine', India: '~Inde',
  Australia: '~Australie', Palau: '~Palaos', 'Spratly Is.': '~Spratleys', 'Scarborough Reef': '~Scarborough', 'Indian Ocean Ter.': '~Île Christmas',
};
const COUPES = {
  Indonesia: { carte: 'id/id-all', defaut: 'OTI', // (un îlot sans nom de la carte, près de la Tête d'Oiseau)
    regions: { Aceh: 'OAC', 'Sumatera Utara': 'OAC', // Aceh, ses vassaux de Deli et d'Asahan, le pays batak
      'Sumatera Barat': 'OMI', Riau: 'OJO', 'Kepulauan Riau': 'OJO', Jambi: 'OPL', 'Sumatera Selatan': 'OPL', 'Bangka-Belitung': 'OPL',
      Bengkulu: 'OGB', Lampung: 'OBT', Banten: 'OBT', 'Jakarta Raya': 'ONL', 'Jawa Barat': 'ONL', // le Priangan et Cirebon, à la VOC (1677-1705)
      'Jawa Tengah': 'OMT', Yogyakarta: 'OMT', 'Jawa Timur': 'OMT', Bali: 'OBL', 'Nusa Tenggara Barat': 'OGO', 'Nusa Tenggara Timur': 'OPT',
      'Kalimantan Barat': 'OSB', 'Kalimantan Tengah': 'OBJ', 'Kalimantan Selatan': 'OBJ', 'Kalimantan Timur': 'OKU', 'Kalimantan Utara': 'OKU',
      'Sulawesi Selatan': 'OGO', 'Sulawesi Barat': 'OGO', 'Sulawesi Tenggara': 'OGO', 'Sulawesi Tengah': 'OTE', Gorontalo: 'OTE', 'Sulawesi Utara': 'OTE',
      'Maluku Utara': 'OTE', Maluku: 'ONL', 'Irian Jaya Barat': 'OTI', Papua: '~Nouvelle-Guinée' },
    retouche: (lon, lat, r) =>
      voc(lon, lat) ? 'ONL'
      : r === 'Jawa Timur' && lon > 113.7 && lat < -7.5 ? 'OBL' // Blambangan, sous la coupe de Bali
      : r === 'Nusa Tenggara Barat' && lon < 116.78 ? 'OBL' // Lombok, aux princes de Karangasem
      : r === 'Maluku Utara' && (lat < 0.745 && lat > -0.35 || lon > 128.1) ? 'OTI' // Tidore et le sud et l'est de Halmahera
      : null },
  Malaysia: { carte: 'my/my-all', defaut: 'OJO',
    regions: { Sabah: 'OBR', Sarawak: 'OBR', Labuan: 'OBR', 'Pulau Pinang': 'OKD', Kedah: 'OKD', Perlis: 'OKD', Perak: 'OPK', Kelantan: 'OPA', Melaka: 'ONL' },
    retouche: (lon, lat, r) => r === 'Sabah' && lon > 116.6 ? 'OSU' : null },
  Thailand: { carte: 'th/th-all', defaut: '~Siam', regions: { Pattani: 'OPA', Yala: 'OPA', Narathiwat: 'OPA', Satun: 'OKD' } },
  Philippines: { carte: 'ph/ph-all', defaut: 'OES',
    regions: Object.fromEntries([...['Maguindanao', 'Cotabato', 'Sultan Kudarat', 'South Cotabato', 'Sarangani', 'General Santos', 'Davao del Sur', 'Davao',
      'Davao del Norte', 'Davao Oriental', 'Compostela Valley', 'Lanao del Sur', 'Bukidnon', 'Zamboanga del Sur', 'Zamboanga Sibugay'].map(r => [r, 'OMG']),
      ...['Sulu', 'Tawi-Tawi', 'Basilan'].map(r => [r, 'OSU'])]),
    retouche: (lon, lat, r) => r === 'Palawan' && lat < 9.3 ? 'OSU' : null }, // le sud de Palawan
};
// détroits rouverts sur 7,5 km de large (la grille les fermerait)
const DETROITS = [
  ['Détroit de Bali', [[114.42, -8.03], [114.41, -8.13], [114.43, -8.25], [114.5, -8.4]]],
];

// ------------------------------------------------------------------ fleuves : estimations (source et embouchure, à 30 km près)
// [nom, rang (1 fleuve, 2 grande rivière, 3 rivière), [lon, lat] vers la source, [lon, lat] à l'embouchure ou au confluent,
// noms Natural Earth admis (facultatif)]. Le tracé est celui de Natural Earth (lignes de 10 m), suivi d'un point à l'autre ;
// à défaut, des points écrits de mémoire.
const FLEUVES = [
  ['Musi', 1, [102.57, -3.32], [105.05, -2.37], /^Masi$/], ['Kapuas', 1, [113.47, 1.2], [109.22, -0.24], /^Kapuas$/],
  ['Barito', 1, [114.84, 0.56], [114.55, -3.35], /^Barito$/], ['Mahakam', 1, [114.36, 1.36], [117.44, -0.52], /^Mahakam$/],
  ['Kayan', 2, [114.76, 1.76], [117.54, 2.92], /^Kayan$/], ['Indragiri', 2, [100.55, -0.57], [103.35, -0.36], /^Indragi$/],
  ['Rajang', 2, [113.8, 2.71], [111.38, 2.16], /^Bajang$/], ['Seruyan', 3, [112.01, -0.91], [112.58, -3.42], /^Pembuang$/],
  ['Baram', 3, [115.47, 3.45], [114.0, 4.6], /^Baram$/], ['Asahan', 3, [99.15, 2.42], [99.86, 3.01], /^Asahan$/],
  ['Pahang', 2, [102.79, 4.44], [103.45, 3.5], /^Pahang$/], ['Cagayan', 2, [121.4, 16.1], [121.64, 18.31], /^Cagayan$/],
  ['Chao Phraya', 1, [100.14, 15.71], [100.6, 13.61], /^Chao Phraya$/],
  // absents de Natural Earth : points connus du cours, de la source à l'embouchure (de mémoire, à quelques km près)
  ['Bengawan Solo', 1, [[110.92, -7.82], [110.83, -7.57], [111.1, -7.42], [111.45, -7.4], [111.6, -7.18], [111.88, -7.15], [112.1, -7.1], [112.38, -7.11], [112.57, -6.88]]],
  ['Brantas', 2, [[112.52, -7.87], [112.63, -7.98], [112.4, -8.12], [112.17, -8.1], [112.01, -7.82], [112.1, -7.6], [112.43, -7.46], [112.6, -7.38], [112.73, -7.3], [112.73, -7.2]]],
  ['Batang Hari', 2, [[101.25, -0.95], [101.75, -1.05], [102.15, -1.25], [102.45, -1.48], [102.9, -1.55], [103.27, -1.68], [103.6, -1.6], [103.82, -1.35], [103.95, -1.05]]],
  ['Rio Grande de Mindanao', 2, [[125.05, 8.1], [124.95, 7.6], [124.85, 7.12], [124.6, 7.2], [124.35, 7.2], [124.2, 7.22]]],
  ['Pampanga', 3, [[121.1, 15.8], [120.95, 15.4], [120.8, 15.1], [120.7, 14.85], [120.65, 14.78]]],
  ['Perak', 3, [[101.13, 5.44], [101.0, 5.0], [100.94, 4.77], [100.98, 4.4], [101.03, 4.03], [100.75, 3.98]]],
];
const NOM_LAC = { Toba: 'Lac Toba', 'Tonle Sap': 'Tonlé Sap', Laguna: 'Laguna de Bay', 'Laguna de Bay': 'Laguna de Bay', Taal: 'Lac Taal', Lanao: 'Lac Lanao', Poso: 'Lac Poso', Towuti: 'Lac Towuti', Matano: 'Lac Matano', Tempe: 'Lac Tempe' };

// ------------------------------------------------------------------ les pays : le format des camps du jeu (rules.rs, FACTIONS)
// Choix d'auteur, dans le ton des pays d'Europe. mods : seulement des clés que le moteur lit déjà.
const P = (name, short, adj, color, title, pros, cons, mods, [aggr, trade, expand, tech], specialty) =>
  ({ name, short, capital: '', color, adj, title, pros, cons, mods, personality: { aggr, trade, expand, tech }, specialty });
const PAYS = {
  ONL: P('Compagnie des Indes orientales (VOC)', 'VOC', 'hollandais', '#e67e22', 'Les Seize Messieurs de Batavia', ['Monopole des épices : accords commerciaux +35 %', 'Comptoirs fortifiés : fortifications +15 %', 'Flottes de la Compagnie : ports +20 %'], ['Soldats européens rares : recrues −30 %', 'Fièvres de Batavia : usure +15 %'],
    { trade: 0.35, fort_bonus: 0.15, port: 0.2, recrues: -0.3, attrition: 0.15 }, [0.55, 0.95, 0.55, 'civil'], 'livres'),
  OMT: P('Royaume de Mataram', 'Mataram', 'javanais', '#1e8449', 'Le Susuhunan de Kartasura', ['Sawah de Java : vivres +30 %', 'Royaume le plus peuplé : recrues +20 %'], ['Princes rivaux : entretien des troupes +10 %', 'Côtes cédées : accords commerciaux −10 %'],
    { vivres: 0.3, recrues: 0.2, upkeep: 0.1, trade: -0.1 }, [0.5, 0.45, 0.55, 'agricole'], 'vivres'),
  OBT: P('Sultanat de Banten', 'Banten', 'bantenois', '#c0392b', 'Le Port du poivre', ['Poivre de Lampung : accords commerciaux +20 %', 'Ports +10 %'], ['Vassal de la Compagnie : diplomatie −10', 'Recrues −10 %'],
    { trade: 0.2, port: 0.1, diplo: -10, recrues: -0.1 }, [0.35, 0.75, 0.3, 'civil'], 'livres'),
  OBL: P('Royaumes de Bali', 'Bali', 'balinais', '#f1948a', 'Le Dewa Agung de Klungkung', ['Guerriers balinais : infanterie +12 %', 'Rizières des subak : vivres +20 %'], ['Princes rivaux : livres −10 %', 'Commerce −10 %'],
    { inf_power: 0.12, vivres: 0.2, livres: -0.1, trade: -0.1 }, [0.6, 0.4, 0.5, 'militaire'], 'recrues'),
  OGO: P('Royaumes de Bone et de Gowa', 'Bone-Gowa', 'bugis', '#2e4053', 'Les Seigneurs de Célèbes', ['Marins bugis : ports +20 %', 'Guerriers de Célèbes : infanterie +10 %', 'Négoce bugis : accords commerciaux +10 %'], ['Royaumes rivaux : entretien des troupes +10 %'],
    { port: 0.2, inf_power: 0.1, trade: 0.1, upkeep: 0.1 }, [0.65, 0.7, 0.6, 'militaire'], 'recrues'),
  OTE: P('Sultanat de Ternate', 'Ternate', 'ternatais', '#b03a2e', 'Le Maître des Moluques du Nord', ['Girofle et muscade : accords commerciaux +20 %', 'Kora-kora : ports +15 %'], ['Allié de la Compagnie : diplomatie −5', 'Industrie −20 %'],
    { trade: 0.2, port: 0.15, diplo: -5, industrie: -0.2 }, [0.45, 0.75, 0.45, 'civil'], 'livres'),
  OTI: P('Sultanat de Tidore', 'Tidore', 'tidorien', '#f9e79f', 'Le Seigneur des îles papoues', ['Kora-kora des Raja Ampat : ports +20 %', 'Jungles de Halmahera : embuscades +20 %'], ['Pays dispersé : recrues −15 %', 'Industrie −20 %'],
    { port: 0.2, ambush: 0.2, recrues: -0.15, industrie: -0.2 }, [0.5, 0.65, 0.45, 'militaire'], 'livres'),
  OAC: P("Sultanat d'Aceh", 'Aceh', 'acehnais', '#1c2833', 'La Véranda de La Mecque', ['Poivre de la côte ouest : accords commerciaux +15 %', 'Guerriers acehnais : infanterie +10 %', 'Guerre sainte : moral +10 %'], ['Uleebalang indociles : entretien des troupes +10 %'],
    { trade: 0.15, inf_power: 0.1, morale: 0.1, upkeep: 0.1 }, [0.6, 0.6, 0.5, 'militaire'], 'recrues'),
  OMI: P('Royaume de Pagaruyung', 'Minangkabau', 'minangkabau', '#7d3c98', 'Le Royaume des Minangkabau', ["Or des hautes terres : livres +15 %", 'Hautes terres : montagne +20 %'], ['Nagari autonomes : recrues −10 %', 'Industrie −15 %'],
    { livres: 0.15, mountain: 0.2, recrues: -0.1, industrie: -0.15 }, [0.4, 0.6, 0.4, 'agricole'], 'livres'),
  OPL: P('Sultanats de Palembang et de Jambi', 'Palembang', 'palembangais', '#58d68d', "L'Étain de Bangka", ["Étain de Bangka : fer +30 %", 'Poivre du Musi : accords commerciaux +15 %'], ['Marais : routes −10 %', 'Recrues −10 %'],
    { fer: 0.3, trade: 0.15, road_speed: -0.1, recrues: -0.1 }, [0.35, 0.75, 0.35, 'industriel'], 'fer'),
  OGB: P('Bencoolen (Compagnie anglaise des Indes)', 'Bencoolen', 'britannique', '#f4d03f', 'La Côte du poivre', ['Poivre de Bencoolen : accords commerciaux +25 %', 'Fort Marlborough : fortifications +15 %'], ['Comptoir lointain : recrues −30 %', 'Fièvres : usure +15 %'],
    { trade: 0.25, fort_bonus: 0.15, recrues: -0.3, attrition: 0.15 }, [0.35, 0.9, 0.3, 'industriel'], 'livres'),
  OJO: P('Empire de Johor-Riau', 'Johor-Riau', 'malais', '#2874a6', 'Les Héritiers de Malacca', ['Entrepôt de Riau : accords commerciaux +25 %', 'Orang laut : ports +20 %'], ['Bugis et Minangkabau rivaux : entretien des troupes +10 %', 'Recrues −10 %'],
    { trade: 0.25, port: 0.2, upkeep: 0.1, recrues: -0.1 }, [0.45, 0.85, 0.45, 'civil'], 'livres'),
  OPK: P('Sultanat de Perak', 'Perak', 'perakien', '#48c9b0', "L'Étain du Kinta", ["Étain de Perak : fer +30 %", 'Accords commerciaux +10 %'], ['Petit sultanat : recrues −20 %'],
    { fer: 0.3, trade: 0.1, recrues: -0.2 }, [0.3, 0.7, 0.3, 'industriel'], 'fer'),
  OKD: P('Sultanat de Kedah', 'Kedah', 'kedahan', '#e74c3c', 'Le Grenier du Nord', ['Rizières de Kedah : vivres +25 %', 'Ports +10 %'], ['Vassal du Siam : diplomatie −5', 'Recrues −10 %'],
    { vivres: 0.25, port: 0.1, diplo: -5, recrues: -0.1 }, [0.3, 0.65, 0.3, 'agricole'], 'vivres'),
  OPA: P('Sultanat de Patani', 'Patani', 'patanais', '#f5b041', 'Les Reines et les Rajas de Patani', ['Port de Patani : accords commerciaux +20 %', 'Canons de bronze : artillerie +10 %'], ['Vassal du Siam : diplomatie −5', 'Recrues −10 %'],
    { trade: 0.2, art_power: 0.1, diplo: -5, recrues: -0.1 }, [0.35, 0.75, 0.3, 'civil'], 'livres'),
  OBR: P('Sultanat de Brunei', 'Brunei', 'brunéien', '#f7dc6f', 'Le Seigneur de Bornéo', ['Camphre et nids de salanganes : accords commerciaux +15 %', 'Ville sur pilotis : ports +15 %'], ['Guerre civile et vassaux perdus : recrues −15 %', 'Industrie −15 %'],
    { trade: 0.15, port: 0.15, recrues: -0.15, industrie: -0.15 }, [0.35, 0.7, 0.35, 'civil'], 'livres'),
  OSU: P('Sultanat de Sulu', 'Sulu', 'tausug', '#6c3483', 'Les Seigneurs de la mer de Sulu', ['Razzias des Iranun : ports +25 %', 'Embuscades +20 %', 'Perles et trépang : accords commerciaux +15 %'], ['Nid de pirates : diplomatie −10', 'Industrie −20 %'],
    { port: 0.25, ambush: 0.2, trade: 0.15, diplo: -10, industrie: -0.2 }, [0.7, 0.65, 0.45, 'militaire'], 'livres'),
  OMG: P('Sultanat de Maguindanao', 'Maguindanao', 'maguindanao', '#117864', 'Les Héritiers de Kudarat', ['Kris et lantakas : infanterie +10 %', 'Forêts de Mindanao : embuscades +25 %'], ['Datus indociles : entretien des troupes +10 %', 'Industrie −20 %'],
    { inf_power: 0.1, ambush: 0.25, upkeep: 0.1, industrie: -0.2 }, [0.6, 0.5, 0.45, 'militaire'], 'recrues'),
  OES: P('Philippines espagnoles', 'Philippines', 'espagnol', '#e0a526', 'Le Galion de Manille', ['Galion de Manille : livres +20 %', 'Missions et pueblos : recrues +10 %', 'Intramuros : fortifications +10 %'], ['Garnisons lointaines : entretien des troupes +10 %', 'Industrie −10 %'],
    { livres: 0.2, recrues: 0.1, fort_bonus: 0.1, upkeep: 0.1, industrie: -0.1 }, [0.45, 0.7, 0.5, 'civil'], 'livres'),
  OBJ: P('Sultanat de Banjarmasin', 'Banjar', 'banjar', '#a04000', 'Le Poivre et les Diamants de Martapura', ['Poivre et diamants : livres +15 %', 'Rivières du Barito : accords commerciaux +10 %'], ['Marais : routes −10 %', 'Recrues −10 %'],
    { livres: 0.15, trade: 0.1, road_speed: -0.1, recrues: -0.1 }, [0.4, 0.65, 0.4, 'civil'], 'livres'),
  OKU: P('Sultanat de Kutai', 'Kutai', 'kutai', '#27ae60', 'Les Rois du Mahakam', ['Forêts de Bornéo : bois +30 %', 'Jungles : embuscades +15 %'], ['Pays peu peuplé : recrues −20 %', 'Industrie −20 %'],
    { bois: 0.3, ambush: 0.15, recrues: -0.2, industrie: -0.2 }, [0.35, 0.55, 0.4, 'agricole'], 'bois'),
  OSB: P('Sultanats de Sambas et de Sukadana', 'Sambas', 'sambasien', '#5dade2', "L'Or de Bornéo occidental", ["Or des kongsi chinois : livres +20 %", 'Forêts : bois +15 %'], ['Kongsi indociles : entretien des troupes +10 %', 'Recrues −10 %'],
    { livres: 0.2, bois: 0.15, upkeep: 0.1, recrues: -0.1 }, [0.35, 0.65, 0.35, 'civil'], 'livres'),
  OPT: P('Timor portugais et Topasses', 'Timor', 'portugais', '#196f3d', 'Les Portugais noirs de Larantuka', ['Bois de santal : accords commerciaux +20 %', 'Topasses : embuscades +20 %'], ['Comptoir oublié : recrues −20 %', 'Industrie −20 %'],
    { trade: 0.2, ambush: 0.2, recrues: -0.2, industrie: -0.2 }, [0.45, 0.7, 0.35, 'militaire'], 'livres'),
};
// moyens de départ (armée de paix en milliers d'hommes au début de 1700, 1790, 1813 et 1870 ; trésor en multiples des
// 500 livres d'un département) : estimations de mémoire, ordres de grandeur (levées, garnisons, auxiliaires)
const MOYENS = {
  ONL: [[6, 8, 15, 30], 3], // garnisons de la Compagnie, puis l'armée de Daendels et la KNIL
  OMT: [[30, 25, 15, 5], 1.2],
  OBT: [[8, 5, 3, 1], 0.6],
  OBL: [[15, 15, 12, 10], 0.6],
  OGO: [[15, 12, 10, 8], 0.8],
  OTE: [[8, 5, 4, 2], 0.6],
  OTI: [[5, 4, 4, 2], 0.5], // Nuku et ses flottes vers 1800
  OAC: [[20, 15, 15, 25], 1],
  OMI: [[10, 8, 10, 4], 0.5], // la guerre des Padri (1821-1837)
  OPL: [[8, 6, 6, 2], 1],
  OGB: [[0.5, 1, 1, 1], 0.6],
  OJO: [[8, 8, 6, 5], 1],
  OPK: [[3, 3, 3, 3], 0.5],
  OKD: [[5, 5, 4, 3], 0.5],
  OPA: [[5, 4, 3, 2], 0.5],
  OBR: [[8, 5, 3, 1], 0.6],
  OSU: [[10, 10, 10, 8], 0.6],
  OMG: [[10, 8, 8, 5], 0.5],
  OES: [[3, 5, 7, 12], 1.5],
  OBJ: [[8, 6, 6, 4], 0.6],
  OKU: [[5, 4, 4, 3], 0.4],
  OSB: [[4, 4, 4, 3], 0.4],
  OPT: [[3, 3, 3, 2], 0.3],
};
// maisons (la régnante de 1700 d'abord, écrites à la française) : dynasties, lignées princières, grandes familles,
// gouverneurs des compagnies ; plusieurs noms sont des approximations d'auteur
const MAISONS = {
  ONL: ['Van Outhoorn', 'Van Riebeeck', 'Van Imhoff', 'Mossel', 'Van der Parra', 'Alting', 'Daendels', 'Van den Bosch'],
  OMT: ['Mataram', 'Pakubuwono', 'Hamengkubuwono', 'Mangkunegaran', 'Pakualaman', 'Danurejo', 'Cakraningrat', 'Sasradiningrat'],
  OBT: ['Surosowan', 'Tirtayasa', 'Abulmahasin', 'Zainul Arifin', 'Aliyuddin', 'Kiai Tapa', 'Ratu Bagus Buang', 'Rafiuddin'],
  OBL: ['Dewa Agung', 'Panji Sakti', 'Karangasem', 'Mengwi', 'Pemecutan', 'Gianyar', 'Tabanan', 'Bangli'],
  OGO: ['Palakka', 'Gowa', 'Tallo', 'Wajo', 'Soppeng', 'Luwu', 'Bima', 'Buton'],
  OTE: ['Ternate', 'Babullah', 'Hamzah', 'Mandar Syah', 'Sibori', 'Tomagola', 'Tomaito', 'Jailolo'],
  OTI: ['Tidore', 'Saifuddin', 'Nuku', 'Kamaluddin', 'Hamzah Fahruddin', 'Gamrange', 'Raja Ampat', 'Gebe'],
  OAC: ['Jamalullail', 'Meukuta Alam', 'Alaiddin', 'Panglima Polem', 'Teuku Umar', 'Tiro', 'Nyak Arif', 'Habib Abdurrahman'],
  OMI: ['Pagaruyung', 'Ketumanggungan', 'Perpatih nan Sabatang', 'Imam Bonjol', 'Tuanku nan Renceh', 'Tuanku Lintau', 'Indrapura', 'Tuanku Rao'],
  OPL: ['Palembang Darussalam', 'Badaruddin', 'Najamuddin', 'Bahauddin', 'Kemas', 'Jambi', 'Taha Saifuddin', 'Ki Gede ing Suro'],
  OGB: ['Compagnie anglaise des Indes', 'Collet', 'Raffles', 'Parr', 'Marsden', 'Carter', 'Bloome', 'Ord'],
  OJO: ['Bendahara', 'Malacca', 'Raja Kecik', 'Daeng Marewah', 'Raja Haji', 'Temenggong', 'Abou Bakar', 'Lingga'],
  OPK: ['Muzaffar Shah', 'Iskandar Zulkarnain', 'Mansur Shah', 'Abdullah', 'Yusuf', 'Ngah Ibrahim', 'Maharaja Lela', 'Laksamana'],
  OKD: ['Mahawangsa', 'Muhammad Jiwa', 'Abdullah Mukarram', 'Ahmad Tajuddin', 'Dziauddin', 'Tunku Kudin', 'Tunku Ismail', 'Laksamana Kedah'],
  OPA: ['Kelantan', 'Inderawangsa', 'Long Yunus', 'Long Muhammad', 'Tuan Sulong', 'Bendang Badang', 'Nik Dah', 'Datuk Pengkalan'],
  OBR: ['Bolkiah', 'Muhyiddin', 'Kamaluddin', 'Omar Ali Saifuddin', 'Indera Mahkota', 'Pengiran Usop', 'Pengiran Muda Hashim', 'Brooke'],
  OSU: ['Kiram', 'Shahabuddin', 'Badaruddin', 'Alimuddin', 'Azimuddin', 'Israel', 'Datu Teteng', 'Jamalul Alam'],
  OMG: ['Kudarat', 'Barahaman', 'Kahar ud-Din', 'Bayan ul-Anwar', 'Pahar ud-Din', 'Kibad Sahriyal', 'Datu Uto', 'Mangigin'],
  OES: ['Bourbon', 'Cruzat y Góngora', 'Arandía', 'Anda y Salazar', 'Basco y Vargas', 'Aguilar', 'Raón', 'Ovando'],
  OBJ: ['Suriansyah', 'Tahmidullah', 'Tamjidullah', 'Sulaiman', 'Adam', 'Hidayatullah', 'Antasari', 'Kotawaringin'],
  OKU: ['Kartanegara', 'Idris', 'Muslihuddin', 'Salehuddin', 'Pasir', 'Berau', 'Bulungan', 'Wira Negara'],
  OSB: ['Sambas', 'Tanjungpura', 'Alkadrie', 'Landak', 'Menambon', 'Matan', 'Sintang', 'Lanfang'],
  OPT: ['Bragance', 'Hornay', 'Da Costa', 'Mendonça', 'Coutinho', 'Lobato', 'Teles de Meneses', 'Da Silva'],
};
// Bali partage la culture de cour javanaise ; Ternate, Tidore et Bornéo la culture malaise
const CULTURE = Object.fromEntries(Object.entries({ neerlandaise: 'ONL', javanaise: 'OMT OBT OBL', bugis: 'OGO', britannique: 'OGB', espagnole: 'OES', portugaise: 'OPT',
  moro: 'OSU OMG', malaise: 'OTE OTI OAC OMI OPL OJO OPK OKD OPA OBR OBJ OKU OSB' }).flatMap(([k, codes]) => codes.split(' ').map(c => [c, k])));
for (const [c, p] of Object.entries(PAYS)) Object.assign(p, { moyens: MOYENS[c], maisons: MAISONS[c], culture: CULTURE[c] });

// cultures nouvelles (prénoms et noms écrits à la française ; les « noms » sont ceux de chefs de guerre et de grands)
const CULTURES = {
  javanaise: {
    prenoms: ['Suryo', 'Joyo', 'Wiryo', 'Kusumo', 'Sastro', 'Prawiro', 'Mangun', 'Darmo', 'Said', 'Sujono'],
    prenoms_f: ['Kencana', 'Sekar', 'Ratna', 'Wulan', 'Sari', 'Ayu'],
    noms: ['Surapati', 'Trunojoyo', 'Diponegoro', 'Sentot', 'Mangkubumi', 'Mas Said', 'Kyai Maja', 'Danurejo', 'Cakraningrat', 'Natakusuma', 'Sumodiningrat', 'Kartodirjo', 'Pringgalaya', 'Mangkunegara', 'Ronggo', 'Wiroguno'],
  },
  malaise: {
    prenoms: ['Mahmud', 'Abdul Jalil', 'Muhammad', 'Ismail', 'Abdullah', 'Ibrahim', 'Yusuf', 'Hussein', 'Ali', 'Sulaiman'],
    prenoms_f: ['Siti', 'Puteri', 'Fatimah', 'Aminah', 'Zaleha', 'Mariam'],
    noms: ['Hang Tuah', 'Hang Jebat', 'Tun Perak', 'Laksamana Bentan', 'Raja Kecik', 'Tun Abdul Majid', 'Panglima Polem', 'Teuku Umar', 'Imam Bonjol', 'Tok Janggut', 'Dato Bahaman', 'Mat Kilau', 'Maharaja Lela', 'Dol Said', 'Tun Habib', 'Datuk Sagor'],
  },
  bugis: {
    prenoms: ['La Patau', 'La Maddukelleng', 'La Temmassonge', 'La Tenritappu', 'La Mappasessu', 'La Pawawoi', 'La Parenrengi', 'La Tenrisukki', 'La Mappanyukki', 'La Salewangeng'],
    prenoms_f: ['We Tenriawaru', 'We Batari Toja', 'We Imaniratu', 'We Fatimah', 'We Tenri Olle', 'We Maniratu'],
    noms: ['Arung Palakka', 'Karaeng Galesong', 'Daeng Marewah', 'Daeng Parani', 'Daeng Chelak', 'Raja Haji', 'Daeng Menambon', 'Karaeng Bontomarannu', 'Arung Singkang', 'Daeng Mangalle', 'Karaeng Karunrung', 'Arung Matoa', 'Petta Ponggawae', 'Daeng Kamboja', 'Karaeng Lengkese', 'Arung Pancana'],
  },
  moro: {
    prenoms: ['Kudarat', 'Alimuddin', 'Azimuddin', 'Israel', 'Jamalul', 'Muhammad', 'Bantilan', 'Pakir', 'Amirul', 'Harun'],
    prenoms_f: ['Tunina', 'Dayang Dayang', 'Sitti', 'Bai', 'Tarhata', 'Piandao'],
    noms: ['Datu Uto', 'Datu Ali', 'Panglima Hassan', 'Amilbangsa', 'Datu Teteng', 'Raja Bongsu', 'Datu Piang', 'Panglima Sayadi', 'Datu Kalun', 'Datu Mandi', 'Bantilan', 'Salikala', 'Datu Pulalun', 'Panglima Ating', 'Datu Kiram', 'Datu Muda'],
  },
};

export default {
  id: 'indes_orientales', geo: 11, nom: 'Indes orientales',
  cadre: { LON0: 94.8, LON1: 135, LAT0: -11.2, LAT1: 19.2, LAT_REF, KM: 5 }, // 893 × 675 cases, 0,60 million
  places: [200, 450],
  ENTIERS, COUPES, DETROITS, FLEUVES, NOM_LAC,
  // ports fluviaux de Bornéo sur des rivières absentes de la carte (Mentaya, Kapuas Murung, Berau)
  PORTS_ADMIS: ['Sampit|OBJ', 'Kuala Kapuas|OBJ', 'Berau|OKU'],
  NE: { rivieres: [], lacs: [] },
  PAYS,
  CULTURES,
};
