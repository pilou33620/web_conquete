// Le théâtre « Détroit de Madagascar » (géographie 10), théâtre commercial d'après le découpage d'Empire: Total War :
// le canal du Mozambique vers 1700, à 5 km la case. Lu par outils/theatre.mjs (voir outils/THEATRES.md) ; villes.json et
// epoques.json à côté. Estimations et choix d'auteur : frontières, fleuves, caractère des pays.
//
// Dans Empire, le détroit de Madagascar est une zone de mer avec des points de commerce ; ici c'est une carte terrestre :
// Madagascar et ses royaumes, la côte d'Afrique de Malindi à la baie de Lourenço Marques et son arrière-pays (Maravi,
// Rozvi), les Comores et les Mascareignes. Les points de commerce d'Empire deviennent des places « port commerce ».
// Choix pour les petits établissements :
//  - Île Maurice : le poste néerlandais (quelque 300 colons, abandonné en 1710, l'île française en 1715) est trop petit
//    pour un camp ; Maurice va aux Mascareignes françaises (MFR) avec Bourbon.
//  - Les repaires de pirates (île Sainte-Marie, baie d'Antongil) font un petit camp (MPI) : l'île Sainte-Marie (222 km²)
//    et le fond de la baie d'Antongil.
//  - Inhambane et la baie de Lourenço Marques : petites enclaves portugaises (retouches de 20 et 12 km de rayon).
//  - Les côtes portugaise et swahilie : une bande de 40 à 45 km le long du rivage (retouche par distance à la côte) ;
//    l'intérieur de la Tanzanie et du Kenya est hors jeu.
//  - Petites îles : Mafia, Pemba, Zanzibar, Nosy Be, les Comores, Maurice et la Réunion sont à l'échelle ; les îles
//    Éparses, Aldabra et Agaléga n'ont pas de place (terres hors jeu ou îlots sans ville).
// Le cadre s'arrête à 29° E : l'ouest du Zimbabwe (Bulawayo, Khami) est coupé, Danangombe, capitale rozvi, est dedans.

const LAT_REF = -15;
const KX = 111.32 * Math.cos(LAT_REF * Math.PI / 180), KY = 110.95; // comme geo.rs
// distance (km) d'un point à une ligne brisée [[lon, lat], …]
const dLigne = (ligne, lon, lat) => {
  let m = Infinity;
  for (let k = 0; k + 1 < ligne.length; k++) {
    const [ax, ay] = ligne[k], [bx, by] = ligne[k + 1];
    const ux = (bx - ax) * KX, uy = (by - ay) * KY, px = (lon - ax) * KX, py = (lat - ay) * KY, n = ux * ux + uy * uy;
    const t = n ? Math.max(0, Math.min(1, (px * ux + py * uy) / n)) : 0;
    m = Math.min(m, Math.hypot(px - t * ux, py - t * uy));
  }
  return m;
};
// la côte d'Afrique de l'Est, de Malindi à la baie de Lourenço Marques (de mémoire, à quelques km près)
const COTE = [[40.2, -2.9], [40.12, -3.22], [39.86, -3.68], [39.67, -4.05], [39.22, -4.66], [39.1, -5.07], [38.98, -5.43], [38.78, -6.04],
  [38.9, -6.44], [39.29, -6.8], [39.35, -7.5], [39.35, -7.85], [39.5, -8.95], [39.72, -10.0], [40.18, -10.27], [40.44, -10.47], [40.5, -11.3],
  [40.6, -12.35], [40.52, -12.97], [40.6, -14.0], [40.73, -15.03], [39.9, -16.23], [38.9, -16.95], [36.9, -17.88], [36.25, -18.8],
  [34.84, -19.83], [34.72, -20.15], [35.1, -20.95], [35.32, -22.0], [35.5, -23.0], [35.38, -23.86], [34.6, -24.6], [33.64, -25.05],
  [32.9, -25.6], [32.58, -25.97]];
const cote = (lon, lat, km) => dLigne(COTE, lon, lat) <= km;
const pres = (lon, lat, p, km) => Math.hypot((lon - p[0]) * KX, (lat - p[1]) * KY) <= km;
// le Zambèze dans la province de Tete : de Zumbo à Cahora Bassa vers 15,6° S, puis vers Tete et Sena
const nordZambeze = (lon, lat) => lat > (lon < 32.7 ? -15.6 : -15.6 - (lon - 32.7) * 0.64);

// ------------------------------------------------------------------ les pays de 1700
// Estimations et choix d'auteur : frontières de 1700 approchées par les pays et les régions d'aujourd'hui.
// « ~Nom » : terre hors jeu (lands).
const ENTIERS = {
  Malawi: 'MMV', Zimbabwe: 'MRZ', Comoros: 'MCO', Mauritius: 'MFR',
  'Dem. Rep. Congo': '~Afrique centrale', Burundi: '~Afrique centrale',
  'South Africa': '~Afrique australe', Botswana: '~Afrique australe', eSwatini: '~Afrique australe',
  Seychelles: '~Seychelles', 'Fr. S. Antarctic Lands': '~Îles Éparses',
};
const COUPES = {
  Madagascar: { carte: 'mg/mg-all', defaut: 'MBT',
    regions: { Analamanga: 'MME', Itasy: 'MME', Vakinankaratra: 'MME', // l'Imerina d'Andriamasinavalona et l'Andrantsay
      "Amoron'i Mania": 'MBE', 'Haute Matsiatra': 'MBE', Ihorombe: 'MBE', // les royaumes betsileo et le pays bara
      'Vatovavy-Fitovinany': 'MAM', 'Atsimo-Atsinanana': 'MAM', // le royaume antemoro de la Matitanana
      Anosy: 'MAN', Androy: 'MAN', 'Atsimo-Andrefana': 'MAN', // Antanosy, Antandroy, Mahafaly
      Menabe: 'MMN', Melaky: 'MMN', Bongolava: 'MMN', // le Menabe sakalava
      Boeny: 'MSA', Betsiboka: 'MSA', Sofia: 'MSA', Diana: 'MSA', // le Boina sakalava et le pays antankarana
      Atsinanana: 'MBT', Analanjirofo: 'MBT', Sava: 'MBT', 'Alaotra-Mangoro': 'MBT' }, // la côte betsimisaraka, Sihanaka
    retouche: (lon, lat, r) =>
      r === 'Analanjirofo' && (lon > 49.78 && lat < -16.6 || lat > -15.95) ? 'MPI' // l'île Sainte-Marie, la baie d'Antongil
      : r === 'Atsimo-Andrefana' && lat > -22.3 ? 'MMN' // le Fiherenana et le Mangoky : Sakalava du Menabe
      : null },
  Mozambique: { carte: 'mz/mz-all', defaut: 'MMV',
    regions: { Sofala: 'MPT', Manica: 'MRZ', Inhambane: 'MTS', Gaza: 'MTS', Maputo: 'MTS', Niassa: 'MMV' },
    retouche: (lon, lat, r) =>
      pres(lon, lat, [35.38, -23.86], 20) || pres(lon, lat, [32.58, -25.97], 12) ? 'MPT' // Inhambane, Lourenço Marques
      : r === 'Tete' ? (nordZambeze(lon, lat) ? 'MMV' : 'MPT') // les prazos du Zambèze ; au nord, le Maravi d'Undi
      : r === 'Zambezia' ? (lat < -16.9 || cote(lon, lat, 40) ? 'MPT' : 'MMV') // Quelimane et le bas Zambèze ; les Lomwe
      : (r === 'Nampula' || r === 'Cabo Delgado') && cote(lon, lat, 40) ? 'MPT' // la côte ; l'intérieur makua au Maravi de Lundu
      : null },
  Tanzania: { carte: 'tz/tz-all', defaut: '~Afrique orientale',
    regions: { 'Unguja Kusini': 'MOM', 'Unguja Kaskazini': 'MOM', 'Unguja Mjini Magharibi': 'MOM', 'Kaskazini Pemba': 'MOM', 'Kusini Pemba': 'MOM' },
    retouche: (lon, lat) => cote(lon, lat, 45) ? 'MOM' : null }, // la côte swahilie
  Kenya: { defaut: '~Afrique orientale', retouche: (lon, lat) => cote(lon, lat, 40) ? 'MOM' : null },
  Zambia: { carte: 'zm/zm-all', defaut: '~Afrique centrale', regions: { Eastern: 'MMV' } }, // le royaume chewa d'Undi
  France: { defaut: '~Îles Éparses', // Natural Earth met la Réunion et Mayotte dans la France
    retouche: (lon, lat) => lon > 54 ? 'MFR' : lon > 44.9 && lon < 45.4 && lat < -12.5 && lat > -13.1 ? 'MCO' : null },
};
// détroits : aucun à rouvrir (Zanzibar, Pemba, Mafia, Nosy Be et Sainte-Marie sont à plus de 7 km du rivage)
const DETROITS = [];

// ------------------------------------------------------------------ fleuves : estimations (source et embouchure, à 30 km près)
// [nom, rang (1 fleuve, 2 grande rivière, 3 rivière), [lon, lat] vers la source, [lon, lat] à l'embouchure ou au confluent,
// noms Natural Earth admis (facultatif)]. Le tracé est celui de Natural Earth (lignes de 10 m), suivi d'un point à l'autre.
const FLEUVES = [
  ['Zambèze', 1, [28.8, -16.5], [36.3, -18.7], /^Zambezi$/], ['Limpopo', 1, [27.0, -23.7], [33.53, -25.19], /^Limpopo$/],
  ['Shire', 2, [35.26, -14.5], [35.33, -17.7], /^Shire$/], ['Luangwa', 2, [33.17, -9.75], [30.41, -15.63], /^Luangwa$/],
  ['Save', 2, [31.12, -18.55], [35.11, -20.95], /^Save$/], ['Rovuma', 2, [35.6, -10.81], [40.44, -10.47], /^Ruvuma$/],
  ['Rufiji', 2, [37.27, -9.09], [39.25, -7.82], /^Rufiji$/], ['Lúrio', 3, [36.02, -14.99], [40.53, -13.51]],
  ['Pungwe', 3, [33.07, -18.34], [34.53, -19.62]], ['Pangani', 3, [37.45, -3.77], [38.98, -5.42], /^Pangani$/],
  ['Wami', 3, [36.17, -5.18], [38.85, -6.16], /^Wami$/],
  ['Betsiboka', 1, [47.84, -19.25], [46.47, -15.95], /^Betsiboka$/], ['Mangoky', 1, [47.17, -22.01], [43.54, -21.32], /^(Mangoky|Mananantanana)$/],
  ['Tsiribihina', 2, [47.67, -20.19], [44.41, -19.64], /^(Tsiribihina|Mania)$/], ['Onilahy', 2, [46.22, -23.08], [43.75, -23.57]],
  ['Maningory', 3, [48.04, -18.17], [49.46, -17.22], /^Maningory$/],
];
const NOM_LAC = { Malawi: 'Lac Malawi', Nyasa: 'Lac Malawi', Tanganyika: 'Lac Tanganyika', Alaotra: 'Lac Alaotra', Kariba: 'Lac Kariba' };

// ------------------------------------------------------------------ les pays : le format des camps du jeu (rules.rs, FACTIONS)
// Choix d'auteur, dans le ton des pays d'Europe. mods : seulement des clés que le moteur lit déjà.
const P = (name, short, adj, color, title, pros, cons, mods, [aggr, trade, expand, tech], specialty) =>
  ({ name, short, capital: '', color, adj, title, pros, cons, mods, personality: { aggr, trade, expand, tech }, specialty });
const PAYS = {
  MME: P('Royaume merina', 'Imerina', 'merina', '#b03a2e', 'Les Rois des Douze Collines', ['Rizières de la Betsimitatatra : vivres +25 %', 'Hautes terres : montagne +15 %', 'Corvée royale (fanompoana) : recrues +10 %'], ['Loin des côtes : accords commerciaux −15 %'],
    { vivres: 0.25, mountain: 0.15, recrues: 0.1, trade: -0.15 }, [0.6, 0.4, 0.85, 'agricole'], 'vivres'),
  MBE: P('Royaumes betsileo', 'Betsileo', 'betsileo', '#f7dc6f', 'Les Rizières en terrasses', ['Terrasses du Betsileo : vivres +20 %', 'Hautes terres : montagne +15 %'], ['Royaumes rivaux : livres −10 %', 'Industrie −15 %'],
    { vivres: 0.2, mountain: 0.15, livres: -0.1, industrie: -0.15 }, [0.35, 0.4, 0.4, 'agricole'], 'vivres'),
  MAM: P('Royaume antemoro', 'Antemoro', 'antemoro', '#7d3c98', 'Les Scribes du sorabe', ['Devins et scribes du sorabe : diplomatie +10', 'Rizières de la Matitanana : vivres +10 %'], ['Petit royaume : recrues −15 %', 'Industrie −15 %'],
    { diplo: 10, vivres: 0.1, recrues: -0.15, industrie: -0.15 }, [0.3, 0.55, 0.3, 'civil'], 'vivres'),
  MAN: P('Royaumes du Sud (Antanosy, Antandroy, Mahafaly)', 'Grand Sud', 'antanosy', '#a04000', 'Les Gardiens des zébus', ['Troupeaux du Sud : vivres +15 %', 'Brousse épineuse : embuscades +20 %', 'Gens du pays sec : usure −15 %'], ['Pays aride : recrues −10 %', 'Industrie −20 %'],
    { vivres: 0.15, ambush: 0.2, attrition: -0.15, recrues: -0.1, industrie: -0.2 }, [0.45, 0.45, 0.35, 'militaire'], 'vivres'),
  MMN: P('Royaume sakalava du Menabe', 'Menabe', 'sakalava', '#1f618d', 'Les Maroserana du Menabe', ['Guerriers sakalava : infanterie +10 %', 'Grands troupeaux : vivres +15 %', 'Fusils de traite : accords commerciaux +10 %'], ['Industrie −20 %'],
    { inf_power: 0.1, vivres: 0.15, trade: 0.1, industrie: -0.2 }, [0.65, 0.5, 0.6, 'militaire'], 'recrues'),
  MSA: P('Royaume sakalava du Boina', 'Boina', 'sakalava', '#28b463', 'Les Volamena de Majunga', ['Majunga, port des Antalaotra : accords commerciaux +25 %', 'Guerriers sakalava : infanterie +10 %', 'Ports +10 %'], ['Industrie −20 %'],
    { trade: 0.25, inf_power: 0.1, port: 0.1, industrie: -0.2 }, [0.6, 0.75, 0.55, 'militaire'], 'livres'),
  MBT: P('Confédération betsimisaraka', 'Betsimis.', 'betsimisaraka', '#e67e22', 'Les Nombreux Inséparables', ['Traite de Foulpointe et de Tamatave : accords commerciaux +20 %', 'Riz et bœufs pour les Mascareignes : vivres +15 %', 'Ports +10 %'], ['Chefferies divisées : recrues −10 %', 'Industrie −15 %'],
    { trade: 0.2, vivres: 0.15, port: 0.1, recrues: -0.1, industrie: -0.15 }, [0.4, 0.8, 0.45, 'civil'], 'vivres'),
  MPI: P('Repaires de Sainte-Marie', 'Pirates', 'flibustier', '#1c1c1c', 'Les Forbans de Sainte-Marie', ['Course : ports +30 %', 'Abordages : infanterie +10 %', 'Butin : livres +15 %'], ['Une île et une baie : recrues −30 %', 'Hors-la-loi : diplomatie −15'],
    { port: 0.3, inf_power: 0.1, livres: 0.15, recrues: -0.3, diplo: -15 }, [0.8, 0.6, 0.3, 'militaire'], 'livres'),
  MCO: P('Sultanats des Comores', 'Comores', 'comorien', '#48c9b0', "Les Sultans d'Anjouan", ['Escale des Indes : accords commerciaux +20 %', 'Boutres : ports +15 %'], ['Petites îles : recrues −25 %', 'Sultanats rivaux : infanterie −5 %'],
    { trade: 0.2, port: 0.15, recrues: -0.25, inf_power: -0.05 }, [0.3, 0.8, 0.25, 'civil'], 'livres'),
  MFR: P('Îles de France et de Bourbon', 'Mascareignes', 'français', '#2b3fc4', 'La Compagnie des Indes', ['Escale de la route des Indes : ports +25 %', 'Café et sucre : accords commerciaux +20 %', 'Corsaires de Port-Louis : livres +10 %'], ['Îles peu peuplées : recrues −30 %'],
    { port: 0.25, trade: 0.2, livres: 0.1, recrues: -0.3 }, [0.45, 0.85, 0.35, 'civil'], 'livres'),
  MPT: P("Capitainerie du Mozambique", 'Mozambique', 'portugais', '#1e8449', 'Les Rivières de Cuama', ['Or et ivoire du Zambèze : accords commerciaux +20 %', 'Forteresse de São Sebastião : fortifications +15 %', 'Prazos de la Couronne : vivres +10 %'], ['Fièvres et garnisons réduites : recrues −25 %', 'Usure +15 %'],
    { trade: 0.2, fort_bonus: 0.15, vivres: 0.1, recrues: -0.25, attrition: 0.15 }, [0.4, 0.8, 0.45, 'civil'], 'livres'),
  MOM: P("Sultanat d'Oman (côte swahilie)", 'Oman', 'omanais', '#c0392b', 'Les Imams de Mascate', ['Boutres de la mousson : accords commerciaux +25 %', 'Ports +15 %', 'Fort Jésus : fortifications +10 %'], ['Garnisons lointaines : recrues −15 %', 'Industrie −15 %'],
    { trade: 0.25, port: 0.15, fort_bonus: 0.1, recrues: -0.15, industrie: -0.15 }, [0.55, 0.85, 0.5, 'civil'], 'livres'),
  MMV: P('Empire maravi', 'Maravi', 'maravi', '#d68910', 'Le Kalonga et ses vassaux', ['Fer et ivoire : fer +20 %', 'Grands peuples : recrues +15 %'], ['Vassaux remuants (Lundu, Undi) : entretien des troupes +10 %', 'Industrie −20 %'],
    { fer: 0.2, recrues: 0.15, upkeep: 0.1, industrie: -0.2 }, [0.45, 0.45, 0.5, 'agricole'], 'fer'),
  MRZ: P('Empire rozvi', 'Rozvi', 'rozvi', '#873600', 'Les Changamire', ['Les Destructeurs : infanterie +12 %', "Or du plateau : livres +15 %", 'Grands troupeaux : vivres +10 %'], ['Industrie −20 %', 'Ni canons ni remparts : artillerie −15 %'],
    { inf_power: 0.12, livres: 0.15, vivres: 0.1, industrie: -0.2, art_power: -0.15 }, [0.7, 0.45, 0.55, 'militaire'], 'recrues'),
  MTS: P('Chefferies tsonga de la baie', 'Tsonga', 'tsonga', '#5dade2', 'Les Rois de la baie de Lourenço Marques', ["Ivoire de la baie : accords commerciaux +15 %", 'Pêche et cultures : vivres +15 %'], ['Chefferies divisées : recrues −10 %', 'Industrie −20 %'],
    { trade: 0.15, vivres: 0.15, recrues: -0.1, industrie: -0.2 }, [0.35, 0.6, 0.35, 'agricole'], 'vivres'),
};
// moyens de départ (armée de paix en milliers d'hommes au début de 1700, 1790, 1813 et 1870 ; trésor en multiples des
// 500 livres d'un département) : estimations de mémoire, ordres de grandeur (guerriers mobilisables, garnisons)
const MOYENS = {
  MME: [[5, 15, 20, 30], 0.5], // Andrianampoinimerina, puis l'armée de Radama
  MBE: [[6, 5, 4, 2], 0.3],
  MAM: [[3, 3, 3, 2], 0.25],
  MAN: [[5, 5, 5, 4], 0.25],
  MMN: [[15, 12, 10, 10], 0.4], // les Sakalava, première puissance de l'île vers 1700
  MSA: [[15, 12, 10, 5], 0.6],
  MBT: [[8, 10, 8, 4], 0.4],
  MPI: [[1.5, 0.5, 0.5, 0.5], 0.4], // quelques centaines de forbans vers 1700
  MCO: [[2, 2, 2, 2], 0.3],
  MFR: [[0.5, 3, 1.5, 2], 0.6],
  MPT: [[1, 2, 3, 3], 0.6], // garnisons et cipayes des prazos
  MOM: [[3, 3, 4, 5], 0.8],
  MMV: [[15, 10, 8, 6], 0.4],
  MRZ: [[4, 3, 3, 2], 0.5],
  MTS: [[5, 5, 5, 3], 0.25],
};
// maisons (la régnante de 1700 d'abord, écrites à la française) : dynasties, lignages et grandes familles ; plusieurs noms
// de chefferies sont des approximations d'auteur
const MAISONS = {
  MME: ['Andriamasinavalona', 'Zazamarolahy', 'Andriantompokoindrindra', 'Andrianamboninolona', 'Zanadralambo', 'Tsimahafotsy', 'Tsimiamboholahy', 'Andafiavaratra'],
  MBE: ['Andriamanalina', 'Lalangina', 'Isandra', 'Arindrano', 'Manandriana', 'Andrianonindranarivo', 'Raonimanalina', 'Zafimanarivo'],
  MAM: ['Anteony', 'Antalaotra', 'Anakara', 'Zafikazimambo', 'Zafimbolazy', 'Antemahazo', 'Ramakararo', 'Andriamaro'],
  MAN: ['Zafiraminia', 'Zafimanara', 'Andriantsiambany', 'Maroserana', 'Zafimanely', 'Andrianmanindry', 'Tsiongaly', 'Ramaka'],
  MMN: ['Maroserana', 'Andriandahifotsy', 'Volamena', 'Zafimbolafotsy', 'Andriamandresy', 'Ramitraho', 'Toera', 'Kamamy'],
  MSA: ['Volamena', 'Andriamandisoarivo', 'Andrianiveniarivo', 'Andriamahatindriarivo', 'Andrianahevenarivo', 'Ravahiny', 'Andriantsoli', 'Tsimandroho'],
  MBT: ['Tsikoa', 'Ratsimilaho', 'Zana-Malata', 'Ramanano', 'Zanahary', 'Iavy', 'Zakavola', 'Bety'],
  MPI: ['Tew', 'Baldridge', 'Avery', 'Misson', 'Kidd', 'England', 'Plantain', 'La Buse'],
  MCO: ['El-Masela', 'Abdallah', 'Alaoui', 'Chirazi', 'Mouigni Mkou', 'Salim', 'Ahmed', 'Andriantsoli'],
  MFR: ['Compagnie des Indes', 'La Bourdonnais', 'Poivre', 'Dumas', 'Decaen', 'Souillac', 'Malartic', 'de Bouvet'],
  MPT: ['Bragance', 'Sousa', 'Melo e Castro', 'Pereira do Lago', 'Saldanha de Albuquerque', 'Meneses', 'Caldas', 'Lacerda e Almeida'],
  MOM: ['Yaroubi', 'Bou Saïdi', 'Mazroui', 'Nabhani', 'Harthi', 'Barwani', 'Mandhiri', 'Riyami'],
  MMV: ['Phiri', 'Kalonga', 'Lundu', 'Undi', 'Kaphwiti', 'Mwase', 'Chulu', 'Banda'],
  MRZ: ['Changamire', 'Dombo', 'Moyo', 'Mutapa', 'Tohwechipi', 'Chirisamhuru', 'Gumboremvura', 'Mavudzi'],
  MTS: ['Tembe', 'Mpfumo', 'Maputo', 'Matola', 'Nyaka', 'Manhiça', 'Khosa', 'Mabota'],
};
const CULTURE = Object.fromEntries(Object.entries({ malgache: 'MME MBE MAM MAN MMN MSA MBT', britannique: 'MPI', swahilie: 'MCO MOM',
  francaise: 'MFR', portugaise: 'MPT', bantoue: 'MMV MRZ MTS' }).flatMap(([k, codes]) => codes.split(' ').map(c => [c, k])));
for (const [c, p] of Object.entries(PAYS)) Object.assign(p, { moyens: MOYENS[c], maisons: MAISONS[c], culture: CULTURE[c] });

// cultures nouvelles (prénoms et noms écrits à la française)
const CULTURES = {
  malgache: {
    prenoms: ['Andrianampoinimerina', 'Radama', 'Ramboasalama', 'Rainiharo', 'Ratsimilaho', 'Andriantsoli', 'Ramitraho', 'Rakotobe', 'Ratefy', 'Rainilaiarivony'],
    prenoms_f: ['Ranavalona', 'Rasoherina', 'Bety', 'Ravahiny', 'Rasalimo', 'Rabodo'],
    noms: ['Rainijohary', 'Rainimaharo', 'Rainisoa', 'Ratsimanisa', 'Rafaralahy', 'Rainilaimanga', 'Ravalontsalama', 'Raharo', 'Ramanetaka', 'Rainimahery', 'Rasanjy', 'Ravoninahitriniarivo', 'Rainandriamampandry', 'Rainingory', 'Ratsimamanga', 'Rabezandrina'],
  },
  swahilie: {
    prenoms: ['Saïd', 'Ali', 'Hassan', 'Abdallah', 'Mohammed', 'Salim', 'Hamad', 'Seif', 'Moubarak', 'Barghach'],
    prenoms_f: ['Fatouma', 'Mwana Mkisi', 'Salima', 'Aïcha', 'Mwanamwema', 'Zouhoura'],
    noms: ['Mazroui', 'Bou Saïdi', 'Barwani', 'Harthi', 'Riyami', 'Mandhiri', 'Nabhani', 'Busaïdi', 'Ghaïthi', 'Kharousi', 'Ismaïli', 'Hinawi', 'Moughairi', 'Shirazi', 'Hadrami', 'Lamu'],
  },
  bantoue: {
    prenoms: ['Dombo', 'Changamire', 'Kalonga', 'Lundu', 'Undi', 'Mwase', 'Chikanga', 'Makombe', 'Mutasa', 'Nyamhunga'],
    prenoms_f: ['Nehanda', 'Chiwoniso', 'Nyamazana', 'Mwali', 'Tendai', 'Chipo'],
    noms: ['Moyo', 'Phiri', 'Banda', 'Mbewe', 'Chulu', 'Tembe', 'Nyaka', 'Khosa', 'Mabota', 'Gumbo', 'Mutapa', 'Mkandawire', 'Zulu', 'Ngwenya', 'Sibanda', 'Ndlovu'],
  },
};

export default {
  id: 'madagascar', geo: 10, nom: 'Détroit de Madagascar',
  cadre: { LON0: 29, LON1: 58, LAT0: -27, LAT1: -3, LAT_REF, KM: 5 }, // 624 × 533 cases, 0,33 million
  places: [90, 220],
  ENTIERS, COUPES, DETROITS, FLEUVES, NOM_LAC,
  NE: { rivieres: [], lacs: [] },
  PAYS,
  CULTURES,
  // îles trop petites pour la grille, gardées chacune par une case de terre (outil : ILES) : [lon, lat, camp, nom]
  ILES: [[40.736, -15.034, 'MPT', 'Île de Mozambique'], [40.60, -12.35, 'MPT', 'Ibo']],
};
