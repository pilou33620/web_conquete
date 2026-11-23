// Le théâtre « Inde » (géographie 7) : le sous-continent, l'Afghanistan et Ceylan au départ de 1700, à 5 km la case,
// sur le découpage de la grande campagne d'Empire: Total War (2009) : ses factions et ses régions, avec leurs
// propriétaires de 1700. Lu par outils/theatre.mjs (voir outils/THEATRES.md) ; villes.json et epoques.json à côté.
// Estimations et choix d'auteur, écrits de mémoire : frontières, fleuves, caractère des pays, moyens, maisons, noms.
//
// Les régions d'Empire et leur camp (capitale de région entre parenthèses ; toutes sont des places de villes.json) :
//   Empire moghol (IMO) : Hindoustan (Delhi), Cachemire (Srinagar), Sind (Thatta), Rajputana (Ajmer), Gujarat
//     (Ahmedabad), Malwa (Ujjain), Khandesh (Burhanpur), Bérar (Ellichpur), Gondwana (Nagpur), Ahmadnagar
//     (Aurangabad), Hyderabad (Hyderabad), Awadh (Lucknow), Bihar (Patna), Bengale (Murshidabad), Orissa et Circars (Cuttack)
//   Confédération marathe (IMA) : Bijapur (Satara), Carnatic (Arcot)
//   Mysore (IMY) : Mysore (Seringapatam), avec la côte de Malabar et le Travancore
//   Pendjab (IPU) : Pendjab (Lahore)
//   Afghans (IAF) : Afghanistan (Kandahar, Kaboul), Baloutchistan (Kalat)
//   Portugal (IGO) : Goa (Goa) ; Provinces-Unies (ICY) : Ceylan (Colombo)
// Une région ne sert qu'à placer sa capitale : la frontière tracée est celle des camps, par états de l'Inde,
// provinces du Pakistan et de l'Afghanistan, avec des retouches (lon, lat) là où une région coupe un état.

// ------------------------------------------------------------------ les camps de 1700
// « ~Nom » : terre hors jeu (lands) : le Népal, l'Assam des Ahom, le Ladakh, la Perse, l'Asie centrale…
const ENTIERS = {
  Bangladesh: 'IMO', 'Sri Lanka': 'ICY',
  Nepal: '~Népal', Bhutan: '~Bhoutan', Myanmar: '~Birmanie', Iran: '~Perse',
  Turkmenistan: '~Turkestan', Uzbekistan: '~Turkestan', Tajikistan: '~Turkestan',
  'Siachen Glacier': '~Karakoram', Maldives: '~Maldives',
};
// pays coupés : carte de régions Highcharts, région → camp, camp par défaut, retouche (lon, lat, région)
const COUPES = {
  India: { carte: 'in/in-all', defaut: 'IMO',
    regions: { Kerala: 'IMY', 'Tamil Nadu': 'IMA', Goa: 'IGO', Punjab: 'IPU', Chandigarh: 'IPU',
      Ladakh: '~Ladakh', Sikkim: '~Sikkim', Assam: '~Assam', 'Arunachal Pradesh': '~Assam', Meghalaya: '~Assam', Nagaland: '~Assam',
      Manipur: '~Manipur', Mizoram: '~Manipur', Tripura: '~Tripura', 'Andaman and Nicobar Islands': '~Andaman', Lakshadweep: '~Laquedives' },
    retouche: (lon, lat, r) =>
      // Bijapur (marathe) : le Konkan, Poona, Satara, Kolhapur, Sholapur ; au nord et à l'est, Ahmadnagar et le Khandesh (moghols)
      r === 'Maharashtra' ? ((lon < 74.3 && lat < 19.7) || (lat < 18.4 && lon < 76.0) ? 'IMA' : null)
      // le nord du Karnataka : Bijapur, Belgaum, Dharwar (marathes) ; Gulbarga, Raichur, Bellary (Hyderabad) ; le sud : Mysore
      : r === 'Karnataka' ? (lat >= 15.0 ? (lon < 76.3 ? 'IMA' : 'IMO') : 'IMY')
      // Pondichéry et Karikal au Carnatic ; Mahé au Malabar, Yanam aux Circars
      // le pays de Nanjinad (Padmanabhapuram, Nagercoil, le cap Comorin) : au Travancore
      : r === 'Tamil Nadu' ? (lat < 8.55 && lon < 77.6 ? 'IMY' : null)
      : r === 'Puducherry' ? (lat > 15 ? 'IMO' : lon < 76.5 ? 'IMY' : 'IMA')
      : null },
  Pakistan: { carte: 'pk/pk-all', defaut: 'IMO',
    regions: { Punjab: 'IPU', 'F.C.T.': 'IPU', Baluchistan: 'IAF', 'N.W.F.P.': 'IAF', 'F.A.T.A.': 'IAF', Sind: 'IMO', 'Azad Kashmir': 'IMO', 'Northern Areas': '~Karakoram' } },
  // le nord de l'Hindou Kouch (Balkh, Kunduz, Badakhchan) est au khanat de Boukhara en 1700
  Afghanistan: { carte: 'af/af-all', defaut: 'IAF',
    regions: Object.fromEntries(['Balkh', 'Kunduz', 'Jowzjan', 'Faryab', 'Sar-e Pol', 'Samangan', 'Takhar', 'Badakhshan', 'Baghlan'].map(r => [r, '~Turkestan'])) },
  China: { defaut: '~Tibet', retouche: (lon, lat) => lat > 35.8 && lon < 80.5 ? '~Turkestan' : null }, // la Kachgarie
};
// détroits : aucun pour l'instant (le détroit de Palk et le pont d'Adam restent de la mer à 5 km)
const DETROITS = [];

// ------------------------------------------------------------------ fleuves : estimations (source et embouchure, à 30 km près)
// [nom, rang (1 fleuve, 2 grande rivière, 3 rivière), [lon, lat] vers la source, [lon, lat] à l'embouchure ou au confluent,
// noms Natural Earth admis pour ces deux points (facultatif)], ou [nom, rang, [[lon, lat], …]] écrit de mémoire.
const FLEUVES = [
  ['Indus', 1, [79.5, 32.6], [67.55, 23.95], /^Indus$/], ['Gange', 1, [79.84, 30.87], [88.07, 22.24], /^Ganges$/],
  ['Brahmapoutre', 1, [92.9, 26.62], [90.25, 23.47], /^Brahmaputra$/], ['Yamuna', 2, [78.45, 30.9], [81.88, 25.42], /^Yamuna$/],
  ['Sutlej', 2, [81.3, 31.0], [71.03, 29.38], /^Sutlej$/], ['Chenab', 2, [77.4, 32.28], [70.65, 29.05], /^Chenab$/],
  ['Jhelum', 2, [75.35, 33.7], [72.15, 31.2], /^Jhelum$/], ['Ravi', 3, [76.8, 32.3], [71.78, 30.62], /^Ravi$/], ['Beas', 3, [77.2, 32.25], [75.0, 31.2], /^Beas$/],
  ['Godavari', 1, [73.66, 20.0], [82.32, 16.7], /^God.vari$/], ['Krishna', 1, [73.8, 17.97], [80.87, 16.02], /^Krishna$/],
  ['Kaveri', 2, [75.67, 12.35], [79.83, 10.92], /^Cauvery$/], ['Narmada', 1, [81.55, 22.72], [73.14, 21.74], /^Narmada$/],
  ['Tapti', 2, [78.12, 21.68], [72.74, 21.15], /^Tapi$/], ['Mahanadi', 2, [80.63, 20.59], [86.15, 20.15], /^Mah.na Nad.$/],
  ['Chambal', 2, [75.4, 22.5], [79.22, 26.48], /^Chambal$/], ['Son', 2, [82.07, 22.72], [84.87, 25.7], /^Son$/],
  ['Ghaghara', 2, [80.95, 30.5], [84.7, 25.75], /^Gh.ghara$/], ['Gandak', 3, [83.97, 29.18], [85.17, 25.65], /^Gandak$/],
  ['Betwa', 3, [77.36, 23.25], [80.2, 25.9], /^Betwa$/], ['Tungabhadra', 2, [75.35, 13.25], [78.22, 15.95], /^Tungabhadra$/],
  ['Bhima', 3, [73.7, 19.0], [77.27, 16.43], /^Bhima$/], ['Wainganga', 3, [79.55, 22.0], [79.9, 18.85], /^Wainganga$/],
  ['Mahi', 3, [74.95, 22.7], [72.92, 22.3], /^Mahi$/], ['Penner', 3, [77.58, 13.42], [80.14, 14.56], /^Penner$/],
  ['Mahaweli', 3, [80.67, 7.05], [81.4, 8.24], /^Mahaweli$/],
  // (l'Helmand se perd dans les marais du Sistan, absents de Natural Earth : pas de fin admise par l'outil, il n'est pas tracé)
  // absent de Natural Earth : de Kaboul à l'Indus à Attock (de mémoire, à quelques km près)
  ['Kaboul', 2, [[68.9, 34.45], [69.2, 34.53], [69.75, 34.55], [70.45, 34.43], [71.1, 34.25], [71.55, 34.1], [71.98, 34.0], [72.23, 33.91]]],
];

// ------------------------------------------------------------------ les camps : le format du jeu (rules.rs, FACTIONS)
// moyens : armée sur pied (milliers d'hommes) au début de 1700, 1790, 1813 et 1870 (un camp disparu garde son dernier
// état connu, comme en Europe), trésor en multiples de 500 livres ; maisons : la régnante de 1700 d'abord.
const P = (name, short, adj, color, title, pros, cons, mods, [aggr, trade, expand, tech], specialty, moyens, maisons, culture) =>
  ({ name, short, capital: '', color, adj, title, pros, cons, mods, personality: { aggr, trade, expand, tech }, specialty, moyens, maisons, culture });
const PAYS = {
  IMO: P('Empire moghol', 'Moghols', 'moghol', '#2e8b3e', 'Le Trône du Paon',
    ['Empire immense : recrues +25 %', 'Cavalerie des mansabdars : cavalerie +12 %', "Tissus de l'Hindoustan et du Bengale : livres +15 %"],
    ['Noblesse indocile : entretien des troupes +15 %', "Fin de règne d'Aurangzeb : recherche −10 %", 'Lourds trains de siège : routes −5 %'],
    { recrues: 0.25, cav_power: 0.12, livres: 0.15, upkeep: 0.15, research_speed: -0.1, road_speed: -0.05 }, [0.6, 0.6, 0.6, 'civil'], 'recrues',
    [[200, 10, 5, 5], 4], ['Timouride', 'Asaf Jah', 'Sayyid de Barha', 'Nichapouri', 'Nasiri', 'Kachwaha', 'Rathore', 'Tourani'], 'moghole'),
  IMA: P('Confédération marathe', 'Marathes', 'marathe', '#e67e22', 'Les Cavaliers du Deccan',
    ['Cavalerie légère : cavalerie +15 %', 'Ganimi kava, la guerre des embuscades : +30 %', 'Forts des Ghâts : montagne +20 %'],
    ['Infanterie −8 %', 'Artillerie −10 %'],
    { cav_power: 0.15, ambush: 0.3, mountain: 0.2, inf_power: -0.08, art_power: -0.1 }, [0.8, 0.45, 0.85, 'militaire'], 'recrues',
    [[60, 120, 70, 30], 1.5], ['Bhonsle', 'Bhat', 'Scindia', 'Holkar', 'Gaekwad', 'Angre', 'Patwardhan', 'Pawar'], 'marathe'),
  IMY: P('Royaume de Mysore', 'Mysore', 'mysoréen', '#8e44ad', 'Les Wodeyar de Seringapatam',
    ['Fusées de Mysore : artillerie +15 %', 'Acier wootz : fer +20 %', 'Citadelle de Seringapatam : fortifications +10 %'],
    ['Petit royaume : recrues −10 %'],
    { art_power: 0.15, fer: 0.2, fort_bonus: 0.1, recrues: -0.1 }, [0.6, 0.55, 0.6, 'militaire'], 'fer',
    [[20, 70, 5, 3], 1], ['Wodeyar', 'Haïdar Ali', 'Kalale', 'Keladi', 'Purnaiya', 'Mir Sadiq', 'Khande Rao', 'Nanjaraja'], 'kannada'),
  IPU: P('Khalsa du Pendjab', 'Pendjab', 'sikh', '#f1c40f', 'Le Pays des Cinq Rivières',
    ['Le Khalsa : infanterie +10 %', 'Cavaliers des misls : cavalerie +10 %', 'Blé des Cinq Rivières : vivres +20 %'],
    ['Industrie −15 %', 'Livres −10 %'],
    { inf_power: 0.1, cav_power: 0.1, vivres: 0.2, industrie: -0.15, livres: -0.1 }, [0.7, 0.4, 0.6, 'militaire'], 'vivres',
    [[10, 50, 60, 40], 1], ['Sodhi', 'Sukerchakia', 'Ahluwalia', 'Ramgarhia', 'Kanhaiya', 'Bhangi', 'Sandhawalia', 'Majithia'], 'sikhe'),
  IAF: P('Tribus afghanes', 'Afghans', 'afghan', '#a93226', 'Les Montagnards de Kandahar',
    ['Gens des montagnes : montagne +25 %', 'Cavaliers pachtounes : cavalerie +12 %', 'Embuscades +20 %'],
    ['Terre pauvre : vivres −20 %', 'Industrie −25 %', 'Tribus rivales : livres −10 %'],
    { mountain: 0.25, cav_power: 0.12, ambush: 0.2, vivres: -0.2, industrie: -0.25, livres: -0.1 }, [0.85, 0.35, 0.7, 'militaire'], 'recrues',
    [[25, 60, 40, 50], 0.5], ['Hotaki', 'Sadozaï', 'Barakzaï', 'Alikozaï', 'Popalzaï', 'Tokhi', 'Achakzaï', 'Ahmadzaï de Kalat'], 'afghane'),
  IGO: P('État portugais des Indes', 'Goa', 'portugais', '#5dade2', "La Rome de l'Orient",
    ['Négoce des épices : accords commerciaux +25 %', 'Ports +20 %', 'Remparts de Goa : fortifications +15 %'],
    ['Un comptoir : recrues −30 %', 'Vivres −15 %'],
    { trade: 0.25, port: 0.2, fort_bonus: 0.15, recrues: -0.3, vivres: -0.15 }, [0.2, 0.85, 0.2, 'civil'], 'livres',
    [[3, 3, 3, 2], 0.5], ['Bragance', 'Almeida', 'Mascarenhas', 'Noronha', 'Távora', 'Meneses', 'Castro', 'Sousa'], 'portugaise'),
  ICY: P('Ceylan néerlandais', 'Ceylan', 'hollandais', '#21618c', 'La Compagnie des Indes orientales',
    ['Cannelle : accords commerciaux +30 %', 'Ports +20 %', 'Forts de la Compagnie : fortifications +10 %'],
    ['Un comptoir : recrues −30 %', 'Jungle et fièvres : usure +10 %'],
    { trade: 0.3, port: 0.2, fort_bonus: 0.1, recrues: -0.3, attrition: 0.1 }, [0.25, 0.95, 0.3, 'civil'], 'livres',
    [[3, 4, 4, 3], 0.8], ['De Heere', 'Simons', 'Becker', 'Van Imhoff', 'Van Gollenesse', 'Falck', 'Van de Graaff', 'Van Angelbeek'], 'neerlandaise'),
};

// ------------------------------------------------------------------ cultures nouvelles (prénoms et noms écrits à la française)
const CULTURES = {
  moghole: {
    prenoms: ['Mohammed', 'Akbar', 'Bahadour', 'Farroukh', 'Mirza', 'Abdallah', 'Hussein', 'Ali', 'Kamar', 'Zoulfikar'],
    prenoms_f: ['Zeb-oun-Nissa', 'Nour Jahan', 'Moumtaz', 'Jahanara', 'Roshanara', 'Zinat'],
    noms: ['Zoulfikar Khan', 'Asad Khan', 'Daoud Khan', 'Saadat Khan', 'Kamar-oud-Din', 'Mir Joumla', 'Firouz Jang', 'Ghazi-oud-Din',
      'Hassan Ali Barha', 'Abdallah Barha', 'Mir Jafar', 'Alivardi Khan', 'Safdar Jang', 'Najaf Khan', 'Mahabat Khan', 'Abdous-Samad Khan'],
  },
  marathe: {
    prenoms: ['Shivaji', 'Sambhaji', 'Rajaram', 'Shahou', 'Baji Rao', 'Balaji', 'Madhav Rao', 'Mahadji', 'Yashwant Rao', 'Raghounath'],
    prenoms_f: ['Tarabaï', 'Yesoubaï', 'Ahilyabaï', 'Kashibaï', 'Mastani', 'Radhabaï'],
    noms: ['Dhanaji Jadhav', 'Santaji Ghorpade', 'Kanhoji Angre', 'Malhar Rao Holkar', 'Ranoji Scindia', 'Pilaji Gaekwad', 'Raghouji Bhonsle', 'Sadashiv Rao Bhau',
      'Ibrahim Gardi', 'Nana Phadnavis', 'Parashouram Bhau', 'Haripant Phadke', 'Daulat Rao Scindia', 'Bapou Gokhale', 'Toukoji Holkar', 'Chimaji Appa'],
  },
  kannada: {
    prenoms: ['Chikka Devaraja', 'Krishnaraja', 'Haïdar', 'Tipou', 'Nanjaraja', 'Devaraja', 'Chamaraja', 'Kanthirava', 'Basavaraja', 'Venkatappa'],
    prenoms_f: ['Lakshmammani', 'Devajammani', 'Chennammaji', 'Kempammaji', 'Fakhr-oun-Nissa', 'Roukaya'],
    noms: ['Haïdar Ali', 'Tipou Sultan', 'Mir Sadiq', 'Purnaiya', 'Sayyid Ghaffar', 'Kamar-oud-Din', 'Bourhan-oud-Din', 'Makhdoum Ali',
      'Fazl-oullah Khan', 'Kalale Nanjaraja', 'Devaraja Dalavoy', 'Khande Rao', 'Sardar Ali', 'Mir Moïn', 'Badr-ouz-Zaman', 'Dhoundia Wagh'],
  },
  sikhe: {
    prenoms: ['Gobind', 'Banda', 'Jassa', 'Ranjit', 'Hari', 'Sham', 'Kharak', 'Sher', 'Charat', 'Baghel'],
    prenoms_f: ['Sahib Kaur', 'Maï Bhago', 'Jind Kaur', 'Sada Kaur', 'Mehtab Kaur', 'Datar Kaur'],
    noms: ['Banda Bahadour', 'Jassa Singh Ahluwalia', 'Jassa Singh Ramgarhia', 'Charat Singh', 'Hari Singh Nalwa', 'Sham Singh Attariwala', 'Baghel Singh', 'Kapour Singh',
      'Mahan Singh', 'Mokham Chand', 'Phoula Singh', 'Lehna Singh Majithia', 'Goulab Singh', 'Tej Singh', 'Lal Singh', 'Chattar Singh'],
  },
  afghane: {
    prenoms: ['Mirwaïs', 'Mahmoud', 'Ashraf', 'Ahmad', 'Timour', 'Zaman', 'Shouja', 'Dost Mohammed', 'Akbar', 'Sher Ali'],
    prenoms_f: ['Nazo', 'Zarghouna', 'Malalaï', 'Babo', 'Gohar', 'Zeinab'],
    noms: ['Mirwaïs Hotak', 'Shah Wali Khan', 'Jahan Khan', 'Hadji Jamal Khan', 'Payenda Khan', 'Fateh Khan', 'Wazir Akbar Khan', 'Azim Khan',
      'Mohammed Afzal', 'Azam Khan', 'Yakoub Khan', 'Ayoub Khan', 'Nassir Khan', 'Mehrab Khan', 'Abdourrahman', 'Ghaus-oud-Din'],
  },
};

export default {
  id: 'inde', geo: 7, nom: 'Inde',
  cadre: { LON0: 60, LON1: 93, LAT0: 5.5, LAT1: 38.5, LAT_REF: 22, KM: 5 },
  places: [400, 900],
  espace: 75, // bourgs GeoNames plus serrés qu'en Europe (115 km) : l'Inde de 1790 est aussi peuplée que l'Europe sur moitié moins de terre
  ENTIERS, COUPES, DETROITS, FLEUVES,
  NE: { rivieres: [], lacs: [] }, // les fichiers globaux de 10 m suffisent
  PAYS,
  CULTURES,
  // îles trop petites pour la grille, gardées chacune par une case de terre (outil : ILES) : [lon, lat, camp, nom]
  ILES: [[70.982, 20.714, 'IGO', 'Diu']],
};
