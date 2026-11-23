// Le théâtre « Amérique » (géographie 6) : de la baie d'Hudson aux Caraïbes et à l'isthme de Panamá, de l'Atlantique
// aux Rocheuses, au départ de 1700, à 5 km la case, sur le découpage de la grande campagne d'Empire: Total War (2009) :
// ses factions et ses régions, avec leurs propriétaires de 1700. Lu par outils/theatre.mjs (voir outils/THEATRES.md) ;
// villes.json et epoques.json à côté. Estimations et choix d'auteur, écrits de mémoire : frontières, fleuves, caractère
// des pays, moyens, maisons, noms.
//
// Les régions d'Empire et leur camp (capitale de région entre parenthèses ; toutes sont des places de villes.json) :
//   Grande-Bretagne (AGB) : Terre de Rupert (Fort Albany), Terre-Neuve (Saint-Jean de Terre-Neuve), Jamaïque (Kingston),
//     Bahamas (Nassau), îles Sous-le-Vent (Saint-Jean d'Antigua), Barbade (Bridgetown), avec les Caïmans et les îles Turques
//   Treize Colonies (ATC, protectorat britannique) : Nouvelle-Angleterre (Boston), New York (New York), Pennsylvanie
//     (Philadelphie), Virginie (Williamsburg), Carolines (Charleston), Géorgie (Savannah)
//   Nouvelle-France (AFR) : Nouvelle-France (Québec), Acadie (Port-Royal), Pays-d'en-Haut (Kaministiquia),
//     Saint-Domingue (Cap-Français), îles du Vent (Fort-Royal), avec Plaisance à Terre-Neuve (française jusqu'en 1713)
//   Louisiane (ALO, protectorat français) : Louisiane (La Nouvelle-Orléans), Pays des Illinois (Kaskaskia)
//   Nouvelle-Espagne (AES, protectorat espagnol) : Mexique (Mexico), Yucatán (Mérida), Guatemala (Guatemala),
//     Texas (San Antonio), Nouveau-Mexique (Santa Fe) ; l'isthme de Panamá (Panamá) lui est rattaché
//   Cuba (ACU, la couronne d'Espagne aux îles) : Cuba (La Havane), Floride (Saint-Augustin), Santo Domingo (Santo
//     Domingo), Porto Rico (San Juan), Trinité-et-Tobago (Port-d'Espagne)
//   Provinces-Unies (ANL) : Curaçao (Willemstad), avec Aruba, Bonaire et Sint Maarten
//   Confédération iroquoise (AIR) : Iroquoisie (Onontagué), Ohio (Pittsburgh)
//   Hurons (AHU) : territoire huron (Ossossané), Michigan (Détroit)
//   Cherokees (ACH) : territoire cherokee (Chota), Kentucky (Lexington)
//   Inuits (AIN) : Labrador (Nain), Ungava (Kuujjuaq)
//   Nations des Plaines (APL) : Grandes Plaines (Villages mandanes), Comancheria (Palo Duro)
//   Pueblos (APU) : terres pueblos (Zuñi)
// Écarts voulus avec Empire (de mémoire, à vérifier sur le jeu) : les Treize Colonies et la Louisiane, protectorats
// d'Empire, sont des camps à part entière ; la Géorgie (fondée en 1733) est donnée aux Treize Colonies ; la Floride et
// les îles espagnoles forment un camp « Cuba » distinct de la Nouvelle-Espagne ; Panamá (du Pérou en 1700) est rattaché
// à la Nouvelle-Espagne faute de camp pour la Terre Ferme. Une région ne sert qu'à placer sa capitale : la frontière
// tracée est celle des camps, par états des États-Unis et provinces du Canada, avec des retouches (lon, lat).
// Îles : les Petites Antilles sont gardées ; les Bermudes (un chapelet d'îlots), Saint-Eustache, Saba, Navassa, Clipperton
// et les bancs de récifs, trop petits pour la grille, disparaissent (Saint-Eustache, l'entrepôt des années 1780, n'a donc
// pas de place) ; les Antilles danoises (Saint-Thomas) restent hors jeu.

// ------------------------------------------------------------------ les camps de 1700
// « ~Nom » : terre hors jeu (lands) : la Terre Ferme (Colombie, Venezuela), les Guyanes, les Rocheuses…
const ENTIERS = {
  Jamaica: 'AGB', Bahamas: 'AGB', 'Turks and Caicos Is.': 'AGB', 'Cayman Is.': 'AGB', Bermuda: 'AGB', Barbados: 'AGB',
  'Antigua and Barb.': 'AGB', 'St. Kitts and Nevis': 'AGB', Montserrat: 'AGB', Anguilla: 'AGB', 'British Virgin Is.': 'AGB',
  France: 'AFR', Haiti: 'AFR', 'St. Pierre and Miquelon': 'AFR', 'St-Martin': 'AFR', 'St-Barthélemy': 'AFR',
  Dominica: 'AFR', 'Saint Lucia': 'AFR', 'St. Vin. and Gren.': 'AFR', Grenada: 'AFR', // îles caraïbes « neutres », réclamées par la France
  Cuba: 'ACU', 'USNB Guantanamo Bay': 'ACU', 'Dominican Rep.': 'ACU', 'Puerto Rico': 'ACU', 'Trinidad and Tobago': 'ACU',
  Mexico: 'AES', Guatemala: 'AES', Belize: 'AES', Honduras: 'AES', 'El Salvador': 'AES', Nicaragua: 'AES', 'Costa Rica': 'AES', Panama: 'AES',
  Netherlands: 'ANL', Curaçao: 'ANL', Aruba: 'ANL', 'Sint Maarten': 'ANL', // (Netherlands : dans le cadre, Bonaire ; Saint-Eustache et Saba trop petites)
  Colombia: '~Terre Ferme', Venezuela: '~Terre Ferme', Guyana: '~Guyanes', Suriname: '~Guyanes',
  'U.S. Virgin Is.': '~Antilles danoises', 'U.S. Minor Outlying Is.': '~Navassa',
  'Clipperton I.': '~Récifs', 'Bajo Nuevo Bank': '~Récifs', 'Serranilla Bank': '~Récifs',
};
// le détroit de Belle-Isle : au nord-ouest de cette ligne, le Labrador ; au sud-est, l'île de Terre-Neuve
const labrador = (lon, lat) => lat > 51.25 + (lon + 57.2) / 3;
const COUPES = {
  'United States of America': { carte: 'us/us-all', defaut: 'APL',
    regions: {
      Maine: 'ATC', 'New Hampshire': 'ATC', Vermont: 'ATC', Massachusetts: 'ATC', 'Rhode Island': 'ATC', Connecticut: 'ATC',
      'New York': 'ATC', 'New Jersey': 'ATC', Pennsylvania: 'ATC', Delaware: 'ATC', Maryland: 'ATC', 'District of Columbia': 'ATC',
      Virginia: 'ATC', 'North Carolina': 'ATC', 'South Carolina': 'ATC', Georgia: 'ATC',
      Florida: 'ACU', Alabama: 'ACH', Tennessee: 'ACH', Kentucky: 'ACH',
      'West Virginia': 'AIR', Ohio: 'AIR', Indiana: 'AIR', Michigan: 'AHU', Wisconsin: 'AHU',
      Illinois: 'ALO', Missouri: 'ALO', Arkansas: 'ALO', Louisiana: 'ALO', Mississippi: 'ALO',
      Texas: 'AES', 'New Mexico': 'AES', Arizona: 'APU', Utah: '~Rocheuses' },
    retouche: (lon, lat, r) =>
      r === 'Maine' ? (lon > -69.3 || lat > 45.0 ? 'AFR' : null) // l'Acadie jusqu'au Kennebec
      : r === 'New York' ? (lon < -74.4 || (lat > 43.4 && lon < -73.45) ? 'AIR' : null) // l'Iroquoisie à l'ouest de Schenectady, les Adirondacks
      : r === 'Pennsylvania' ? (lon < -77.6 ? 'AIR' : null) // l'Ohio au-delà des Alleghanys
      : r === 'Virginia' ? (lon < -79.4 ? (lat > 37.6 ? 'AIR' : 'ACH') : null) // au-delà du Blue Ridge
      : r === 'North Carolina' ? (lon < -81.0 ? 'ACH' : null) // les villes du milieu et de la vallée
      : r === 'South Carolina' ? (lon < -82.3 ? 'ACH' : null) // les villes basses cherokees
      : r === 'Georgia' ? (lon > -83.0 && lat < 33.6 ? null : 'ACH') // la côte et Augusta ; l'intérieur aux Creeks et Cherokees
      : r === 'Alabama' ? (lat < 31.95 && lon < -86.5 ? 'ALO' : null) // Mobile
      : r === 'Texas' ? (lat > 33.0 && lon < -98.5 ? 'APL' : null) // le Llano Estacado, aux Comanches
      : r === 'New Mexico' ? (lon < -106.9 || lat > 36.2 ? 'APU' : lon > -104.2 ? 'APL' : null) // Zuñi, Acoma, Taos ; les plaines de l'est
      : r === 'Colorado' ? (lon < -105.3 ? '~Rocheuses' : null)
      : r === 'Minnesota' ? (lon > -93.5 && lat > 46.3 ? 'AHU' : null) // la pointe du lac Supérieur
      : null },
  Canada: { carte: 'ca/ca-all', defaut: 'AFR',
    regions: { Manitoba: 'AGB', 'Northwest Territories': 'AGB', Nunavut: 'AIN', Alberta: 'APL',
      'New Brunswick': 'AFR', 'Nova Scotia': 'AFR', 'Prince Edward Island': 'AFR' },
    retouche: (lon, lat, r) =>
      r === 'Ontario' ? (lat > 50.3 ? 'AGB' : lon > -78.6 || lat > 46.25 ? 'AFR' : 'AHU') // la baie James ; l'Outaouais et le Pays-d'en-Haut ; la Huronie
      : r === 'Québec' ? (lat > 55.0 ? 'AIN' : lon < -76.5 && lat > 49.8 ? 'AGB' : null) // l'Ungava ; la côte est de la baie James
      : r === 'Saskatchewan' ? (lat > 53.5 ? 'AGB' : 'APL')
      : r === 'Newfoundland and Labrador' ? (labrador(lon, lat) ? 'AIN' : lon > -56.0 && lon < -53.85 && lat < 47.55 ? 'AFR' : 'AGB') // Plaisance, française
      : null },
};
// détroits rouverts sur 7,5 km de large (la grille les fermerait)
const DETROITS = [
  ['Narrows de New York', [[-74.045, 40.655], [-74.045, 40.605], [-74.03, 40.565]]], // sinon la baie de New York devient un lac
  ['Détroit de Canso', [[-61.45, 45.70], [-61.41, 45.64], [-61.37, 45.60], [-61.33, 45.55]]], // l'île du Cap-Breton (Louisbourg)
];

// ------------------------------------------------------------------ fleuves : estimations (source et embouchure, à 30 km près)
// [nom, rang (1 fleuve, 2 grande rivière, 3 rivière), [lon, lat] vers la source, [lon, lat] à l'embouchure ou au confluent,
// noms Natural Earth admis pour ces deux points (facultatif)], ou [nom, rang, [[lon, lat], …]] écrit de mémoire.
const FLEUVES = [
  // Natural Earth arrête les fleuves à leurs estuaires (le Saint-Laurent dès le lac Saint-François, l'Hudson à Peekskill,
  // le Delaware à Philadelphie, le Potomac à Washington) : la suite est de l'eau, mer ou « bras de mer » ; le Saint-Laurent,
  // coupé en poches par la grille, est écrit à la main de Kingston à l'île d'Orléans (à quelques km près). Ni la James ni
  // le bas Churchill ne sont dans Natural Earth, la Canadian s'y arrête au lac Eufaula (retenue) : laissés de côté.
  ['Saint-Laurent', 1, [[-76.35, 44.15], [-75.95, 44.33], [-75.68, 44.52], [-75.45, 44.72], [-75.2, 44.88], [-74.73, 45.01], [-74.4, 45.15],
    [-74.1, 45.27], [-73.85, 45.35], [-73.62, 45.42], [-73.52, 45.5], [-73.45, 45.65], [-73.3, 45.85], [-73.12, 46.05], [-72.85, 46.2],
    [-72.55, 46.33], [-72.25, 46.45], [-71.95, 46.58], [-71.65, 46.66], [-71.35, 46.75], [-71.2, 46.81], [-71.0, 46.88], [-70.85, 46.98]]],
  ['Mississippi', 1, [-95.2, 47.24], [-91.15, 33.4], /^Mississippi$/], ['Bas Mississippi', 1, [-91.15, 33.4], [-89.25, 29.15], /^Mississippi$/], // (coupé à Greenville : d'un seul tenant, le tracé prendrait le Yazoo)
 
  ['Missouri', 1, [-111.5, 46.3], [-90.12, 38.81], /^Missouri$/], ['Ohio', 1, [-80.0, 40.44], [-89.13, 37.0], /^Ohio$/],
  ['Rio Grande', 1, [-107.0, 37.75], [-97.15, 25.95]],
  ['Hudson', 2, [-74.05, 43.95], [-73.95, 41.31], /^Hudson$/], ['Arkansas', 2, [-106.3, 39.1], [-91.05, 33.8], /^Arkansas$/],
  ['Tennessee', 2, [-83.85, 35.95], [-88.6, 37.07], /^Tennessee$/], ['Delaware', 2, [-75.28, 41.95], [-75.02, 40.02], /^Delaware$/],
  ['Potomac', 2, [-78.5, 39.45], [-77.07, 38.9], /^Potomac$/], ['Susquehanna', 2, [-74.9, 42.7], [-76.08, 39.55], /^Susquehanna$/],
  ['Outaouais', 2, [-79.45, 47.55], [-74.38, 45.56], /^Ottawa$/], ['Rivière Rouge', 2, [-100.9, 34.64], [-91.7, 31.0], /^Red$/],
  ['Rivière Rouge du Nord', 2, [-96.6, 46.3], [-96.8, 50.4], /^Red$/], ['Connecticut', 2, [-71.1, 45.2], [-72.35, 41.27], /^Connecticut$/],
  ['Platte', 2, [-100.7, 41.1], [-95.85, 41.05], /Platte/], ['Pecos', 2, [-105.5, 35.7], [-101.4, 29.7], /^Pecos$/],
  ['Brazos', 2, [-100.0, 33.2], [-95.4, 28.88], /^Brazos$/], ['Colorado du Texas', 2, [-101.5, 32.5], [-96.0, 28.6], /^Colorado$/],
  ['Saguenay', 2, [-71.75, 48.58], [-71.07, 48.44], /^Saguenay$/], ['Saint-Jean', 2, [-69.3, 47.3], [-66.05, 45.27], /^(Saint John|St\. John|Saint-Jean)$/],
  ['Usumacinta', 2, [-90.5, 16.5], [-92.5, 18.6]], ['Lerma-Santiago', 2, [-99.5, 19.3], [-105.4, 21.6]], ['Balsas', 2, [-98.5, 18.5], [-102.2, 17.95]],
  ['Nelson', 2, [-97.9, 53.7], [-92.8, 57.05], /^Nelson$/], ['Saskatchewan', 2, [-109.55, 53.42], [-99.3, 53.2], /Saskatchewan/],
  ['Albany', 2, [-89.68, 51.23], [-81.88, 52.19], /^Albany$/],
  ['Illinois', 2, [-88.2, 41.4], [-90.2, 38.97], /^Illinois$/], ['Wabash', 2, [-84.8, 40.4], [-88.1, 37.8], /^Wabash$/],
  ['Cumberland', 2, [-83.5, 36.9], [-88.4, 37.1], /^Cumberland$/], ['Yellowstone', 2, [-110.0, 45.6], [-104.0, 47.98], /^Yellowstone$/],
  ['Alabama', 2, [-86.3, 32.4], [-87.95, 31.15], /^Alabama$/], ['Tombigbee', 2, [-88.28, 34.71], [-87.94, 31.15], /^Tombigbee$/],
  ['Mobile', 2, [[-87.94, 31.15], [-87.97, 31.0], [-88.0, 30.85], [-88.03, 30.72]]], // absent de Natural Earth : du confluent à la baie de Mobile
  ['Savannah', 3, [-82.9, 34.4], [-80.9, 32.04], /^Savannah$/],
  ['Richelieu', 3, [-73.25, 45.1], [-73.12, 46.05]], ['Allegheny', 3, [-78.0, 41.9], [-80.0, 40.45], /^Allegheny$/],
  ['Mohawk', 3, [-75.4, 43.2], [-73.7, 42.78], /^Mohawk$/], ['Pánuco', 3, [-99.0, 21.5], [-97.85, 22.25]],
  ['Motagua', 3, [-90.5, 14.9], [-88.2, 15.9]], ['San Juan', 3, [-84.8, 11.1], [-83.7, 10.93]], ['Roanoke', 3, [-80.3, 37.2], [-76.7, 35.95], /^Roanoke$/],
];

// ------------------------------------------------------------------ les camps : le format du jeu (rules.rs, FACTIONS)
// moyens : armée sur pied en Amérique (milliers d'hommes) au début de 1700, 1790, 1813 et 1870 (un camp disparu garde
// son dernier état connu, comme en Europe ; les nations amérindiennes : leurs guerriers), trésor en multiples de
// 500 livres ; maisons : la régnante de 1700 d'abord (les nations amérindiennes : leurs nations, bandes ou clans).
const P = (name, short, adj, color, title, pros, cons, mods, [aggr, trade, expand, tech], specialty, moyens, maisons, culture) =>
  ({ name, short, capital: '', color, adj, title, pros, cons, mods, personality: { aggr, trade, expand, tech }, specialty, moyens, maisons, culture });
const PAYS = {
  AGB: P('Amérique de la couronne britannique', 'G.-Bretagne', 'britannique', '#c0392b', "Les Îles à sucre et la baie d'Hudson",
    ['Sucre des Antilles : accords commerciaux +25 %', 'La Royal Navy : ports +25 %', "Compagnie de la baie d'Hudson : bois +15 %"],
    ['Garnisons éparses : recrues −25 %'],
    { trade: 0.25, port: 0.25, bois: 0.15, recrues: -0.25 }, [0.5, 0.9, 0.5, 'civil'], 'livres',
    [[3, 8, 15, 10], 2], ['Stuart', 'Hanovre', 'Codrington', 'Beckford', 'Lascelles', 'Modyford', 'Knowles', 'Rodney'], 'britannique'),
  ATC: P('Les Treize Colonies', 'Treize Col.', 'américain', '#d35d6e', 'Les Colons de la Nouvelle-Angleterre à la Géorgie',
    ['Terres neuves : vivres +20 %', 'Colons nombreux : recrues +15 %', 'Forêts : bois +20 %'],
    ['Milices : infanterie −5 %', 'Fortifications −10 %'],
    { vivres: 0.2, recrues: 0.15, bois: 0.2, inf_power: -0.05, fort_bonus: -0.1 }, [0.5, 0.75, 0.85, 'agricole'], 'vivres',
    [[2, 3, 35, 37], 1.5], ['Penn', 'Winthrop', 'Calvert', 'Livingston', 'Byrd', 'Randolph', 'Adams', 'Washington'], 'americaine'),
  AFR: P('Nouvelle-France', 'N.-France', 'canadien', '#2b3fc4', "Le Canada, l'Acadie et les Îles",
    ['Coureurs des bois et petite guerre : embuscades +25 %', 'Alliances indiennes : diplomatie +10', 'Sucre de Saint-Domingue : accords commerciaux +15 %'],
    ['Colonie peu peuplée : recrues −30 %'],
    { ambush: 0.25, diplo: 10, trade: 0.15, recrues: -0.3 }, [0.55, 0.7, 0.6, 'militaire'], 'livres',
    [[2, 4, 2, 3], 2], ['Bourbon', 'de Callière', 'Rigaud de Vaudreuil', 'de Buade de Frontenac', 'Le Moyne', 'de Beauharnois', 'de La Galissonière', 'de Montcalm'], 'francaise'),
  ALO: P('Louisiane', 'Louisiane', 'louisianais', '#7fb3d5', 'Le Fleuve et le Pays des Illinois',
    ['Terres du Fleuve : vivres +15 %', 'Commerce du Mississippi : accords commerciaux +15 %', 'Gens des bayous : usure des marais −30 %'],
    ['Colonie naissante : recrues −30 %', 'Livres −10 %'],
    { vivres: 0.15, trade: 0.15, marsh_attr: -0.3, recrues: -0.3, livres: -0.1 }, [0.35, 0.7, 0.5, 'agricole'], 'vivres',
    [[0.5, 1.5, 1, 1], 0.3], ['Le Moyne de Bienville', 'de La Mothe-Cadillac', 'Périer', 'de Kerlérec', "d'Abbadie", 'de Boisbriand', 'Dubreuil', 'de Macarty'], 'francaise'),
  AES: P('Vice-royauté de Nouvelle-Espagne', 'N.-Espagne', 'mexicain', '#e0a526', "L'Argent de Zacatecas et de Guanajuato",
    ["Argent des mines : livres +25 %", 'Dragons de cuir des présidios : cavalerie +10 %'],
    ['Industrie −15 %', 'Savoirs lents à venir : recherche −10 %'],
    { livres: 0.25, cav_power: 0.1, industrie: -0.15, research_speed: -0.1 }, [0.45, 0.6, 0.6, 'civil'], 'livres',
    [[3, 10, 40, 25], 3], ['Bourbon', 'Sarmiento de Valladares', 'Fernández de la Cueva', 'de Revillagigedo', 'de Bucareli', 'de Gálvez', 'de Iturrigaray', 'Calleja'], 'espagnole'),
  ACU: P('Capitainerie générale de Cuba', 'Cuba', 'cubain', '#f4d03f', 'La Clé du Nouveau Monde',
    ['El Morro et la Cabaña : fortifications +20 %', "L'Arsenal de La Havane : ports +20 %", 'Tabac et sucre : accords commerciaux +10 %'],
    ['Îles et garnisons : recrues −20 %'],
    { fort_bonus: 0.2, port: 0.2, trade: 0.1, recrues: -0.2 }, [0.4, 0.7, 0.4, 'militaire'], 'livres',
    [[3, 6, 10, 80], 1.5], ['Bourbon', 'de Córdoba', 'Güemes y Horcasitas', 'de Prado', 'de Ricla', 'de las Casas', 'de Someruelos', 'Tacón'], 'espagnole'),
  ANL: P('Antilles des Provinces-Unies', 'Prov.-Unies', 'hollandais', '#e67e22', 'Les Rouliers des Caraïbes',
    ['Ports francs : accords commerciaux +35 %', 'Compagnie des Indes occidentales : livres +15 %', 'Ports +15 %'],
    ['Quelques îles : recrues −35 %', 'Vivres −20 %'],
    { trade: 0.35, livres: 0.15, port: 0.15, recrues: -0.35, vivres: -0.2 }, [0.15, 0.95, 0.2, 'civil'], 'livres',
    [[0.5, 1, 1, 0.5], 1], ['Orange-Nassau', 'Beck', 'Faesch', 'Rodier', 'de Graaff', 'Lauffer', 'Van Uytrecht', 'Heinsius'], 'neerlandaise'),
  AIR: P('Confédération iroquoise', 'Iroquois', 'iroquois', '#6b8e23', 'Les Cinq Nations de la Maison longue',
    ['Guerre des bois : embuscades +30 %', 'Marches silencieuses : discrétion', 'La Grande Paix et le Covenant Chain : diplomatie +10'],
    ['Ni canons ni remparts : artillerie −30 %, fortifications −20 %', 'Industrie −30 %'],
    { ambush: 0.3, stealth: 1, diplo: 10, art_power: -0.3, fort_bonus: -0.2, industrie: -0.3 }, [0.65, 0.5, 0.6, 'militaire'], 'recrues',
    [[2, 1.5, 1, 0.5], 0.2], ['des Onontagués', 'des Agniers', 'des Tsonnontouans', 'des Goyogouins', 'des Onneiouts', 'des Tuscaroras', 'de la Tortue', 'du Loup'], 'iroquoise'),
  AHU: P('Confédération huronne', 'Hurons', 'huron', '#1abc9c', 'Les Wendats des Grands Lacs',
    ['Traite des fourrures : accords commerciaux +20 %', 'Canots des Grands Lacs : routes +10 %', 'Embuscades +20 %'],
    ['Peuple décimé : recrues −25 %', 'Artillerie −30 %', 'Industrie −30 %'],
    { trade: 0.2, road_speed: 0.1, ambush: 0.2, recrues: -0.25, art_power: -0.3, industrie: -0.3 }, [0.4, 0.75, 0.4, 'agricole'], 'vivres',
    [[1, 0.8, 0.5, 0.3], 0.2], ['des Tionontatés', 'des Attignawantans', 'des Attigneenongnahacs', 'des Arendarhonons', 'des Tahontaenrats', 'des Ataronchronons', 'de Lorette', 'du Détroit'], 'huronne'),
  ACH: P('Nation cherokee', 'Cherokees', 'cherokee', '#8e44ad', 'Les Gens des Montagnes bleues',
    ['Gens des Appalaches : montagne +20 %', 'Embuscades +25 %', 'Maïs des vallées : vivres +15 %'],
    ['Artillerie −30 %', 'Fortifications −15 %', 'Industrie −25 %'],
    { mountain: 0.2, ambush: 0.25, vivres: 0.15, art_power: -0.3, fort_bonus: -0.15, industrie: -0.25 }, [0.55, 0.55, 0.5, 'agricole'], 'vivres',
    [[5, 2.5, 2, 1], 0.2], ['du Loup', 'du Cerf', "de l'Oiseau", 'de la Peinture', 'des Longs-Cheveux', 'de la Pomme-de-Terre', 'du Ciel-Bleu', 'de Chota'], 'cherokee'),
  AIN: P('Nations inuites', 'Inuits', 'inuit', '#d0e4f5', 'Les Chasseurs du Grand Nord',
    ['Gens du froid : usure −40 %', 'Kayaks et chasse au phoque : vivres +10 %', 'Embuscades +15 %'],
    ['Peuple clairsemé : recrues −40 %', 'Artillerie −40 %', 'Industrie −40 %'],
    { attrition: -0.4, vivres: 0.1, ambush: 0.15, recrues: -0.4, art_power: -0.4, industrie: -0.4 }, [0.2, 0.4, 0.2, 'civil'], 'vivres',
    [[0.5, 0.5, 0.5, 0.5], 0.1], ['des Labradormiut', 'des Tarramiut', 'des Itivimiut', 'des Siqinirmiut', 'des Paallirmiut', 'des Ahiarmiut', 'des Qairnirmiut', 'des Aivilingmiut'], 'inuit'),
  APL: P('Nations des Plaines', 'Plaines', 'des Plaines', '#8d6e4a', 'Les Chasseurs de bisons',
    ['Cavaliers des Plaines : cavalerie +20 %', 'Razzias : embuscades +25 %', 'Gens de la prairie : usure −20 %'],
    ['Ni canons ni remparts : artillerie −30 %, fortifications −20 %', 'Industrie −35 %'],
    { cav_power: 0.2, ambush: 0.25, attrition: -0.2, art_power: -0.3, fort_bonus: -0.2, industrie: -0.35 }, [0.75, 0.35, 0.6, 'militaire'], 'recrues',
    [[8, 10, 10, 6], 0.2], ['des Lakotas', 'des Comanches', 'des Cheyennes', 'des Pawnees', 'des Kiowas', 'des Arapahos', 'des Osages', 'des Corbeaux'], 'plaines'),
  APU: P('Pueblos', 'Pueblos', 'pueblo', '#d35400', 'Les Villages des Mesas',
    ['Villages perchés : fortifications +20 %', 'Gens du désert : usure −20 %', 'Maïs irrigué : vivres +10 %'],
    ['Peu nombreux : recrues −30 %', 'Artillerie −30 %', 'Industrie −25 %'],
    { fort_bonus: 0.2, attrition: -0.2, vivres: 0.1, recrues: -0.3, art_power: -0.3, industrie: -0.25 }, [0.3, 0.5, 0.25, 'agricole'], 'vivres',
    [[1.5, 1, 1, 0.5], 0.1], ['de Zuñi', "d'Acoma", 'de Taos', 'des Hopis', 'de Laguna', 'de Jemez', 'de Picuris', 'de Santo Domingo'], 'pueblo'),
};

// ------------------------------------------------------------------ cultures nouvelles (prénoms et noms écrits à la française)
// La Nouvelle-France et la Louisiane prennent les noms des départements (« francaise »), les colonies britanniques et
// espagnoles ceux de leur métropole. Noms amérindiens : transcriptions françaises ou anglaises usuelles, traduits
// quand l'usage français les traduit (Nuage-Rouge, Taureau-Assis).
const CULTURES = {
  americaine: {
    prenoms: ['Jean', 'Guillaume', 'Thomas', 'Samuel', 'Benjamin', 'Nathanaël', 'Josué', 'Israël', 'Daniel', 'Jonathan'],
    prenoms_f: ['Abigaïl', 'Marthe', 'Marie', 'Élisabeth', 'Sarah', 'Dorothée'],
    noms: ['Washington', 'Greene', 'Knox', 'Putnam', 'Wayne', 'Morgan', 'Gates', 'Schuyler', 'Lincoln', 'Sullivan', 'Stark', 'Arnold', 'Jackson', 'Scott', 'Harrison', 'Lee'],
  },
  iroquoise: {
    prenoms: ['Teganissorens', 'Garakontié', 'Théyanoguin', 'Thayendanegea', 'Sagoyewatha', 'Kaiiontwako', 'Ganiodaio', 'Tanaghrisson', 'Shikellamy', 'Skenandoah'],
    prenoms_f: ['Kateri', 'Jigonsasé', 'Aliquippa', 'Konwatsitsiaienni', 'Kahente', 'Ohnenhsa'],
    noms: ['Teganissorens', 'Garakontié', 'Decanisora', 'Théyanoguin', 'Thayendanegea', 'Kayashuta', 'Sayenqueraghta', 'Kaiiontwako',
      'Sagoyewatha', 'Tanaghrisson', 'Shikellamy', 'Skenandoah', 'Ganiodaio', 'Deseronto', 'Teyoninhokarawen', 'Kanonraron'],
  },
  huronne: {
    prenoms: ['Joseph', 'Étienne', 'Eustache', 'Nicolas', 'Michel', 'Louis', 'François', 'Pierre', 'Ignace', 'Jacques'],
    prenoms_f: ['Marie', 'Catherine', 'Thérèse', 'Cécile', 'Marguerite', 'Angélique'],
    noms: ['Kondiaronk', 'Orontony', 'Tarhe', 'Sastaretsi', 'Ahasistari', 'Annaotaha', 'Atironta', 'Taondechoren',
      'Tsawenhohi', 'Sioui', 'Gros-Louis', 'Picard', 'Vincent', 'Bastien', 'Romain', 'Teouatirhon'],
  },
  cherokee: {
    prenoms: ['Attakullakulla', 'Oconostota', 'Ostenaco', 'Kanagatucko', 'Tsiyu', 'Sequoyah', 'Ookoonaka', 'Jean', 'Jacques', 'Élie'],
    prenoms_f: ['Nanyehi', 'Quatie', 'Wurteh', 'Ahyoka', 'Sarah', 'Catherine'],
    noms: ['Moytoy', 'Attakullakulla', 'Oconostota', 'Ostenaco', 'Tsiyu Gansini', 'Kanagatucko', 'Doublehead', 'Ridge',
      'Ross', 'Watie', 'Boudinot', 'Vann', 'Bowl', 'Pathkiller', 'Hicks', 'Junaluska'],
  },
  inuit: {
    prenoms: ['Tuglavina', 'Attuiock', 'Karpik', 'Kingminguse', 'Ittuq', 'Pualla', 'Angutik', 'Qumaq', 'Nuvuk', 'Siku'],
    prenoms_f: ['Mikak', 'Caubvick', 'Ikuma', 'Nuliajuk', 'Arnaq', 'Pana'],
    noms: ['Tuglavina', 'Attuiock', 'Karpik', 'Kingminguse', 'Mikak', 'Caubvick', 'Siksik', 'Ittuq',
      'Angutik', 'Qumaq', 'Pualla', 'Nanuk', 'Uqsuralik', 'Tulugaq', 'Amaruq', 'Kallak'],
  },
  plaines: {
    prenoms: ['Grand-Ours', 'Aigle-Noir', 'Bison-Blanc', 'Élan-Debout', 'Petit-Corbeau', 'Tonnerre-Gris', 'Faucon-Rouge', "Plume-d'Aigle", 'Vent-du-Nord', 'Loup-Gris'],
    prenoms_f: ['Belle-Aurore', 'Oiseau-Chanteur', 'Biche-Blanche', 'Lune-Montante', 'Plume-Rouge', 'Petite-Colombe'],
    noms: ['Nuage-Rouge', 'Taureau-Assis', 'Cheval-Fou', 'Queue-Tachetée', 'Bouilloire-Noire', 'Couteau-Émoussé', 'Quanah', 'Satanta',
      'Corne-Verte', 'Gall', 'Ours-Debout', 'Petit-Loup', 'Grand-Arbre', 'Loup-Solitaire', 'Cheval-Américain', 'Nez-Romain'],
  },
  pueblo: {
    prenoms: ['Popé', 'Tupatú', 'Catiti', 'Jaca', 'Antoine', 'Dominique', 'François', 'Louis', 'Joseph', 'Laurent'],
    prenoms_f: ['Marie', 'Thérèse', 'Anne', 'Josèphe', 'Agnès', 'Catherine'],
    noms: ['Popé', 'Tupatú', 'Catiti', 'Jaca', 'Malacate', 'Naranjo', 'Ollita', 'Lololomai',
      'Yukioma', 'Tawaquaptewa', 'Palowahtiwa', 'Tsadiasi', 'Abeita', 'Chavez', 'Romero', 'Lucero'],
  },
};

export default {
  id: 'amerique', geo: 6, nom: 'Amérique',
  // 1 018 × 1 199 cases = 1,22 million (beaucoup de mer) ; LAT_REF au milieu des colonies
  cadre: { LON0: -110, LON1: -52, LAT0: 7, LAT1: 61, LAT_REF: 38, KM: 5 },
  places: [500, 900], // 629 en 2026-11 (13 camps, beaucoup de déserts)
  ENTIERS, COUPES, DETROITS, FLEUVES,
  NE: { rivieres: ['ne_10m_rivers_north_america'], lacs: ['ne_10m_lakes_north_america'] },
  PAYS,
  CULTURES,
};
