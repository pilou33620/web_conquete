// Théâtre « Côte de l'Ivoire » (géographie 8) : le golfe de Guinée vers 1700-1750, de la Sierra Leone au Cameroun,
// à 5 km la case. Lu par outils/theatre.mjs (même forme que la tête d'outils/europe.mjs).
// Découpage repris d'Empire: Total War (théâtre commercial de la Côte de l'Ivoire), mais en carte terrestre : les puissances
// de 1700 de la côte et de l'arrière-pays, et les comptoirs européens. Les points de commerce d'Empire deviennent des
// places portuaires (étiquettes « port commerce » de villes.json).
// Estimations et choix d'auteur, de mémoire : frontières approchées par les pays et les régions d'aujourd'hui.
//
// Comptoirs européens (trop petits pour la grille) : chacun est un camp fait de petites enclaves côtières, une par fort
// (boîtes de 10 à 20 km de côte, ci-dessous FORTS) : Provinces-Unies (Elmina, Axim, Shama, Apam), Grande-Bretagne (Cape
// Coast et Anomabu, Dixcove, Winneba), Danemark (Christiansborg, Ningo, Ada, Keta : les forts danois de 1790). Le Portugal
// garde les îles (São Tomé, Príncipe, Fernando Pó, portugaise jusqu'en 1778). Les forts français (Saint-Louis de Juda,
// Assinie de 1701 à 1705) et brandebourgeois (Groß Friedrichsburg, 1683-1717) n'ont pas de camp : trop peu de places ;
// Ouidah et Princes Town restent à leurs royaumes.
// Différences avec Empire : Empire n'a ici qu'une mer à comptoirs ; on y ajoute les royaumes de la côte et de l'intérieur.

// [ouest, est, latitude max (la côte au sud), camp] : enclaves des forts sur la côte de l'Or (Ghana)
const FORTS = [
  [-2.32, -2.16, 4.98, 'GNL'], [-1.68, -1.56, 5.10, 'GNL'], [-1.42, -1.31, 5.17, 'GNL'], [-0.80, -0.70, 5.36, 'GNL'], // Axim, Shama, Elmina, Apam
  [-2.02, -1.88, 4.92, 'GGB'], [-1.29, -1.08, 5.24, 'GGB'], [-0.67, -0.55, 5.42, 'GGB'], // Dixcove, Cape Coast et Anomabu, Winneba
  [-0.19, -0.10, 5.62, 'GDN'], [0.10, 0.26, 5.85, 'GDN'], [0.55, 0.72, 5.88, 'GDN'], [0.92, 1.06, 6.00, 'GDN'], // Christiansborg, Ningo, Ada, Keta
];
const fort = (lon, lat) => (FORTS.find(f => lon >= f[0] && lon <= f[1] && lat <= f[2]) || [])[3] || null;
const NORD = '~Savanes du Nord';

const ENTIERS = {
  'Sierra Leone': 'GVE', Liberia: 'GVE', 'São Tomé and Principe': 'GPT',
  Guinea: '~Fouta-Djalon', Mali: NORD, 'Burkina Faso': NORD, Gabon: '~Gabon',
};
const COUPES = {
  "Côte d'Ivoire": { carte: 'ci/ci-all', defaut: 'GAN',
    regions: { 'Bas-Sassandra': 'GVE', 'Moyen-Cavally': 'GVE', 'Dix-Huit Montagnes': 'GVE', 'Haut-Sassandra': 'GVE', Fromager: 'GVE', 'Sud-Bandama': 'GVE',
      Savanes: 'GKO', 'Denguélé': 'GKO', Bafing: 'GKO', Worodougou: 'GKO', Zanzan: 'GAS' } }, // Zanzan : le Gyaman (Bondoukou), conquis par l'Ashanti en 1740
  Ghana: { carte: 'gh/gh-all', defaut: 'GAK',
    regions: { Western: 'GDY', Central: 'GFA', Ashanti: 'GAS', 'Brong Ahafo': 'GAS', Northern: 'GDG', 'Upper East': 'GDG', 'Upper West': 'GDG' },
    retouche: (lon, lat, r) => fort(lon, lat)
      || (r === 'Central' && lat > 5.65 && lon < -1.35 ? 'GDY' : null) // le cœur du Denkyira (Abankeseso, Dunkwa)
      || (r === 'Volta' && lat > 7.3 ? 'GDG' : null) },
  Togo: { carte: 'tg/tg-all', defaut: 'GDG', regions: { Maritime: 'GHU', Plateaux: 'GAK' } }, // l'Akwamu tient le pays éwé (1702-1730)
  Benin: { carte: 'bj/bj-all', defaut: '~Borgou',
    regions: { Atlantique: 'GHU', Littoral: 'GHU', Mono: 'GHU', 'Ouémé': 'GHU', Zou: 'GDA', Collines: 'GDA', Kouffo: 'GDA', Plateau: 'GOY' },
    retouche: (lon, lat, r) => r === 'Atlantique' && lat > 6.55 ? 'GDA' : null }, // Allada au Dahomey (1724)
  Nigeria: { carte: 'ng/ng-all', defaut: NORD,
    regions: { Oyo: 'GOY', Ogun: 'GOY', Osun: 'GOY', Kwara: 'GOY', Ekiti: 'GOY', Lagos: 'GBE', Ondo: 'GBE', Edo: 'GBE', Delta: 'GBE',
      Anambra: 'GAR', Enugu: 'GAR', Imo: 'GAR', Abia: 'GAR', Ebonyi: 'GAR', Rivers: 'GDL', Bayelsa: 'GDL', 'Akwa Ibom': 'GDL', 'Cross River': 'GDL' },
    retouche: (lon, lat, r) => r === 'Lagos' && lon < 3.1 ? 'GHU' : null }, // Badagry, port des Popo
  Cameroon: { carte: 'cm/cm-all', defaut: '~Forêt équatoriale',
    regions: { Littoral: 'GDU', 'Sud-Ouest': 'GDU', Ouest: 'GBM', 'Nord-Ouest': 'GBM', Adamaoua: '~Adamaoua', Nord: '~Adamaoua', 'Extrême-Nord': '~Adamaoua' } },
  'Eq. Guinea': { defaut: '~Gabon', retouche: (lon, lat) => lon < 9.1 && lat > 3.0 ? 'GPT' : null }, // Fernando Pó (Bioko)
};
const DETROITS = [];

// [nom, rang, [lon, lat] vers la source, [lon, lat] à l'embouchure ou au confluent, noms Natural Earth admis], ou points à la main
const FLEUVES = [
  ['Niger', 1, [3.45, 11.88], [6.08, 4.30], /^Niger$/], ['Bénoué', 1, [12.5, 9.35], [6.78, 7.80], /^(Benue|Bénoué)$/],
  ['Volta', 1, [-2.75, 10.9], [0.68, 5.78], /^(Volta|Mouhoun)$/], ['Volta Blanche', 2, [-0.45, 11.05], [-0.98, 8.66], /^Nakanb/],
  ['Oti', 2, [1.4, 10.6], [0.08, 7.57], /^Oti$/],
  ['Comoé', 2, [-5.4, 10.6], [-3.72, 5.22], /^Komo/], ['Bandama', 2, [-6.1, 9.4], [-5.0, 5.15], /^Bandama/], ['Sassandra', 2, [-7.15, 9.6], [-6.08, 4.98], /^Sassandra$/],
  ['Ouémé', 2, [2.55, 10.0], [2.45, 6.42], /^Ou.m.$/], ['Ogun', 3, [3.5, 8.7], [3.4, 6.62], /^Ogun$/],
  ['Sanaga', 2, [12.5, 4.9], [9.85, 3.6], /^Sanaga$/], ['Mbam', 3, [11.95, 7.0], [11.2, 4.5], /^Mbam$/],
  ['Saint-Paul', 3, [-9.2, 8.7], [-10.8, 6.4], /^St\. Paul$/], ['Rokel', 3, [-11.0, 9.6], [-12.9, 8.6], /^Rokel$/], ['Cess', 3, [-8.4, 7.4], [-9.55, 5.5], /^Cess$/],
  // absente de Natural Earth : de mémoire, à quelques km près
  ['Cross', 2, [[9.75, 5.62], [9.3, 5.75], [8.75, 5.97], [8.33, 6.08], [8.05, 5.95], [7.95, 5.6], [7.98, 5.2], [8.2, 5.0], [8.32, 4.85], [8.4, 4.62]]],
];
const NE = { rivieres: [], lacs: [] }; // pas de fichier régional Natural Earth pour l'Afrique
const PORTS_ADMIS = ['Gwato|GBE']; // le port de Bénin, sur la crique de la rivière Bénin (trop étroite pour la carte)

const P = (name, short, adj, color, title, pros, cons, mods, [aggr, trade, expand, tech], specialty, moyens, maisons, culture) =>
  ({ name, short, color, adj, title, pros, cons, mods, personality: { aggr, trade, expand, tech }, specialty, moyens, maisons, culture });
// moyens : [armée en milliers d'hommes au début de 1700, 1790, 1813, 1870], trésor (multiple des 500 livres d'un département).
// Estimations de mémoire, ordres de grandeur ; un camp absorbé garde l'armée de son dernier état connu.
const PAYS = {
  GVE: P('Chefferies de la Côte du Vent', 'Côte du Vent', 'kru', '#8d6e63', 'La Côte des Graines et des Dents', ['Malaguette et ivoire : accords commerciaux +15 %', 'Forêts : embuscades +20 %'], ['Chefferies divisées : recrues −15 %', 'Industrie −20 %'],
    { trade: 0.15, ambush: 0.2, recrues: -0.15, industrie: -0.2 }, [0.3, 0.7, 0.3, 'civil'], 'bois', [[5, 5, 5, 5], 0.2],
    ['Farma', 'Massaquoi', 'Caulker', 'Tucker', 'Cleveland', 'Rogers', 'Naimbanna', 'Bai Bureh'], 'mande'),
  GKO: P('Royaume de Kong', 'Kong', 'dioula', '#5b2c6f', 'Les Marchands dioula', ['Caravanes de la kola et du sel : accords commerciaux +25 %', 'Écoles coraniques : recherche +10 %'], ['Cité marchande : infanterie −8 %'],
    { trade: 0.25, research_speed: 0.1, inf_power: -0.08 }, [0.35, 0.85, 0.45, 'civil'], 'livres', [[8, 10, 10, 10], 0.4],
    ['Ouattara', 'Saganogo', 'Baro', 'Kamagaté', 'Touré', 'Cissé', 'Timité', 'Diabaté'], 'mande'),
  GAN: P('Royaumes agni et baoulé', 'Agni-Baoulé', 'agni', '#e59866', 'Le Sanwi et les lagunes', ["Or de l'Indénié : livres +15 %", 'Lagunes : ports +10 %'], ['Royaumes jeunes : recrues −10 %'],
    { livres: 0.15, port: 0.1, recrues: -0.1 }, [0.3, 0.7, 0.4, 'civil'], 'livres', [[5, 8, 8, 8], 0.3],
    ['Amalaman', 'Aka Essoin', 'Ano Assoman', 'Kadio', 'Boa Kouassi', 'Amon Ndoufou', 'Assié', 'Aka Simadou'], 'akan'),
  GDY: P('Royaume du Denkyira', 'Denkyira', 'denkyira', '#7d3c98', "Les Maîtres de l'or de 1700", ["Mines d'or du Wassa : livres +25 %", 'Infanterie +8 %'], ['Vassaux rétifs : recrues −10 %', 'Entretien des troupes +10 %'],
    { livres: 0.25, inf_power: 0.08, recrues: -0.1, upkeep: 0.1 }, [0.65, 0.6, 0.6, 'militaire'], 'livres', [[20, 5, 5, 5], 0.6],
    ['Agona', 'Asona', 'Aduana', 'Oyoko', 'Bretuo', 'Ekuona', 'Asenie', 'Asakyiri'], 'akan'),
  GAS: P('Royaume ashanti', 'Ashanti', 'ashanti', '#f1c40f', "Le Tabouret d'or", ['Mousquetaires akan : infanterie +12 %', "Or de la forêt : livres +15 %", 'Recrues +10 %'], ['Forêt épaisse : routes −10 %'],
    { inf_power: 0.12, livres: 0.15, recrues: 0.1, road_speed: -0.1 }, [0.75, 0.6, 0.8, 'militaire'], 'recrues', [[15, 40, 50, 40], 0.8],
    ['Oyoko', 'Bretuo', 'Agona', 'Asona', 'Aduana', 'Ekuona', 'Asenie', 'Asakyiri'], 'akan'),
  GFA: P('Confédération fanti', 'Fanti', 'fanti', '#2e86c1', 'Les Courtiers de la côte', ['Courtage avec les forts : accords commerciaux +25 %', 'Ports +10 %'], ['Confédération lâche : recrues −10 %', 'Infanterie −5 %'],
    { trade: 0.25, port: 0.1, recrues: -0.1, inf_power: -0.05 }, [0.35, 0.9, 0.35, 'civil'], 'livres', [[10, 15, 15, 20], 0.5],
    ['Nsona', 'Twidan', 'Anona', 'Kona', 'Abradzi', 'Ebiradzi', 'Adwinadzi', 'Dehyena'], 'akan'),
  GAK: P("Royaume d'Akwamu", 'Akwamu', 'akwamu', '#b03a2e', "Les Seigneurs d'Accra", ["Péage d'Accra : livres +15 %", 'Razzias : embuscades +15 %', 'Infanterie +6 %'], ['Peuples soumis : entretien des troupes +10 %'],
    { livres: 0.15, ambush: 0.15, inf_power: 0.06, upkeep: 0.1 }, [0.7, 0.6, 0.7, 'militaire'], 'recrues', [[10, 5, 5, 5], 0.5],
    ['Aduana', 'Asona', 'Agona', 'Oyoko', 'Bretuo', 'Ekuona', 'Asenie', 'Asakyiri'], 'akan'),
  GDG: P('Royaumes dagomba et gonja', 'Dagomba', 'dagomba', '#a9cce3', 'Les Cavaliers des savanes', ['Cavalerie +12 %', 'Marché de Salaga : accords commerciaux +10 %'], ['Savanes sèches : vivres −10 %', 'Industrie −15 %'],
    { cav_power: 0.12, trade: 0.1, vivres: -0.1, industrie: -0.15 }, [0.5, 0.55, 0.45, 'militaire'], 'recrues', [[10, 10, 10, 10], 0.3],
    ['Gbewaa', 'Zangina', 'Andani', 'Abudu', 'Gariba', 'Yakubu', 'Mahama', 'Jakpa'], 'gur'),
  GHU: P('Royaume de Ouidah', 'Ouidah', 'houéda', '#45b39d', 'Le Grand Marché de la côte des Esclaves', ['Rade de Juda : accords commerciaux +30 %', 'Ports +15 %'], ['Petite armée : recrues −20 %', 'Infanterie −8 %'],
    { trade: 0.3, port: 0.15, recrues: -0.2, inf_power: -0.08 }, [0.25, 0.95, 0.25, 'civil'], 'livres', [[8, 3, 3, 3], 0.6],
    ['Agbangla', 'Haffon', 'Kpassé', 'Ayohouan', 'Yahazé', 'Quénum', 'Adjovi', 'De Souza'], 'fon'),
  GDA: P('Royaume du Dahomey', 'Dahomey', 'dahoméen', '#6e2c00', "Le Royaume d'Abomey", ['Armée permanente et Amazones : infanterie +12 %', 'Recrues +10 %', 'Discipline : morale +10 %'], ['Tribut à Oyo : livres −10 %', 'Industrie −10 %'],
    { inf_power: 0.12, recrues: 0.1, morale: 0.1, livres: -0.1, industrie: -0.1 }, [0.85, 0.5, 0.8, 'militaire'], 'recrues', [[8, 12, 12, 15], 0.5],
    ['Aladahonou', 'Migan', 'Méhou', 'Gaou', 'Yévogan', 'Possou', 'Topo', 'Agbo'], 'fon'),
  GOY: P("Empire d'Oyo", 'Oyo', 'oyo', '#1e8449', "L'Alafin et ses cavaliers", ['Cavalerie +20 %', 'Empire tributaire : recrues +15 %', 'Marchés yoruba : accords commerciaux +10 %'], ['Mouche tsé-tsé au sud : usure +10 %', 'Artillerie −10 %'],
    { cav_power: 0.2, recrues: 0.15, trade: 0.1, attrition: 0.1, art_power: -0.1 }, [0.7, 0.6, 0.75, 'militaire'], 'recrues', [[30, 50, 30, 20], 0.8],
    ['Oranmiyan', 'Gaha', 'Afonja', 'Atiba', 'Ogunmola', 'Kurunmi', 'Aburumaku', 'Lagelu'], 'yoruba'),
  GBE: P('Royaume du Bénin', 'Bénin', 'béninois', '#c0392b', "L'Oba et ses bronzes", ['Murailles de Bénin : fortifications +20 %', 'Bronziers : industrie +10 %', 'Poivre et étoffes : accords commerciaux +10 %'], ['Cour sacrée : recherche −10 %'],
    { fort_bonus: 0.2, industrie: 0.1, trade: 0.1, research_speed: -0.1 }, [0.45, 0.65, 0.4, 'civil'], 'vivres', [[20, 15, 10, 10], 0.6],
    ['Eweka', 'Iyase', 'Ezomo', 'Uwangue', 'Ologbosere', 'Ebohon', 'Osula', 'Esogban'], 'edo'),
  GAR: P('Confédération aro', 'Aro', 'aro', '#d4ac0d', "L'Oracle d'Arochukwu", ['Oracle du Long Juju : diplomatie +10', 'Réseau de marchés : accords commerciaux +15 %', 'Pays très peuplé : recrues +10 %'], ['Pas d\'État : fortifications −15 %'],
    { diplo: 10, trade: 0.15, recrues: 0.1, fort_bonus: -0.15 }, [0.4, 0.8, 0.5, 'civil'], 'vivres', [[5, 10, 10, 10], 0.4],
    ['Nnachi', 'Akuma', 'Okoro Idozuka', 'Agwu', 'Aka', 'Ibom', 'Amanze', 'Kanu Oji'], 'igbo'),
  GDL: P('Cités du delta', 'Delta', 'ijo', '#5dade2', 'Les Maisons de pirogues de Bonny et de Calabar', ['Maisons de pirogues : ports +25 %', 'Traite et huile de palme : accords commerciaux +25 %', 'Marais : attrait des marais +20 %'], ['Cités-États : recrues −20 %', 'Vivres −10 %'],
    { port: 0.25, trade: 0.25, marsh_attr: 0.2, recrues: -0.2, vivres: -0.1 }, [0.35, 0.95, 0.3, 'civil'], 'livres', [[5, 5, 5, 5], 0.7],
    ['Pepple', 'Amakiri', 'Duke', 'Eyamba', 'Henshaw', 'Archibong', 'Jaja', 'Allison'], 'igbo'),
  GDU: P('Pays douala', 'Douala', 'douala', '#16a085', "Les Courtiers de l'estuaire", ["Estuaire du Wouri : accords commerciaux +20 %", 'Pirogues : ports +15 %'], ['Petit pays : recrues −20 %'],
    { trade: 0.2, port: 0.15, recrues: -0.2 }, [0.3, 0.85, 0.3, 'civil'], 'livres', [[2, 2, 2, 2], 0.3],
    ['Mbedi', 'Ewale', 'Bell', 'Akwa', 'Deido', 'Priso', 'Ngando', 'Ebele'], 'bantoue'),
  GBM: P('Royaume bamoun', 'Bamoun', 'bamoun', '#884ea0', 'Les Rois de Foumban', ['Hautes terres : combat en montagne +20 %', 'Forgerons : fer +15 %', 'Recrues +10 %'], ['Loin de la mer : commerce −15 %'],
    { mountain: 0.2, fer: 0.15, recrues: 0.1, trade: -0.15 }, [0.6, 0.4, 0.6, 'militaire'], 'fer', [[5, 8, 10, 10], 0.3],
    ['Nchare', 'Mbuembue', 'Nsangou', 'Njoya', 'Kuotu', 'Ngouhouo', 'Ngapna', 'Mbombo'], 'bantoue'),
  GNL: P('Côte de Guinée néerlandaise', 'Guinée holl.', 'hollandais', '#e67e22', "Saint-Georges d'Elmina", ['Compagnie des Indes occidentales : accords commerciaux +30 %', 'Château d\'Elmina : fortifications +25 %', 'Ports +15 %'], ['Quelques centaines de soldats : recrues −40 %', 'Climat : usure +20 %'],
    { trade: 0.3, fort_bonus: 0.25, port: 0.15, recrues: -0.4, attrition: 0.2 }, [0.3, 0.95, 0.3, 'civil'], 'livres', [[1, 0.5, 0.5, 0.3], 1.2],
    ['Smits', 'De la Palma', 'Van Sevenhuysen', 'Pranger', 'Huydecoper', 'Van Voorst', 'De Petersen', 'Van Tets'], 'neerlandaise'),
  GGB: P('Forts britanniques de la côte de l\'Or', 'Côte de l\'Or', 'britannique', '#e8e8e8', 'Le Château de Cape Coast', ['Compagnie royale d\'Afrique : accords commerciaux +30 %', 'Ports +20 %', 'Forts : fortifications +15 %'], ['Garnisons minuscules : recrues −40 %', 'Climat : usure +20 %'],
    { trade: 0.3, port: 0.2, fort_bonus: 0.15, recrues: -0.4, attrition: 0.2 }, [0.35, 0.95, 0.4, 'industriel'], 'livres', [[0.5, 0.6, 1, 2], 1.2],
    ['Thomas', 'Melvil', 'Brew', 'Bell', 'Mill', 'Dalzel', 'Torrane', 'Maclean'], 'britannique'),
  GDN: P('Guinée danoise', 'Guinée dan.', 'danois', '#f1948a', 'Le Château de Christiansborg', ['Compagnie danoise : accords commerciaux +25 %', 'Ports +15 %'], ['Une poignée de soldats : recrues −45 %', 'Climat : usure +20 %'],
    { trade: 0.25, port: 0.15, recrues: -0.45, attrition: 0.2 }, [0.2, 0.9, 0.25, 'civil'], 'livres', [[0.2, 0.3, 0.3, 0.2], 0.4],
    ['Lygaard', 'Rost', 'Wærøe', 'Kiøge', 'Biørn', 'Jessen', 'Wrisberg', 'Carstensen'], 'scandinave'),
  GPT: P('Îles portugaises du golfe', 'São Tomé', 'portugais', '#1a5276', 'Les Îles du sucre et des esclaves', ['Escale des navires : ports +25 %', 'Cacao et sucre : vivres +10 %'], ['Îles : recrues −35 %', 'Révoltes d\'esclaves : morale −10 %'],
    { port: 0.25, vivres: 0.1, recrues: -0.35, morale: -0.1 }, [0.2, 0.85, 0.2, 'civil'], 'livres', [[0.5, 0.5, 0.5, 0.5], 0.4],
    ['Bragance', 'Mendes', 'Costa Alegre', 'Vaz Coutinho', 'Pinto da Gama', 'Almeida', 'Graça', 'Ferreira'], 'portugaise'),
};

// les familles culturelles nouvelles (les autres sont celles de rules.rs : neerlandaise, britannique, scandinave, portugaise)
const CULTURES = {
  akan: { prenoms: ['Osei', 'Opoku', 'Kwasi', 'Kwadwo', 'Kwabena', 'Kwaku', 'Yaw', 'Kofi', 'Kwame', 'Kwesi'],
    prenoms_f: ['Akosua', 'Adwoa', 'Abena', 'Akua', 'Yaa', 'Afua'],
    noms: ['Agyeman', 'Boateng', 'Amankwa', 'Owusu', 'Asante', 'Mensah', 'Ntim', 'Gyamfi', 'Bonsu', 'Kwarteng', 'Oti', 'Ampofo', 'Darko', 'Ofori', 'Ansa', 'Tutu'] },
  mande: { prenoms: ['Mamadou', 'Moussa', 'Sékou', 'Fodé', 'Bakary', 'Ibrahima', 'Lansana', 'Siaka', 'Karamoko', 'Sori'],
    prenoms_f: ['Mariama', 'Fanta', 'Aminata', 'Kadiatou', 'Hawa', 'Sira'],
    noms: ['Keïta', 'Traoré', 'Ouattara', 'Kamara', 'Konaté', 'Diabaté', 'Cissé', 'Touré', 'Koroma', 'Sesay', 'Kanté', 'Doumbia', 'Fofana', 'Bamba', 'Sylla', 'Condé'] },
  gur: { prenoms: ['Mahama', 'Yakubu', 'Abdulai', 'Alhassan', 'Andani', 'Zangina', 'Wumbei', 'Sulemana', 'Iddrisu', 'Issahaku'],
    prenoms_f: ['Salamatu', 'Fuseina', 'Mariama', 'Ayishetu', 'Napari', 'Wumpini'],
    noms: ['Abudu', 'Gariba', 'Dawuni', 'Tia', 'Sumani', 'Mahami', 'Fuseini', 'Bawa', 'Seidu', 'Iddi', 'Wuni', 'Jakpa', 'Lempo', 'Nantogma', 'Kumbung', 'Tolon'] },
  fon: { prenoms: ['Agaja', 'Tegbessou', 'Kpengla', 'Agonglo', 'Adandozan', 'Guézo', 'Glèlè', 'Houégbadja', 'Akaba', 'Dossou'],
    prenoms_f: ['Hangbé', 'Agontimé', 'Sika', 'Houéfa', 'Ablavi', 'Afiavi'],
    noms: ['Ahouansou', 'Hounkpatin', 'Agbo', 'Zinsou', 'Adjovi', 'Houngbédji', 'Dossou-Yovo', 'Kpadonou', 'Gbaguidi', 'Hounsou', 'Akplogan', 'Sossou', 'Tossou', 'Ahanhanzo', 'Glidja', 'Hountondji'] },
  yoruba: { prenoms: ['Ajagbo', 'Abiodun', 'Awole', 'Ojigi', 'Gberu', 'Labisi', 'Adebayo', 'Oluwole', 'Akinola', 'Adewale'],
    prenoms_f: ['Abiola', 'Folake', 'Iyabo', 'Morenike', 'Adunni', 'Titilayo'],
    noms: ['Adeyemi', 'Ogunlade', 'Oyewole', 'Adelabu', 'Ladipo', 'Ajayi', 'Akintola', 'Olowu', 'Fagbemi', 'Adebiyi', 'Okunade', 'Adegbite', 'Ogundipe', 'Oyekan', 'Alade', 'Ojo'] },
  edo: { prenoms: ['Akenzua', 'Eresoyen', 'Akengbuda', 'Obanosa', 'Osemwende', 'Adolo', 'Ewuare', 'Esigie', 'Ozolua', 'Ehengbuda'],
    prenoms_f: ['Idia', 'Iden', 'Eki', 'Ivie', 'Osasu', 'Ewere'],
    noms: ['Ogiamien', 'Ebohon', 'Osula', 'Aruanran', 'Agho', 'Uwaifo', 'Osagie', 'Omoregie', 'Igbinedion', 'Ekhator', 'Edokpolor', 'Iyamu', 'Ihama', 'Obaseki', 'Eweka', 'Ize-Iyamu'] },
  igbo: { prenoms: ['Nnamdi', 'Chukwuemeka', 'Obiora', 'Ikenna', 'Nwankwo', 'Ezeoha', 'Nwabueze', 'Uzoma', 'Chidi', 'Okezie'],
    prenoms_f: ['Adaeze', 'Nneka', 'Ngozi', 'Chioma', 'Ifeoma', 'Uzoamaka'],
    noms: ['Okeke', 'Okafor', 'Nwosu', 'Eze', 'Okonkwo', 'Obi', 'Nwachukwu', 'Ike', 'Onwuka', 'Igwe', 'Okoro', 'Nnaji', 'Ezeh', 'Agu', 'Ani', 'Udeh'] },
  bantoue: { prenoms: ['Ngando', 'Ewonde', 'Mbape', 'Ekwe', 'Priso', 'Eyum', 'Dika', 'Ngoso', 'Nsangou', 'Kuotu'],
    prenoms_f: ['Engome', 'Ewodi', 'Njeuma', 'Mbamba', 'Esua', 'Dibonge'],
    noms: ['Ekwalla', 'Lobe', 'Ebele', 'Mbombo', 'Njimoluh', 'Ngouhouo', 'Pokam', 'Fonyonga', 'Ngwa', 'Fomukong', 'Doumbé', 'Essombe', 'Kingue', 'Moukouri', 'Njoya', 'Ndoumbé'] },
};

export default {
  id: 'guinee', geo: 8, nom: "Côte de l'Ivoire",
  cadre: { LON0: -13.6, LON1: 12.6, LAT0: -0.3, LAT1: 11.2, LAT_REF: 5.5, KM: 5 },
  places: [100, 320],
  ENTIERS, COUPES, DETROITS, FLEUVES, NE, PORTS_ADMIS, PAYS, CULTURES,
};
