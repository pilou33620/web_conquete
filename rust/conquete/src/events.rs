//! Événements historiques datés (1701-1898) et événements aléatoires, avec leurs choix.
//!
//! Chaque événement touche un ou plusieurs camps. Le joueur choisit dans une fenêtre (le jeu se met en pause) ;
//! sans réponse avant la fin du tour suivant (ANSWER_TOURS), la dernière option, la plus prudente, s'applique. L'IA choisit aussitôt.
//!
//! Effets (dictionnaire fx) :
//!   res       {ressource: quantité}            ajout (ou retrait) immédiat
//!   res_pct   {ressource: fraction}            −0,35 = un tiers des réserves perdu
//!   stab      fraction                         ordre public de toutes vos places
//!   weary     points                           lassitude de la guerre
//!   glory     points                           « Histoire » dans le prestige
//!   pop       fraction                         population de toutes vos places
//!   town_pop / town_stab                       la ville touchée seulement (événements aléatoires)
//!   ville     {nid, pop, stab, tm, add…}       événement local d'une place (voir cities.py)
//!   tmod      {modificateur: valeur}, days     effet temporaire (en jours)
//!   pmod      {modificateur: valeur}           effet durable
//!   rel       points                           ce que les autres camps pensent de vous
//!   regs      [[type, nombre]]                 régiments offerts, en garnison au chef-lieu
//!   research  1                                recherches en cours avancées de moitié
//!   chef, vassal, refus                        crise de succession (game/familles.py)
//!
//! Porte game/events.py (PORTAGE.md). SQUELETTE : les constantes sont portées ; les corps sont des `todo!()`. Une
//! signature ne se change pas sans le signaler. `ev` : un événement (dict de HIST, RANDOM ou cities.LOCAL) ;
//! `town` : un numéro de place ou None (`&Val`) ; `datetime.date` : `engine::Date`.
#![allow(unused_imports, unused_variables)] // squelette : à retirer quand les corps sont portés

use crate::cities as CT;
use crate::engine::{Date, Game};
use crate::familles as FM;
use crate::py::{self, Random, Val};
use crate::rules as R;
use crate::turns as TT;
use crate::{dict, list, py_const, pyset, tup};

pub const ALL: Val = Val::None; // `who=ALL` : tous les camps (`ev['who'] is not ALL` : `!ev.at("who").is_none()`)
pub const ANSWER_TOURS: i64 = 1;  // une décision attend jusqu'à la fin du tour qui suit (turns.deadline)
pub const RANDOM_GAP: (i64, i64) = (240, 540); // jours entre deux événements aléatoires pour un même camp

// (clé, nom) des modificateurs qui peuvent apparaître dans un effet
py_const!(MOD_LABEL, dict!{
    "livres" => "revenus en livres",
    "vivres" => "vivres",
    "fer" => "fer",
    "bois" => "bois",
    "recrues" => "recrues",
    "port" => "ports",
    "trade" => "commerce",
    "vin" => "revenus du vin",
    "lande_prod" => "landes et marais",
    "road_speed" => "vitesse sur route",
    "morale" => "moral",
    "research_speed" => "recherche",
    "order" => "ordre public",
    "industrie" => "industrie",
    "terroir" => "produits du terroir",
    "market" => "prix au marché",
});
py_const!(ABS_MODS, pyset!["morale"]);

// ------------------------------------------------------------------ événements datés
py_const!(HIST, list![
    dict!{
        "id" => "succession",
        "date" => tup![1701, 4, 1],
        "who" => ALL,
        "title" => "La guerre de Succession d'Espagne",
        "text" => "Louis XIV soutient son petit-fils Philippe V sur le trône d'Espagne ; l'Europe se ligue contre lui. L'intendant réclame des hommes et de l'argent à {chef}.",
        "choices" => list![
            dict!{
                "label" => "Lever des régiments pour le roi",
                "fx" => dict!{"res" => dict!{"recrues" => -300, "livres" => -150}, "glory" => 8},
                "ai" => 1,
            },
            dict!{
                "label" => "Payer le « don gratuit »",
                "fx" => dict!{"res" => dict!{"livres" => -350}, "glory" => 4},
                "ai" => 2,
            },
            dict!{"label" => "Faire traîner les choses", "fx" => dict!{"stab" => -0.06, "glory" => -2}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "grand_hiver",
        "date" => tup![1709, 1, 6],
        "who" => ALL,
        "title" => "Le Grand Hiver",
        "text" => "Le froid fend les arbres, gèle la Garonne et tue les semences. La famine menace autour {de_chef}.",
        "base" => dict!{"res_pct" => dict!{"vivres" => -0.35}},
        "choices" => list![
            dict!{
                "label" => "Ouvrir les greniers aux pauvres",
                "fx" => dict!{"res_pct" => dict!{"vivres" => -0.2}, "stab" => 0.08, "glory" => 4},
                "ai" => 2,
            },
            dict!{
                "label" => "Acheter du blé à prix d'or",
                "fx" => dict!{"res" => dict!{"livres" => -400, "vivres" => 350}},
                "ai" => 2,
            },
            dict!{"label" => "Laisser faire le marché", "fx" => dict!{"stab" => -0.12, "pop" => -0.05}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "regence",
        "date" => tup![1715, 9, 2],
        "who" => ALL,
        "title" => "La mort du Roi-Soleil",
        "text" => "Louis XIV s'éteint après soixante-douze ans de règne. Sous la Régence, l'étau se desserre.",
        "choices" => list![
            dict!{
                "label" => "Fêter le nouveau règne",
                "fx" => dict!{"res" => dict!{"livres" => -200}, "stab" => 0.06},
                "ai" => 1,
            },
            dict!{
                "label" => "Profiter du relâchement pour réduire les dépenses",
                "fx" => dict!{"res" => dict!{"livres" => 250}, "stab" => -0.03},
                "ai" => 1,
            },
        ],
    },
    dict!{
        "id" => "law",
        "date" => tup![1720, 7, 17],
        "who" => ALL,
        "title" => "La banqueroute de Law",
        "text" => "Le Système de Law s'effondre : les billets de la Banque royale ne valent plus rien, et les négociants {de_chef} crient à la ruine.",
        "base" => dict!{"res_pct" => dict!{"livres" => -0.15}},
        "choices" => list![
            dict!{
                "label" => "Rembourser les porteurs de billets",
                "fx" => dict!{"res" => dict!{"livres" => -300}, "stab" => 0.08, "glory" => 3},
                "ai" => 1,
            },
            dict!{
                "label" => "Laisser les spéculateurs à leur ruine",
                "fx" => dict!{"stab" => -0.08, "tmod" => dict!{"trade" => -0.1}, "days" => 1095},
                "ai" => 1,
            },
        ],
    },
    dict!{
        "id" => "tourny",
        "date" => tup![1743, 8, 1],
        "who" => tup!["33"],
        "title" => "L'intendant Tourny",
        "text" => "Aubert de Tourny veut abattre les vieux remparts de Bordeaux et tracer des allées, des places et des façades dignes d'une capitale.",
        "choices" => list![
            dict!{
                "label" => "Lancer les grands travaux",
                "fx" => dict!{
                    "res" => dict!{"livres" => -700},
                    "glory" => 10,
                    "pmod" => dict!{"livres" => 0.05},
                    "stab" => 0.03,
                },
                "ai" => 2,
            },
            dict!{"label" => "Garder l'argent pour les régiments", "fx" => dict!{}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "fors",
        "date" => tup![1748, 5, 1],
        "who" => tup!["64"],
        "title" => "Les fors du Béarn",
        "text" => "Les États de Béarn défendent leurs fors et leurs libertés contre les intendants de Versailles.",
        "choices" => list![
            dict!{
                "label" => "Défendre les fors",
                "fx" => dict!{"res" => dict!{"livres" => -150}, "stab" => 0.08, "glory" => 3},
                "ai" => 2,
            },
            dict!{
                "label" => "S'aligner sur Versailles",
                "fx" => dict!{"res" => dict!{"livres" => 300}, "stab" => -0.08},
                "ai" => 1,
            },
        ],
    },
    dict!{
        "id" => "sept_ans",
        "date" => tup![1756, 6, 1],
        "who" => ALL,
        "title" => "La guerre de Sept Ans",
        "text" => "La guerre reprend contre l'Angleterre. La Royal Navy bloque les côtes ; à Bayonne et à Bordeaux, on arme des corsaires.",
        "choices" => list![
            dict!{
                "label" => "Armer des corsaires",
                "fx" => dict!{
                    "res" => dict!{"livres" => 400},
                    "weary" => 5,
                    "glory" => 3,
                    "tmod" => dict!{"port" => -0.2},
                    "days" => 2555,
                },
                "ai" => 2,
            },
            dict!{
                "label" => "Commercer prudemment",
                "fx" => dict!{"tmod" => dict!{"port" => -0.3}, "days" => 2555},
                "ai" => 1,
            },
        ],
    },
    dict!{
        "id" => "maupeou",
        "date" => tup![1771, 2, 1],
        "who" => tup!["33", "24", "47"],
        "title" => "La réforme Maupeou",
        "text" => "Le chancelier Maupeou brise les parlements : celui de Bordeaux est exilé, remplacé par un Conseil supérieur.",
        "choices" => list![
            dict!{
                "label" => "Soutenir les parlementaires",
                "fx" => dict!{"res" => dict!{"livres" => -200}, "stab" => 0.05, "glory" => 2},
                "ai" => 1,
            },
            dict!{
                "label" => "Accueillir le Conseil supérieur",
                "fx" => dict!{"res" => dict!{"livres" => 200}, "stab" => -0.06},
                "ai" => 1,
            },
        ],
    },
    dict!{
        "id" => "farines",
        "date" => tup![1775, 5, 1],
        "who" => ALL,
        "title" => "La guerre des farines",
        "text" => "Turgot libère le commerce des grains : le pain renchérit et des émeutes éclatent sur les marchés.",
        "choices" => list![
            dict!{
                "label" => "Taxer le prix du pain",
                "fx" => dict!{"res" => dict!{"livres" => -250}, "stab" => 0.06},
                "ai" => 2,
            },
            dict!{
                "label" => "Laisser le commerce libre",
                "fx" => dict!{"stab" => -0.08, "tmod" => dict!{"trade" => 0.1}, "days" => 1825},
                "ai" => 1,
            },
        ],
    },
    dict!{
        "id" => "amerique",
        "date" => tup![1778, 3, 1],
        "who" => ALL,
        "title" => "L'indépendance américaine",
        "text" => "La France s'allie aux Insurgents. La Fayette a appareillé du port de Pasajes ; les armateurs arment pour les Antilles et l'Amérique.",
        "choices" => list![
            dict!{
                "label" => "Armer des navires pour l'Amérique",
                "fx" => dict!{
                    "res" => dict!{"livres" => -300},
                    "glory" => 6,
                    "tmod" => dict!{"port" => 0.15},
                    "days" => 1825,
                },
                "ai" => 1,
            },
            dict!{"label" => "S'en tenir à ses affaires", "fx" => dict!{}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "doleances",
        "date" => tup![1789, 3, 1],
        "who" => ALL,
        "title" => "Les cahiers de doléances",
        "text" => "Le roi convoque les États généraux. Dans chaque paroisse, on rédige les doléances du peuple.",
        "choices" => list![
            dict!{
                "label" => "Écouter le tiers état",
                "fx" => dict!{"res" => dict!{"livres" => -200}, "stab" => 0.08, "glory" => 5},
                "ai" => 2,
            },
            dict!{
                "label" => "Défendre les privilèges",
                "fx" => dict!{"res" => dict!{"livres" => 250}, "stab" => -0.12},
                "ai" => 1,
            },
        ],
    },
    dict!{
        "id" => "grande_peur",
        "date" => tup![1789, 7, 25],
        "who" => ALL,
        "title" => "La Grande Peur",
        "text" => "Des rumeurs de brigands affolent les campagnes ; on brûle les terriers et l'on assiège les châteaux.",
        "base" => dict!{"stab" => -0.08},
        "choices" => list![
            dict!{
                "label" => "Armer une milice citoyenne",
                "fx" => dict!{"res" => dict!{"livres" => -100}, "regs" => list![list!["garde", 2]]},
                "ai" => 2,
            },
            dict!{"label" => "Laisser passer l'orage", "fx" => dict!{"stab" => -0.05}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "girondins",
        "date" => tup![1793, 6, 2],
        "who" => tup!["33"],
        "title" => "La chute des Girondins",
        "text" => "Vergniaud, Guadet, Gensonné… les députés de la Gironde sont arrêtés à Paris. Bordeaux s'insurge contre la Montagne.",
        "choices" => list![
            dict!{
                "label" => "Lever une armée fédéraliste",
                "fx" => dict!{"regs" => list![list!["ligne", 1]], "glory" => 6, "stab" => 0.05, "rel" => -10},
                "ai" => 1,
            },
            dict!{"label" => "Se soumettre à la Montagne", "fx" => dict!{"stab" => -0.1}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "levee_masse",
        "date" => tup![1793, 8, 23],
        "who" => ALL,
        "title" => "La levée en masse",
        "text" => "La Convention réquisitionne tous les Français de 18 à 25 ans : « Les jeunes gens iront au combat. »",
        "choices" => list![
            dict!{
                "label" => "Appliquer le décret",
                "fx" => dict!{"res" => dict!{"recrues" => 1500}, "weary" => 8, "stab" => -0.05},
                "ai" => 2,
            },
            dict!{
                "label" => "Accorder des exemptions",
                "fx" => dict!{"res" => dict!{"recrues" => 500}, "stab" => 0.03},
                "ai" => 1,
            },
        ],
    },
    dict!{
        "id" => "sacre",
        "date" => tup![1804, 12, 2],
        "who" => ALL,
        "title" => "Le sacre de Napoléon",
        "text" => "À Notre-Dame, Napoléon pose lui-même la couronne sur sa tête. Les notables {de_chef} sont invités.",
        "choices" => list![
            dict!{
                "label" => "Envoyer une délégation au sacre",
                "fx" => dict!{"res" => dict!{"livres" => -300}, "glory" => 5, "stab" => 0.04},
                "ai" => 2,
            },
            dict!{"label" => "Rester réservé", "fx" => dict!{"stab" => -0.02}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "blocus",
        "date" => tup![1806, 11, 21],
        "who" => ALL,
        "title" => "Le Blocus continental",
        "text" => "Napoléon ferme les ports de l'Europe à l'Angleterre. Le négoce maritime s'effondre, les navires pourrissent à quai.",
        "base" => dict!{"tmod" => dict!{"port" => -0.4}, "days" => 2555},
        "choices" => list![
            dict!{
                "label" => "Fermer les yeux sur la contrebande",
                "fx" => dict!{"res" => dict!{"livres" => 300}, "stab" => -0.05},
                "ai" => 2,
            },
            dict!{"label" => "Faire respecter le blocus", "fx" => dict!{"glory" => 3}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "espagne",
        "date" => tup![1808, 5, 2],
        "who" => tup!["64", "40"],
        "title" => "La guerre d'Espagne",
        "text" => "Les armées impériales passent par Bayonne pour gagner Madrid ; l'Espagne se soulève contre l'occupant.",
        "choices" => list![
            dict!{
                "label" => "Fournir convois et étapes",
                "fx" => dict!{"res" => dict!{"vivres" => -300, "livres" => 250}},
                "ai" => 2,
            },
            dict!{"label" => "Garder les vivres pour soi", "fx" => dict!{"stab" => 0.03, "rel" => -5}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "douze_mars",
        "date" => tup![1814, 3, 12],
        "who" => tup!["33"],
        "title" => "Le 12 mars 1814",
        "text" => "Le maire Lynch ouvre Bordeaux aux Anglais de Beresford et arbore la cocarde blanche : la première ville de France à rappeler les Bourbons.",
        "choices" => list![
            dict!{"label" => "Se rallier aux Bourbons", "fx" => dict!{"glory" => 5, "stab" => 0.05}, "ai" => 2},
            dict!{
                "label" => "Rester fidèle à l'Empereur",
                "fx" => dict!{"stab" => -0.05, "tmod" => dict!{"morale" => 5}, "days" => 365},
                "ai" => 1,
            },
        ],
    },
    dict!{
        "id" => "cent_jours",
        "date" => tup![1815, 3, 20],
        "who" => ALL,
        "title" => "Les Cent-Jours",
        "text" => "Napoléon revient de l'île d'Elbe et marche sur Paris. La duchesse d'Angoulême tente de tenir Bordeaux pour le roi.",
        "choices" => list![
            dict!{
                "label" => "Suivre l'Empereur",
                "fx" => dict!{"res" => dict!{"recrues" => 400}, "weary" => 5},
                "ai" => 1,
            },
            dict!{"label" => "Rester fidèle au roi", "fx" => dict!{"stab" => 0.04}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "glorieuses",
        "date" => tup![1830, 7, 29],
        "who" => ALL,
        "title" => "Les Trois Glorieuses",
        "text" => "Paris se couvre de barricades ; Charles X abdique et Louis-Philippe devient roi des Français.",
        "choices" => list![
            dict!{"label" => "Arborer le drapeau tricolore", "fx" => dict!{"stab" => 0.03, "glory" => 2}, "ai" => 2},
            dict!{"label" => "Soutenir Charles X", "fx" => dict!{"stab" => -0.06}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "cholera",
        "date" => tup![1832, 4, 1],
        "who" => ALL,
        "title" => "Le choléra",
        "text" => "Le choléra venu d'Asie frappe la France. Les quartiers pauvres {de_chef} se vident.",
        "base" => dict!{"pop" => -0.03},
        "choices" => list![
            dict!{
                "label" => "Lazarets et quarantaines",
                "fx" => dict!{"res" => dict!{"livres" => -300}, "stab" => 0.04},
                "ai" => 2,
            },
            dict!{"label" => "Ne rien faire", "fx" => dict!{"pop" => -0.04, "stab" => -0.05}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "la_teste",
        "date" => tup![1841, 7, 6],
        "who" => tup!["33"],
        "title" => "Le chemin de fer de La Teste",
        "text" => "Le premier train relie Bordeaux à La Teste. Les frères Pereire cherchent des actionnaires.",
        "choices" => list![
            dict!{
                "label" => "Investir dans la compagnie",
                "fx" => dict!{"res" => dict!{"livres" => -500}, "glory" => 3, "pmod" => dict!{"road_speed" => 0.08}},
                "ai" => 2,
            },
            dict!{"label" => "Laisser faire les banquiers", "fx" => dict!{}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "rev1848",
        "date" => tup![1848, 2, 24],
        "who" => ALL,
        "title" => "La révolution de 1848",
        "text" => "Louis-Philippe abdique. La IIe République proclame le suffrage universel et l'abolition de l'esclavage.",
        "choices" => list![
            dict!{
                "label" => "Ouvrir des ateliers nationaux",
                "fx" => dict!{"res" => dict!{"livres" => -400}, "stab" => 0.08, "glory" => 2},
                "ai" => 1,
            },
            dict!{"label" => "Rétablir l'ordre", "fx" => dict!{"stab" => -0.05}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "biarritz",
        "date" => tup![1854, 7, 1],
        "who" => tup!["64"],
        "title" => "Biarritz impériale",
        "text" => "L'impératrice Eugénie fait de Biarritz la plage à la mode ; la villa Eugénie sort des dunes.",
        "choices" => list![
            dict!{
                "label" => "Accueillir la cour",
                "fx" => dict!{"res" => dict!{"livres" => -300}, "glory" => 4, "pmod" => dict!{"livres" => 0.06}},
                "ai" => 2,
            },
            dict!{"label" => "Laisser les baigneurs à leurs vagues", "fx" => dict!{}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "classement",
        "date" => tup![1855, 4, 18],
        "who" => tup!["33"],
        "title" => "Le classement de 1855",
        "text" => "Pour l'Exposition universelle, les courtiers classent les grands crus du Médoc et de Sauternes.",
        "base" => dict!{"pmod" => dict!{"vin" => 0.2}},
        "choices" => list![
            dict!{
                "label" => "Donner une grande fête",
                "fx" => dict!{"res" => dict!{"livres" => -200}, "glory" => 5},
                "ai" => 1,
            },
            dict!{"label" => "Placer les profits", "fx" => dict!{"res" => dict!{"livres" => 300}}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "landes1857",
        "date" => tup![1857, 6, 19],
        "who" => tup!["40"],
        "title" => "La loi d'assainissement des Landes",
        "text" => "Napoléon III ordonne aux communes de drainer la lande et d'y semer des pins.",
        "choices" => list![
            dict!{
                "label" => "Planter des pins partout",
                "fx" => dict!{
                    "res" => dict!{"livres" => -400},
                    "glory" => 4,
                    "pmod" => dict!{"lande_prod" => 0.25, "bois" => 0.15},
                },
                "ai" => 2,
            },
            dict!{"label" => "Garder les parcours des bergers", "fx" => dict!{"stab" => 0.05}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "guerre1870",
        "date" => tup![1870, 7, 19],
        "who" => ALL,
        "title" => "La guerre franco-prussienne",
        "text" => "La France déclare la guerre à la Prusse. On lève les gardes mobiles pour l'armée de la Loire.",
        "choices" => list![
            dict!{
                "label" => "Lever les gardes mobiles",
                "fx" => dict!{"res" => dict!{"recrues" => 1000}, "weary" => 10, "glory" => 4},
                "ai" => 2,
            },
            dict!{"label" => "Garder ses hommes", "fx" => dict!{"stab" => -0.05}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "delegation",
        "date" => tup![1870, 12, 10],
        "who" => tup!["33"],
        "title" => "Le gouvernement à Bordeaux",
        "text" => "La Délégation quitte Tours : Gambetta gouverne la France depuis Bordeaux, puis l'Assemblée y siège au Grand-Théâtre.",
        "base" => dict!{"glory" => 6},
        "choices" => list![
            dict!{
                "label" => "Accueillir l'Assemblée",
                "fx" => dict!{"res" => dict!{"livres" => -200}, "stab" => 0.05},
                "ai" => 2,
            },
            dict!{"label" => "Laisser l'État payer", "fx" => dict!{}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "commune",
        "date" => tup![1871, 3, 18],
        "who" => ALL,
        "title" => "La Commune",
        "text" => "Paris se soulève contre l'Assemblée réfugiée à Versailles.",
        "choices" => list![
            dict!{
                "label" => "Envoyer des troupes à Versailles",
                "fx" => dict!{"weary" => 5, "stab" => 0.03},
                "ai" => 1,
            },
            dict!{"label" => "Prêcher la conciliation", "fx" => dict!{"stab" => -0.03, "glory" => 2}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "phylloxera",
        "date" => tup![1875, 6, 1],
        "who" => ALL,
        "title" => "Le phylloxéra",
        "text" => "Un puceron venu d'Amérique dévore les racines des vignes. Les vignobles meurent les uns après les autres.",
        "base" => dict!{"tmod" => dict!{"vin" => -0.5}, "days" => 4380},
        "choices" => list![
            dict!{
                "label" => "Arracher et replanter en plants américains",
                "fx" => dict!{"res" => dict!{"livres" => -500}, "tmod" => dict!{"vin" => 0.3}, "days" => 4380},
                "ai" => 2,
            },
            dict!{"label" => "Sulfure de carbone et prières", "fx" => dict!{"stab" => -0.05}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "mildiou",
        "date" => tup![1882, 6, 1],
        "who" => ALL,
        "title" => "Le mildiou",
        "text" => "Après le phylloxéra, un champignon venu d'Amérique dessèche les feuilles des vignes {de_chef}.",
        "base" => dict!{"tmod" => dict!{"vin" => -0.25}, "days" => 2190},
        "choices" => list![
            dict!{
                "label" => "Sulfater les vignes au cuivre",
                "fx" => dict!{"res" => dict!{"livres" => -300}, "tmod" => dict!{"vin" => 0.15}, "days" => 2190},
                "ai" => 2,
            },
            dict!{"label" => "Attendre une meilleure année", "fx" => dict!{"stab" => -0.03}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "expo1889",
        "date" => tup![1889, 5, 6],
        "who" => ALL,
        "title" => "L'Exposition universelle de 1889",
        "text" => "La tour de M. Eiffel domine le Champ-de-Mars. Chaque région y montre ce qu'elle a de meilleur.",
        "choices" => list![
            dict!{
                "label" => "Exposer vos produits à Paris",
                "fx" => dict!{
                    "res" => dict!{"livres" => -300},
                    "glory" => 4,
                    "tmod" => dict!{"trade" => 0.15},
                    "days" => 1825,
                },
                "ai" => 2,
            },
            dict!{"label" => "Rester chez soi", "fx" => dict!{}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "dreyfus",
        "date" => tup![1898, 1, 13],
        "who" => ALL,
        "title" => "« J’accuse… ! »",
        "text" => "Zola accuse l'état-major d'avoir condamné un innocent. L'affaire Dreyfus déchire la France.",
        "choices" => list![
            dict!{
                "label" => "Soutenir la révision du procès",
                "fx" => dict!{"stab" => -0.05, "glory" => 4},
                "ai" => 1,
            },
            dict!{
                "label" => "Défendre l'honneur de l'armée",
                "fx" => dict!{"stab" => 0.03, "tmod" => dict!{"morale" => 5}, "days" => 730},
                "ai" => 1,
            },
        ],
    },
]);
py_const!(HIST_BY_ID, {
    let d = dict! {};
    for e in HIST().iter() {
        d.set(e.at("id"), e);
    }
    d
}); // (les mêmes dict que HIST)

// ------------------------------------------------------------------ événements aléatoires

/// (minuscule à l'initiale seulement : les noms propres du libellé restent)
/// Python : `_min1(s)`.
/// (minuscule à l'initiale seulement : les noms propres du libellé restent)
// game/events.py, lignes 197 à 198
pub fn _min1(s: &str) -> String {
    todo!()
}

/// Python : `_has_port(g, code)`.
// game/events.py, lignes 200 à 201
pub fn _has_port(g: &Game, code: &str) -> bool {
    todo!()
}

/// Python : `_contrebande_ok(g, code)`.
// game/events.py, lignes 204 à 205
pub fn _contrebande_ok(g: &Game, code: &str) -> bool {
    todo!()
}

/// Une douane chère attire les contrebandiers (SPEC-MERCENAIRES.md) : 2 en tarif libre, jusqu'à 7 environ.
/// Python : `_contrebande_w(g, code)`.
// game/events.py, lignes 208 à 210
pub fn _contrebande_w(g: &Game, code: &str) -> f64 {
    todo!()
}

// incendies, fièvres, brigands et foires touchent désormais une seule ville : voir les événements locaux (cities.py)
py_const!(RANDOM, list![
    dict!{
        "id" => "recolte",
        "w" => 3,
        "season" => tup!["été", "automne"],
        "title" => "Une récolte magnifique",
        "text" => "Les greniers débordent : jamais on n'avait vu pareille moisson.",
        "base" => dict!{"res_pct" => dict!{"vivres" => 0.25}},
    },
    dict!{
        "id" => "epizootie",
        "w" => 2,
        "title" => "Une épizootie",
        "text" => "Une maladie décime les bœufs et les moutons dans les campagnes.",
        "base" => dict!{"res_pct" => dict!{"vivres" => -0.15}},
    },
    dict!{
        "id" => "legs",
        "w" => 2,
        "title" => "Le legs d'un négociant",
        "text" => "Un riche négociant {de_ville} lègue sa fortune à la province.",
        "base" => dict!{"res" => dict!{"livres" => 400}},
    },
    dict!{
        "id" => "filon",
        "w" => 1,
        "title" => "Un filon de fer",
        "text" => "Des mineurs découvrent un filon de fer près {de_ville}.",
        "base" => dict!{"pmod" => dict!{"fer" => 0.08}},
    },
    dict!{
        "id" => "savant",
        "w" => 1,
        "title" => "Un savant {a_ville}",
        "text" => "Un savant renommé propose de s'installer à {ville} si on le pensionne.",
        "choices" => list![
            dict!{
                "label" => "Le pensionner",
                "fx" => dict!{"res" => dict!{"livres" => -250}, "research" => 1},
                "ai" => 2,
            },
            dict!{"label" => "Le laisser partir", "fx" => dict!{}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "contrebande",
        "w" => "_contrebande_w",
        "cond" => "_contrebande_ok",
        "title" => "Des contrebandiers",
        "text" => "Des contrebandiers débarquent du tabac et des toiles anglaises près {de_ville}.",
        "choices" => list![
            dict!{
                "label" => "Fermer les yeux contre une part",
                "fx" => dict!{"res" => dict!{"livres" => 250}, "stab" => -0.03},
                "ai" => 2,
            },
            dict!{
                "label" => "Saisir la marchandise",
                "fx" => dict!{"res" => dict!{"livres" => 100}, "stab" => 0.02},
                "ai" => 1,
            },
        ],
    },
]);
py_const!(RANDOM_BY_ID, {
    let d = dict! {};
    for e in RANDOM().iter() {
        d.set(e.at("id"), e);
    }
    d
}); // (les mêmes dict que RANDOM)

/// Les fonctions que RANDOM tient (`w=_contrebande_w`, `cond=_contrebande_ok`) : une valeur ne tient pas de fonction,
/// RANDOM tient donc leur nom. `e['w'](g, code) if callable(e['w']) else e['w']` s'écrit : si `e.at("w")` est un
/// texte, `_RANDOM_W(e.at("w").s())(g, code)`, sinon le nombre ; `e['cond'](g, code)` : `_RANDOM_COND(…)(g, code)`.
pub fn _RANDOM_W(nom: &str) -> fn(&Game, &str) -> f64 {
    match nom {
        "_contrebande_w" => _contrebande_w,
        _ => panic!("pas de fonction de poids {nom:?} dans RANDOM"),
    }
}
pub fn _RANDOM_COND(nom: &str) -> fn(&Game, &str) -> bool {
    match nom {
        "_contrebande_ok" => _contrebande_ok,
        _ => panic!("pas de condition {nom:?} dans RANDOM"),
    }
}

// ------------------------------------------------------------------ textes

/// Python : `_fill(g, code, s, town=None)`.
/// `s.format(nom=…, chef=…, de_chef=…, ville=…, de_ville=…, a_ville=…)` : remplacer chaque {clé} du texte.
// game/events.py, lignes 236 à 241
pub fn _fill(g: &Game, code: &str, s: &str, town: &Val) -> String {
    todo!()
}

/// Python : `_pct(v)`.
// game/events.py, lignes 244 à 245
pub fn _pct(v: f64) -> String {
    todo!()
}

/// Python : `_years(days)`.
// game/events.py, lignes 248 à 250
pub fn _years(days: f64) -> String {
    todo!()
}

/// Les effets en clair, pour la fenêtre de choix et le journal.
/// Python : `describe(g, code, fx, town=None)`.
/// Rend une liste de textes (au moins un : ['aucun effet']).
/// Piège : `abs(v)` des tmod / pmod garde le type du Python (5 et non 5.0 dans le texte).
// game/events.py, lignes 253 à 290
pub fn describe(g: &Game, code: &str, fx: &Val, town: &Val) -> Val {
    todo!()
}

/// Python : `affordable(g, code, fx)`.
// game/events.py, lignes 293 à 299
pub fn affordable(g: &Game, code: &str, fx: &Val) -> bool {
    todo!()
}

// ------------------------------------------------------------------ effets

/// Python : `apply(g, code, fx, town=None)`.
// game/events.py, lignes 303 à 357
pub fn apply(g: &mut Game, code: &str, fx: &Val, town: &Val) {
    todo!()
}

// ------------------------------------------------------------------ déclenchement

/// Python : `_ord(date)`.
/// date : un tuple (année, mois, jour) : `Date::de(date).toordinal()`.
// game/events.py, lignes 361 à 362
pub fn _ord(date: &Val) -> i64 {
    todo!()
}

/// Appelé chaque jour : événements datés du jour, puis événements aléatoires.
/// Python : `tick(g, d)`.
/// `R.FACTIONS` quand ev['who'] est ALL : ses clés, dans l'ordre. Hasard : g.rng (uniform, puis
/// `choices(pool, poids)[0]` → `choix_pondere`), dans l'ordre des camps.
// game/events.py, lignes 365 à 392
pub fn tick(g: &mut Game, d: Date) {
    todo!()
}

// événements qu'une technologie atténue (SPEC-TECH.md) : la clé d'effet du camp (−0,5 : moitié moins)
py_const!(ATTENUE, dict!{
    "cholera" => "epidemics",
    "epidemie" => "epidemics",
    "blocus" => "blockade",
    "phylloxera" => "vine_blight",
    "mildiou" => "vine_blight",
});

/// Valeur d'un effet temporaire pour un camp de ces effets (mods) : atténuée par ses technologies si son événement
/// est de ceux d'ATTENUE (Game.recompute_mods, et le panneau des effets).
/// Python : `tmod_value(e, mods)`.
/// e : un effet temporaire dict(k, v, until[, ev]) ; mods : un dict {effet: valeur}.
// game/events.py, lignes 399 à 405
pub fn tmod_value(e: &Val, mods: &Val) -> f64 {
    todo!()
}

/// L'effet d'un événement pour ce camp : ses pertes de population atténuées par ses technologies, ses effets
/// temporaires étiquetés (Game.recompute_mods les atténue, même pour une technologie trouvée après).
/// Python : `soften(g, code, ev, fx)`.
/// ev : l'identifiant de l'événement. Piège : hors d'ATTENUE, rend fx lui-même (le même objet, souvent un dict de
/// HIST) ; sinon une copie (`dict(fx, ev=ev)`, et `dict(fx['ville'], …)`).
// game/events.py, lignes 408 à 420
pub fn soften(g: &Game, code: &str, ev: &str, fx: &Val) -> Val {
    todo!()
}

/// Python : `fire(g, code, ev, kind)`.
/// kind : 'hist' ou 'rand'.
// game/events.py, lignes 423 à 455
pub fn fire(g: &mut Game, code: &str, ev: &Val, kind: &str) {
    todo!()
}

/// Python : `resolve(g, pid, choice, auto=False)`.
/// pid : l'identifiant de la décision (g.nid('e')) ; auto : False par défaut (expire passe True).
// game/events.py, lignes 458 à 471
pub fn resolve(g: &mut Game, pid: &str, choice: i64, auto: bool) -> (bool, String) {
    todo!()
}

/// Python : `expire(g)`.
// game/events.py, lignes 474 à 479
pub fn expire(g: &mut Game) {
    todo!()
}
