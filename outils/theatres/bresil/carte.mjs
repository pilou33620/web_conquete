// Théâtre « Côte du Brésil » (géographie 9) : le Brésil portugais et les Guyanes vers 1720-1750, de l'Essequibo à
// Santa Catarina, à 5 km la case. Lu par outils/theatre.mjs (même forme que la tête d'outils/europe.mjs).
// Découpage repris d'Empire: Total War (théâtre commercial de la Côte du Brésil), mais en carte terrestre : les points de
// commerce d'Empire deviennent des places portuaires (étiquettes « port commerce » de villes.json).
// Estimations et choix d'auteur, de mémoire : frontières approchées par les États brésiliens d'aujourd'hui.
//
// Camps : le Brésil portugais est coupé en ses grandes capitaineries (comme les États allemands de l'Europe) : Bahia,
// siège du gouverneur général puis vice-roi (BPT), Pernambouc et ses capitaineries annexes (BPE), l'État du Maranhão et
// Grão-Pará, gouverné à part jusqu'en 1772 (BMA), Rio de Janeiro (BRJ), São Paulo et le sud (BSP), Minas Gerais (BMG,
// séparée en 1720), Goiás et Mato Grosso (BGO, BMT, séparées de São Paulo en 1748). Les frontières sont celles du milieu
// du XVIIIe siècle, comme en Europe : Minas, Goiás et Mato Grosso n'existent qu'après 1720-1748 ; pour un début en 1700,
// leurs villes de l'or sont des places neuves (trajectoires d'epoques.json). Rivalités réelles : guerre des Emboabas
// (Paulistes contre Minas, 1707-1709), guerre des Mascates (Olinda contre Recife, 1710).
// Nations autochtones encore maîtresses de leurs terres vers 1750 : les nations tupi du Tapajós et du Xingu (Mundurucus,
// Maués, Juruna ; BTU) et les Guaicurus et Payaguás du Pantanal (BGU). La confédération des Cariris (guerre des
// Barbares, 1683-1713) n'a pas de camp : finie avant 1750, son sertão est pernamboucain et maranhense.
// Guyanes : Surinam, Berbice et Essequibo néerlandais (BNL), Cayenne française (BFR, le contesté de l'Amapá au Maranhão).
// Différences avec Empire : Empire n'a ici qu'une mer à comptoirs (et le Brésil, une seule région portugaise du théâtre
// d'Amérique) ; on garde les Guyanes et on ajoute les capitaineries et deux nations autochtones.

const TERRE = '~Missions jésuites';
// le cours de l'Amazone (latitude), de l'ouest du cadre à l'embouchure du Tapajós : la rive sud aux nations tupi
const amazone = lon => lon < -56.7 ? -3.2 + (lon + 58.6) * 0.42 : -2.35;

const ENTIERS = {
  Suriname: 'BNL', Guyana: 'BNL', France: 'BFR', // la France de Natural Earth : seule la Guyane est dans le cadre
  Paraguay: '~Paraguay espagnol', Argentina: TERRE, Bolivia: '~Chiquitos',
};
const COUPES = {
  Brazil: { carte: 'br/br-all', defaut: 'BSP',
    regions: { Bahia: 'BPT', Sergipe: 'BPT', 'Espírito Santo': 'BPT',
      Pernambuco: 'BPE', Alagoas: 'BPE', 'Paraíba': 'BPE', 'Rio Grande do Norte': 'BPE', 'Ceará': 'BPE',
      'Maranhão': 'BMA', 'Piauí': 'BMA', 'Pará': 'BMA', 'Amapá': 'BMA', Amazonas: 'BMA', Roraima: '~Rio Branco',
      'Rio de Janeiro': 'BRJ', 'São Paulo': 'BSP', 'Paraná': 'BSP', 'Santa Catarina': 'BSP', 'Rio Grande do Sul': 'BSP',
      'Minas Gerais': 'BMG', 'Goiás': 'BGO', Tocantins: 'BGO', 'Distrito Federal': 'BGO',
      'Mato Grosso': 'BMT', 'Mato Grosso do Sul': 'BGU', 'Rondônia': 'BTU', Acre: 'BTU' },
    retouche: (lon, lat, r) =>
      (r === 'Amazonas' || r === 'Pará') && lon < -55 && lat < amazone(lon) - 0.05 ? 'BTU' // rive sud, à l'ouest du Tapajós
      : r === 'Pará' && lon < -50.5 && lat < -5.0 ? 'BTU' // le Xingu et l'Iriri
      : r === 'Mato Grosso' ? (lat > -12.5 ? 'BTU' : lon > -53.5 ? 'BGO' : null) // le nord aux Tupi ; l'Araguaia à Goiás
      : r === 'Rio Grande do Sul' && lon < -53.0 ? TERRE // les Sept Peuples des Missions, espagnols jusqu'en 1801
      : null },
};
const DETROITS = [];

// [nom, rang, [lon, lat] vers la source, [lon, lat] à l'embouchure ou au confluent, noms Natural Earth admis], ou points à la main
const FLEUVES = [
  ['Amazone', 1, [-59.4, -3.3], [-52.72, -1.58], /^Amazonas$/], ['Tapajós', 1, [-58.5, -10.7], [-54.68, -2.41], /^Tapaj.s$/],
  ['Xingu', 1, [-53.4, -11.3], [-52.26, -1.70], /^Xingu$/],
  ['Tocantins', 1, [-49.1, -15.8], [-49.67, -2.70], /^Tocantins$/], ['Araguaia', 1, [-53.1, -17.8], [-48.94, -5.30], /^Araguaia$/],
  ['São Francisco', 1, [-45.1, -19.0], [-36.41, -10.50], /^S.o +Francisco$/], ['Rio das Velhas', 3, [-43.8, -20.1], [-44.84, -17.19], /^Velhas$/],
  ['Parnaíba', 2, [-45.9, -10.1], [-41.84, -2.77], /^Parna.ba$/], ['Mearim', 3, [-46.25, -6.7], [-44.80, -3.30], /^Mearim$/], ['Gurupi', 3, [-47.3, -5.2], [-46.08, -1.21], /^Gurupi$/],
  ['Paraíba do Sul', 2, [-45.0, -23.0], [-41.02, -21.61], /^Paraiba$/], ['Doce', 2, [-43.7, -20.8], [-39.81, -19.64], /^Doce$/],
  ['Jequitinhonha', 2, [-43.4, -18.25], [-38.86, -15.85], /^Jequitinhonha$/], ['Rio de Contas', 3, [-41.8, -13.3], [-38.99, -14.27], /^Contas$/],
  ['Paraná', 1, [-50.49, -19.02], [-59.2, -29.2], /^Paran.$/], ['Paraguay', 1, [-56.13, -15.59], [-58.60, -27.31], /^Paran.$/], // Natural Earth nomme « Paraná » le Paraguay et le Cuiabá, son affluent (tracé depuis Cuiabá)
  ['Paranaíba', 2, [-46.3, -19.15], [-50.49, -19.02], /^Parana.ba$/], ['Rio Grande', 2, [-44.45, -22.1], [-50.99, -20.10], /^Grande$/],
  ['Tietê', 2, [-45.96, -23.6], [-51.59, -20.62], /^Tiet.$/], ['Paranapanema', 3, [-48.2, -24.1], [-53.17, -22.70], /^Paranapanema$/],
  ['Uruguay', 2, [-49.8, -28.5], [-56.6, -29.5], /^Uruguay$/],
  ['Maroni', 2, [-54.05, 3.65], [-54.17, 5.35], /^Maroni$/], ['Courantyne', 2, [-56.81, 2.2], [-57.25, 5.48], /^(Corantijn|Courantyne)$/],
  ['Suriname', 3, [-55.0, 4.98], [-55.13, 5.82], /^Suriname$/], ['Essequibo', 2, [-58.79, 1.31], [-58.60, 6.42], /^Essequibo$/],
  // absent de Natural Earth : de mémoire, à quelques km près
  ['Oyapock', 3, [[-52.45, 2.25], [-52.35, 2.8], [-52.33, 3.17], [-52.05, 3.5], [-51.82, 3.85], [-51.68, 4.1], [-51.6, 4.35]]],
];
const NE = { rivieres: [], lacs: [] }; // pas de fichier régional Natural Earth pour l'Amérique du Sud

const P = (name, short, adj, color, title, pros, cons, mods, [aggr, trade, expand, tech], specialty, moyens, maisons, culture) =>
  ({ name, short, color, adj, title, pros, cons, mods, personality: { aggr, trade, expand, tech }, specialty, moyens, maisons, culture });
// moyens : [armée en milliers d'hommes au début de 1700, 1790, 1813, 1870], trésor (multiple des 500 livres d'un département).
// Estimations de mémoire : troupes réglées et milices d'ordonnance mobilisables ; 1870, l'armée de l'Empire du Brésil
// (guerre du Paraguay) répartie entre ses provinces ; un camp absorbé garde l'armée de son dernier état connu.
const PAYS = {
  BPT: P('Capitainerie générale de Bahia', 'Bahia', 'bahianais', '#1e8449', 'Le Siège du gouverneur général', ['Sucre et tabac du Recôncavo : accords commerciaux +20 %', 'Capitale du Brésil : diplomatie +10', 'Forts de Salvador : fortifications +15 %'], ["Économie d'esclaves : morale −8 %"],
    { trade: 0.2, diplo: 10, fort_bonus: 0.15, morale: -0.08 }, [0.4, 0.85, 0.5, 'civil'], 'vivres', [[4, 3, 15, 25], 1.5],
    ['Lencastre', "Garcia d'Ávila", 'Pires de Carvalho', 'Moniz Barreto', 'Calmon', 'Aragão', 'Menezes', 'Teles'], 'portugaise'),
  BPE: P('Capitainerie de Pernambouc', 'Pernambouc', 'pernamboucain', '#e74c3c', 'Les Seigneurs de moulins de Recife et Olinda', ['Sucre : vivres +15 %', 'Port de Recife : ports +15 %', 'Vétérans de la guerre hollandaise : infanterie +6 %'], ['Mascates contre planteurs : livres −10 %'],
    { vivres: 0.15, port: 0.15, inf_power: 0.06, livres: -0.1 }, [0.45, 0.75, 0.5, 'agricole'], 'vivres', [[3, 5, 8, 15], 1.0],
    ['Mascarenhas', 'Cavalcanti', 'Albuquerque', 'Pais Barreto', 'Rego Barros', 'Wanderley', 'Carneiro da Cunha', 'Vieira de Melo'], 'portugaise'),
  BMA: P('État du Maranhão et Grão-Pará', 'Maranhão', 'maranhense', '#f4d03f', "Les Portes de l'Amazone", ['Drogues du sertão et cacao : accords commerciaux +15 %', 'Forêts : bois +25 %', 'Pirogues des fleuves : ports +10 %'], ['Pays immense et vide : routes −10 %', 'Recrues −10 %'],
    { trade: 0.15, bois: 0.25, port: 0.1, road_speed: -0.1, recrues: -0.1 }, [0.35, 0.65, 0.6, 'civil'], 'bois', [[1.5, 3, 5, 8], 0.6],
    ['Albuquerque Coelho', 'Beckman', 'Mendonça Furtado', 'Melo e Castro', 'Pereira Caldas', 'Sousa Coutinho', 'Teles da Silva', 'Belfort'], 'portugaise'),
  BRJ: P('Capitainerie de Rio de Janeiro', 'Rio', 'fluminense', '#f39c12', "La Ville de Saint-Sébastien et le chemin de l'or", ["Port de l'or : accords commerciaux +25 %", 'Ports +15 %', 'Baie fortifiée : fortifications +10 %'], ['Petite capitainerie : recrues −10 %'],
    { trade: 0.25, port: 0.15, fort_bonus: 0.1, recrues: -0.1 }, [0.4, 0.9, 0.45, 'civil'], 'livres', [[2, 6, 15, 35], 1.2],
    ['Sá e Meneses', 'Correia de Sá', 'Gomes Freire', 'Azeredo Coutinho', 'Lavradio', 'Carneiro Leão', 'Vasconcelos', 'Resende'], 'portugaise'),
  BSP: P('Capitainerie de São Paulo', 'São Paulo', 'pauliste', '#8e44ad', 'Les Bandeirantes', ['Bandeiras : embuscades +25 %', 'Coureurs de sertão : usure −15 %', 'Recrues +10 %'], ['Pays pauvre : livres −15 %', 'Industrie −10 %'],
    { ambush: 0.25, attrition: -0.15, recrues: 0.1, livres: -0.15, industrie: -0.1 }, [0.75, 0.4, 0.85, 'militaire'], 'recrues', [[3, 4, 8, 15], 0.6],
    ['Camargo', 'Pires', 'Bueno', 'Pais Leme', 'Borba Gato', 'Raposo Tavares', 'Prado', 'Toledo Piza'], 'portugaise'),
  BMG: P('Capitainerie de Minas Gerais', 'Minas', 'mineiro', '#2e86c1', "Les Mines d'or et de diamants", ["Or de Vila Rica : livres +35 %", 'Diamants du Tijuco : accords commerciaux +10 %', 'Mines : fer +15 %'], ['Le quint du roi : entretien des troupes +10 %', 'Loin de la mer : ports −20 %'],
    { livres: 0.35, trade: 0.1, fer: 0.15, upkeep: 0.1, port: -0.2 }, [0.4, 0.6, 0.5, 'industriel'], 'livres', [[1, 6, 8, 10], 1.5],
    ['Nunes Viana', 'Assumar', 'Rolim', 'Mota', 'Gonzaga', 'Silva Xavier', 'Barbacena', 'Vasconcelos'], 'portugaise'),
  BGO: P('Capitainerie de Goiás', 'Goiás', 'goiano', '#a04000', "L'Or des Guayazes", ["Placers d'or : livres +20 %", 'Campements de sertão : usure −10 %'], ['Pays vide : recrues −20 %', 'Routes −10 %'],
    { livres: 0.2, attrition: -0.1, recrues: -0.2, road_speed: -0.1 }, [0.4, 0.5, 0.5, 'civil'], 'livres', [[0.1, 2, 3, 4], 0.6],
    ['Bueno da Silva', 'Ortiz de Camargo', 'Silva Ortiz', 'Távora', 'Melo Coutinho', 'Meneses', 'Cunha Meneses', 'Mascarenhas'], 'portugaise'),
  BMT: P('Capitainerie de Mato Grosso', 'Mato Grosso', 'matogrossense', '#48c9b0', 'Les Mines de Cuiabá et la frontière espagnole', ["Or de Cuiabá : livres +15 %", 'Moussons des fleuves : usure −15 %', 'Fortins : fortifications +10 %'], ['Bout du monde : routes −15 %', 'Recrues −20 %'],
    { livres: 0.15, attrition: -0.15, fort_bonus: 0.1, road_speed: -0.15, recrues: -0.2 }, [0.45, 0.4, 0.55, 'militaire'], 'livres', [[0.1, 1.5, 2, 3], 0.4],
    ['Leme', 'Rolim de Moura', 'Miranda Montenegro', 'Albuquerque', 'Cáceres', 'Pires de Campos', 'Pais de Barros', 'Cabral'], 'portugaise'),
  BTU: P('Nations tupi du Tapajós et du Xingu', 'Tupi', 'tupi', '#145a32', 'Les Mundurucus et les Maués', ['Guerriers mundurucus : embuscades +30 %', 'Gens de la forêt : usure −25 %', 'Marais et igapós : attrait des marais +20 %'], ['Ni forts ni canons : fortifications −25 %, artillerie −25 %', 'Industrie −30 %'],
    { ambush: 0.3, attrition: -0.25, marsh_attr: 0.2, fort_bonus: -0.25, art_power: -0.25, industrie: -0.3 }, [0.6, 0.3, 0.4, 'agricole'], 'bois', [[6, 5, 4, 2], 0.1],
    ['Mundurucu', 'Maué', 'Tupinambarana', 'Apiaká', 'Kayabi', 'Juruna', 'Arara', 'Parintintin'], 'tupi'),
  BGU: P('Guaicurus et Payaguás', 'Guaicurus', 'guaicuru', '#d7bde2', 'Les Cavaliers et les Canotiers du Pantanal', ['Cavaliers guaicurus : cavalerie +25 %', 'Pirogues payaguás : embuscades +25 %', 'Gens du Pantanal : usure −20 %'], ['Ni forts ni canons : fortifications −25 %, artillerie −25 %', 'Industrie −30 %'],
    { cav_power: 0.25, ambush: 0.25, attrition: -0.2, fort_bonus: -0.25, art_power: -0.25, industrie: -0.3 }, [0.8, 0.3, 0.4, 'militaire'], 'recrues', [[5, 4, 3, 2], 0.1],
    ['Mbayá', 'Payaguá', 'Kadiwéu', 'Guaná', 'Terena', 'Kinikinao', 'Xamacoco', 'Bororo'], 'tapuia'),
  BNL: P('Surinam et Guyanes néerlandaises', 'Surinam', 'hollandais', '#e67e22', 'La Société de Surinam', ['Sucre et café des polders : livres +25 %', 'Accords commerciaux +20 %', 'Fort Zeelandia : fortifications +15 %'], ['Marrons des forêts : morale −10 %', 'Peu de colons : recrues −35 %'],
    { livres: 0.25, trade: 0.2, fort_bonus: 0.15, morale: -0.1, recrues: -0.35 }, [0.3, 0.9, 0.3, 'civil'], 'livres', [[1.5, 2, 1.5, 1.5], 1.0],
    ['Van Aerssen van Sommelsdijck', 'Van der Veen', 'Mauricius', 'Crommelin', 'Nepveu', 'Texier', 'De Friderici', 'Wichers'], 'neerlandaise'),
  BFR: P('Guyane française', 'Cayenne', 'guyanais', '#2c3e50', 'La France équinoxiale', ['Épices et roucou : accords commerciaux +15 %', 'Forêts : bois +20 %'], ['Fièvres : usure +25 %', 'Recrues −40 %'],
    { trade: 0.15, bois: 0.2, attrition: 0.25, recrues: -0.4 }, [0.3, 0.7, 0.4, 'civil'], 'bois', [[0.5, 1, 0.5, 1], 0.4],
    ['Férolles', "d'Orvilliers", 'Lefebvre de La Barre', 'Fiedmont', 'Turgot', 'Malouet', 'Bessner', 'Hugues'], 'francaise'),
};

// les familles culturelles nouvelles (les autres sont celles du moteur : portugaise, neerlandaise, francaise)
const CULTURES = {
  tupi: { prenoms: ['Cunhambebe', 'Arariboia', 'Tibiriçá', 'Caiubi', 'Piquerobi', 'Jaguaraçu', 'Aimberê', 'Japiaçu', 'Itajibá', 'Ajuricaba'],
    prenoms_f: ['Bartira', 'Paraguaçu', 'Moema', 'Potira', 'Jaci', 'Iracema'],
    noms: ['Potiguara', 'Tabajara', 'Piragibe', 'Itaparica', 'Jaguaribe', 'Arapuã', 'Mbaracá', 'Tupinambá', 'Guaraciaba', 'Araribá', 'Juruá', 'Ybytu', 'Irapuã', 'Taquari', 'Mundurucu', 'Maraguá'] },
  tapuia: { prenoms: ['Janduí', 'Canindé', 'Mandu', 'Genipapo', 'Paiacu', 'Quixelô', 'Jucá', 'Anacé', 'Emavidi', 'Queimá'],
    prenoms_f: ['Jacira', 'Jandira', 'Araci', 'Iara', 'Damiana', 'Uirá'],
    noms: ['Canindé', 'Paiacu', 'Icó', 'Cariri', 'Tarairiú', 'Calabaça', 'Inhamum', 'Acroá', 'Gueguê', 'Xukuru', 'Kadiwéu', 'Xané', 'Nalique', 'Lalima', 'Apinajé', 'Krahô'] },
};

export default {
  id: 'bresil', geo: 9, nom: 'Côte du Brésil',
  cadre: { LON0: -59.5, LON1: -34.6, LAT0: -29.0, LAT1: 7.5, LAT_REF: -10, KM: 5 },
  places: [150, 450],
  ENTIERS, COUPES, DETROITS, FLEUVES, NE, PAYS, CULTURES,
};
