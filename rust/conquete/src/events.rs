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
//! Porte game/events.py (PORTAGE.md). Une signature ne se change pas sans le signaler. `ev` : un événement
//! (dict de HIST, RANDOM ou cities.LOCAL) ; `town` : un numéro de place ou None (`&Val`) ; `datetime.date` :
//! `engine::Date`. Aides propres au portage (absentes du Python) : `_format` (`str.format` à clés nommées),
//! `_a_ville`, `_join`, `_min` / `_max` (`min(a, b)` / `max(a, b)` de Python sur des valeurs).

use crate::cities as CT;
use crate::engine::{Date, Game};
use crate::familles as FM;
use crate::py::{self, Val};
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
    let mut c = s.chars();
    match c.next() {
        Some(p) => p.to_lowercase().chain(c).collect(),
        None => String::new(),
    }
}

/// Python : `_has_port(g, code)`.
// game/events.py, lignes 200 à 201
pub fn _has_port(g: &Game, code: &str) -> bool {
    g.owned_nodes(code).iter().any(|n| g.geo.nodes.at(n.at("id")).at("spec").has("port"))
}

/// Python : `_contrebande_ok(g, code)`.
// game/events.py, lignes 204 à 205
pub fn _contrebande_ok(g: &Game, code: &str) -> bool {
    _has_port(g, code) || g.factions.at(code).at("tarif") > 0i64
}

/// Une douane chère attire les contrebandiers (SPEC-MERCENAIRES.md) : 2 en tarif libre, jusqu'à 7 environ.
/// Python : `_contrebande_w(g, code)`.
// game/events.py, lignes 208 à 210
pub fn _contrebande_w(g: &Game, code: &str) -> f64 {
    2.0 * (1.0 + 5.0 * g.contrebande(code))
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

/// `s.format(cle=valeur, …)` : chaque `{cle}` du texte remplacé, en un seul passage (KeyError pour une clé inconnue).
pub(crate) fn _format(s: &str, kw: &[(&str, String)]) -> String {
    let mut out = String::new();
    let mut reste = s;
    while let Some(i) = reste.find('{') {
        out.push_str(&reste[..i]);
        let j = reste[i..].find('}').map(|j| i + j).unwrap_or_else(|| panic!("ValueError: '}}' attendu dans {s:?}"));
        let cle = &reste[i + 1..j];
        match kw.iter().find(|(k, _)| *k == cle) {
            Some((_, v)) => out.push_str(v),
            None => panic!("KeyError: {}", py::repr_s(cle)),
        }
        reste = &reste[j + 1..];
    }
    out.push_str(reste);
    out
}

/// `'au ' + v[3:] if v.startswith('Le ') else ('aux ' + v[4:] if v.startswith('Les ') else f"à {v}")`.
pub(crate) fn _a_ville(v: &str) -> String {
    if let Some(r) = v.strip_prefix("Le ") {
        format!("au {r}")
    } else if let Some(r) = v.strip_prefix("Les ") {
        format!("aux {r}")
    } else {
        format!("à {v}")
    }
}

/// `', '.join(l)` d'une liste de textes.
pub(crate) fn _join(l: &Val) -> String {
    l.iter().map(|x| x.string()).collect::<Vec<_>>().join(", ")
}

/// `min(a, b)` de Python : a, sauf si b est plus petit.
pub(crate) fn _min(a: Val, b: Val) -> Val {
    if b < a { b } else { a }
}

/// `max(a, b)` de Python : a, sauf si b est plus grand.
pub(crate) fn _max(a: Val, b: Val) -> Val {
    if b > a { b } else { a }
}

/// Python : `_fill(g, code, s, town=None)`.
/// `s.format(nom=…, chef=…, de_chef=…, ville=…, de_ville=…, a_ville=…)` : remplacer chaque {clé} du texte.
// game/events.py, lignes 236 à 241
pub fn _fill(g: &Game, code: &str, s: &str, town: &Val) -> String {
    let cap = g.capital_of(code);
    let chef = g.geo.nodes.at(&cap).ats("name");
    let ville = if town.is_some() { g.geo.nodes.at(town).ats("name") } else { chef.clone() };
    let a_ville = _a_ville(&ville);
    // (géographie 5 : un pays n'est pas une province)
    let s = &(if g.europe() { s.replace("à la province", "au pays") } else { s.to_string() });
    _format(s, &[("nom", g.fname(code)), ("chef", chef.clone()), ("de_chef", R::de(&chef)), ("de_ville", R::de(&ville)), ("ville", ville), ("a_ville", a_ville)])
}

/// Python : `_pct(v)`.
// game/events.py, lignes 244 à 245
pub fn _pct(v: f64) -> String {
    format!("{}{} %", if v > 0.0 { "+" } else { "−" }, py::round(v * 100.0).abs())
}

/// Python : `_years(days)`.
// game/events.py, lignes 248 à 250
pub fn _years(days: f64) -> String {
    let y = py::round(days / 365.0);
    if y >= 1 {
        format!("{y} an{}", if y > 1 { "s" } else { "" })
    } else {
        let n = py::int(days / 30.0 + 0.5);
        R::pl(if n > 1 { n } else { 1 }, "tour", None)
    }
}

/// Les effets en clair, pour la fenêtre de choix et le journal.
/// Python : `describe(g, code, fx, town=None)`.
/// Rend une liste de textes (au moins un : ['aucun effet']).
/// Piège : `abs(v)` des tmod / pmod garde le type du Python (5 et non 5.0 dans le texte).
// game/events.py, lignes 253 à 290
pub fn describe(g: &Game, code: &str, fx: &Val, town: &Val) -> Val {
    let out = list![];
    let signe = |v: &Val| if *v > 0i64 { "+" } else { "−" };
    let res = fx.get("res");
    for (k, v) in (if res.truthy() { res } else { dict! {} }).items() {
        out.push(format!("{}{} {}", signe(&v), py::int_v(&v).abs(), R::RES_LABEL().get_or(&k, &k).s().to_lowercase()));
    }
    let res_pct = fx.get("res_pct");
    for (k, v) in (if res_pct.truthy() { res_pct } else { dict! {} }).items() {
        out.push(format!("{} {}", R::RES_LABEL().get_or(&k, &k).s().to_lowercase(), _pct(v.f())));
    }
    if fx.getb("stab") {
        out.push(format!("ordre public {}", _pct(fx.atf("stab"))));
    }
    if fx.getb("town_stab") && town.is_some() {
        out.push(format!("ordre public {} {}", R::de(g.geo.nodes.at(town).at("name").s()), _pct(fx.atf("town_stab"))));
    }
    if fx.getb("pop") {
        out.push(format!("population {}", _pct(fx.atf("pop"))));
    }
    if fx.getb("town_pop") && town.is_some() {
        out.push(format!("population {} {}", R::de(g.geo.nodes.at(town).at("name").s()), _pct(fx.atf("town_pop"))));
    }
    if fx.getb("weary") {
        out.push(format!("lassitude {}{}", signe(&fx.at("weary")), py::int_v(&fx.at("weary")).abs()));
    }
    if fx.getb("glory") {
        out.push(format!("prestige (histoire) {}{}", signe(&fx.at("glory")), py::int_v(&fx.at("glory")).abs()));
    }
    let tmod = fx.get("tmod");
    for (k, v) in (if tmod.truthy() { tmod } else { dict! {} }).items() {
        let val = if ABS_MODS().has(&k) { format!("{}{}", signe(&v), v.abs()) } else { _pct(v.f()) };
        out.push(format!("{} {val} pendant {}", MOD_LABEL().get_or(&k, &k), _years(fx.get_or("days", 365).f())));
    }
    let pmod = fx.get("pmod");
    for (k, v) in (if pmod.truthy() { pmod } else { dict! {} }).items() {
        let val = if ABS_MODS().has(&k) { format!("{}{}", signe(&v), v.abs()) } else { _pct(v.f()) };
        out.push(format!("{} {val} (durable)", MOD_LABEL().get_or(&k, &k)));
    }
    if fx.getb("rel") {
        out.push(format!("relations avec les autres camps {}{}", signe(&fx.at("rel")), py::int_v(&fx.at("rel")).abs()));
    }
    let regs = fx.get("regs");
    for tc in (if regs.truthy() { regs } else { list![] }).iter() {
        let (typ, cnt) = tc.pair();
        out.push(format!("+{cnt} {} {}", g.unit_name(code, typ.s()).1.to_lowercase(), if g.europe() { "à la capitale" } else { "au chef-lieu" }));
    }
    if fx.getb("research") {
        out.push("recherches en cours avancées de moitié");
    }
    if fx.getb("ville") {
        out.extend(&CT::describe_local(g, &fx.at("ville"))); // événements locaux (game/cities.py)
    }
    if fx.getb("chef") {
        out.extend(&FM::decrire(g, fx)); // crise de succession (game/familles.py)
    }
    if out.truthy() { out } else { list!["aucun effet"] }
}

/// Python : `affordable(g, code, fx)`.
// game/events.py, lignes 293 à 299
pub fn affordable(g: &Game, code: &str, fx: &Val) -> bool {
    let r = g.factions.at(code).at("res");
    if fx.getb("ville") && !CT::local_ok(g, code, &fx.at("ville")) {
        return false;
    }
    let res = fx.get("res");
    (if res.truthy() { res } else { dict! {} }).items().iter().all(|(k, v)| &r.get_or(k, 0) + v >= 0i64)
}

// ------------------------------------------------------------------ effets

/// Python : `apply(g, code, fx, town=None)`.
// game/events.py, lignes 303 à 357
pub fn apply(g: &mut Game, code: &str, fx: &Val, town: &Val) {
    let f = g.factions.at(code);
    let r = f.at("res");
    let res = fx.get("res");
    for (k, v) in (if res.truthy() { res } else { dict! {} }).items() {
        let cur = r.get_or(&k, 0);
        // jamais sous 0 par l'événement, mais une dette (banqueroute) reste une dette
        r.set(&k, _max(_min(cur.clone(), Val::from(0.0)), &cur + &v));
    }
    let res_pct = fx.get("res_pct");
    for (k, v) in (if res_pct.truthy() { res_pct } else { dict! {} }).items() {
        if r.get_or(&k, 0) > 0i64 {
            r.set(&k, _max(Val::from(0.0), &r.at(&k) * &(1i64 + &v))); // (un pourcentage ne s'applique qu'à un avoir, pas à une dette)
        }
    }
    let mine = g.owned_nodes(code);
    if fx.getb("stab") {
        for n in mine.iter() {
            n.set("stab", _max(Val::from(0.0), _min(Val::from(1.0), &n.at("stab") + &fx.at("stab"))));
        }
    }
    if fx.getb("pop") {
        for n in mine.iter() {
            n.set("pop", &n.get_or("pop", 0) * &(1i64 + &fx.at("pop")));
        }
    }
    if town.is_some() && g.nodes.at(town).at("owner") == code {
        let n = g.nodes.at(town);
        if fx.getb("town_pop") {
            n.set("pop", &n.get_or("pop", 0) * &(1i64 + &fx.at("town_pop")));
        }
        if fx.getb("town_stab") {
            n.set("stab", _max(Val::from(0.0), _min(Val::from(1.0), &n.at("stab") + &fx.at("town_stab"))));
        }
    }
    if fx.getb("weary") {
        f.set("weary", _max(Val::from(0.0), _min(Val::from(100.0), &f.get_or("weary", 0) + &fx.at("weary"))));
    }
    if fx.getb("glory") {
        f.set("glory", &f.get_or("glory", 0.0) + &fx.at("glory"));
    }
    if fx.getb("tmod") {
        let until = g.t + &fx.get_or("days", 365);
        for (k, v) in fx.at("tmod").items() {
            let e = dict! {"k" => k, "v" => v, "until" => &until};
            if fx.getb("ev") {
                e.set("ev", fx.at("ev"));
            }
            f.setdefault("tmods", list![]).push(e);
        }
    }
    let pmod = fx.get("pmod");
    for (k, v) in (if pmod.truthy() { pmod } else { dict! {} }).items() {
        let em = f.setdefault("emods", dict! {});
        em.set(&k, &em.get_or(&k, 0) + &v);
    }
    if fx.getb("rel") {
        for (o, of) in g.factions.items() {
            if o != code {
                let rel = of.at("rel");
                rel.set(code, _max(Val::from(-100), _min(Val::from(100), &rel.at(code) + &fx.at("rel"))));
            }
        }
    }
    if fx.getb("regs") {
        let cap = g.capital_of(code);
        if g.nodes.at(&cap).at("owner") == code {
            for tc in fx.at("regs").iter() {
                let (typ, cnt) = tc.pair();
                for _ in 0..cnt.i() {
                    let reg = g.new_reg(typ.s(), &Val::None, &Val::from(code));
                    g.nodes.at(&cap).at("garrison").push(reg);
                }
            }
        }
    }
    if fx.getb("research") {
        for cur in f.at("research").values() {
            if cur.truthy() {
                cur.scale("left", 0.5);
            }
        }
    }
    if fx.getb("ville") {
        CT::apply_local(g, code, &fx.at("ville"));
    }
    if fx.getb("chef") {
        FM::appliquer(g, code, fx);
    }
    g.recompute_mods(code);
    g._dirty_income = true;
}

// ------------------------------------------------------------------ déclenchement

/// Python : `_ord(date)`.
/// date : un tuple (année, mois, jour) : `Date::de(date).toordinal()`.
// game/events.py, lignes 361 à 362
pub fn _ord(date: &Val) -> i64 {
    Date::de(date).toordinal()
}

/// Appelé chaque jour : événements datés du jour, puis événements aléatoires.
/// Python : `tick(g, d)`.
/// `R.FACTIONS` quand ev['who'] est ALL : ses clés, dans l'ordre. Hasard : g.rng (uniform, puis
/// `choices(pool, poids)[0]` → `choix_pondere`), dans l'ordre des camps.
// game/events.py, lignes 365 à 392
pub fn tick(g: &mut Game, d: Date) {
    let today = d.toordinal();
    let done = g.ev_done.clone();
    // (géographie 5 : l'histoire datée est celle de la France et de ses provinces ; les pays d'Europe n'ont que les
    // événements sans date, plus bas)
    for ev in (if g.europe() { list![] } else { HIST() }).iter() {
        if done.has(ev.at("id")) {
            continue;
        }
        let o = _ord(&ev.at("date"));
        if o > today {
            continue;
        }
        done.push(ev.at("id"));
        if o < g.start_ord {
            continue; // avant le début de la partie : c'est de l'histoire ancienne
        }
        for code in ev.at("who").or(R::FACTIONS()).iter() {
            if g.factions.has(&code) && g.factions.at(&code).atb("alive") {
                fire(g, code.s(), &ev, "hist");
            }
        }
    }
    for (code, f) in g.factions.items() {
        let code = code.string();
        if !f.atb("alive") {
            continue;
        }
        if !f.has("ev_next") {
            f.set("ev_next", g.t + g.rng.uniform(RANDOM_GAP.0 as f64, RANDOM_GAP.1 as f64));
        }
        if f.at("ev_next") > g.t {
            continue;
        }
        f.set("ev_next", g.t + g.rng.uniform(RANDOM_GAP.0 as f64, RANDOM_GAP.1 as f64));
        let season = Val::from(g.season());
        let pool: Vec<Val> = RANDOM()
            .iter()
            .filter(|e| {
                e.get_or("season", tup![&season]).has(&season)
                    && (!e.getb("cond") || _RANDOM_COND(e.at("cond").s())(g, &code))
            })
            .collect();
        if !pool.is_empty() {
            let w: Vec<f64> = pool
                .iter()
                .map(|e| { let w = e.at("w"); if w.is_str() { _RANDOM_W(w.s())(g, &code) } else { w.f() } })
                .collect();
            let ev = g.rng.choix_pondere(&pool, &w);
            fire(g, &code, &ev, "rand");
        }
    }
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
    let mut v = e.atf("v");
    if v < 0.0 && ATTENUE().has(e.get("ev")) {
        let k = 1.0 + mods.get_or(ATTENUE().at(e.at("ev")), 0).f();
        v *= if k > 0.0 { k } else { 0.0 };
    }
    v
}

/// L'effet d'un événement pour ce camp : ses pertes de population atténuées par ses technologies, ses effets
/// temporaires étiquetés (Game.recompute_mods les atténue, même pour une technologie trouvée après).
/// Python : `soften(g, code, ev, fx)`.
/// ev : l'identifiant de l'événement. Piège : hors d'ATTENUE, rend fx lui-même (le même objet, souvent un dict de
/// HIST) ; sinon une copie (`dict(fx, ev=ev)`, et `dict(fx['ville'], …)`).
// game/events.py, lignes 408 à 420
pub fn soften(g: &Game, code: &str, ev: &str, fx: &Val) -> Val {
    if !ATTENUE().has(ev) {
        return fx.clone();
    }
    let k = 1.0 + g.mod_(code, ATTENUE().at(ev).s(), 0.0);
    let k = if k > 0.0 { k } else { 0.0 };
    let fx = fx.copy();
    fx.set("ev", ev);
    for p in ["pop", "town_pop"] {
        if fx.get_or(p, 0) < 0i64 {
            fx.scale(p, k);
        }
    }
    if fx.get_or("ville", dict! {}).get_or("pop", 0) < 0i64 {
        let v = fx.at("ville").copy();
        v.set("pop", fx.at("ville").at("pop") * k);
        fx.set("ville", v);
    }
    fx
}

/// Python : `fire(g, code, ev, kind)`.
/// kind : 'hist' ou 'rand'.
// game/events.py, lignes 423 à 455
pub fn fire(g: &mut Game, code: &str, ev: &Val, kind: &str) {
    let mut town = Val::None;
    if kind == "rand" {
        let mine: Vec<Val> = g
            .owned_nodes(code)
            .iter()
            .filter(|n| {
                let t = g.geo.nodes.at(n.at("id")).at("type");
                t == "capitale" || t == "ville"
            })
            .map(|n| n.at("id"))
            .collect();
        town = if !mine.is_empty() { g.rng.choice(&mine) } else { Val::None };
        if town.is_none() {
            return;
        }
    }
    let title = _fill(g, code, ev.at("title").s(), &town);
    let text = _fill(g, code, ev.at("text").s(), &town);
    let gn = g.geo.nodes.at(if town.is_some() { town.clone() } else { g.capital_of(code) });
    let id = ev.ats("id");
    let base = if ev.getb("base") { soften(g, code, &id, &ev.at("base")) } else { Val::None };
    if base.truthy() {
        apply(g, code, &base, &town);
    }
    let cs = ev.get("choices");
    let choices: Vec<Val> = (if cs.truthy() { cs } else { list![] })
        .iter()
        .map(|c| {
            let d = c.copy();
            d.set("fx", soften(g, code, &id, &c.at("fx")));
            d
        })
        .collect();
    let base_txt = if base.truthy() { _join(&describe(g, code, &base, &town)) } else { String::new() };
    let xy = |kw: Val| {
        kw.set("x", gn.at("x"));
        kw.set("y", gn.at("y"));
        kw
    };
    if choices.is_empty() {
        if code == g.player {
            g.log("evenement", &format!("{title} : {text} ({base_txt})."), &xy(dict! {"who" => code, "important" => true}));
        }
        return;
    }
    if code != g.player {
        let mut ok: Vec<usize> = (0..choices.len()).filter(|&i| affordable(g, code, &choices[i].at("fx"))).collect();
        if ok.is_empty() {
            ok = vec![choices.len() - 1];
        }
        let w: Vec<f64> = ok.iter().map(|&j| choices[j].get_or("ai", 1).f()).collect();
        let i = g.rng.choix_pondere(&ok, &w);
        apply(g, code, &choices[i].at("fx"), &town);
        if kind == "hist" && ev.at("who").is_some() {
            let t = format!("{title} : {} choisit « {} ».", g.fname(code), _min1(choices[i].at("label").s()));
            g.log("evenement", &t, &xy(dict! {"who" => code}));
        }
        return;
    }
    let pid = g.nid("e");
    let until = TT::deadline(g, ANSWER_TOURS, &[]);
    let date = g.date_str(&Val::None);
    let cv: Val = choices
        .iter()
        .map(|c| dict! {"label" => c.at("label"), "fx" => c.at("fx"), "desc" => describe(g, code, &c.at("fx"), &town)})
        .collect();
    g.pending_ev.push(dict! {
        "id" => pid, "ev" => &id, "kind" => kind, "title" => &title, "text" => &text, "town" => &town,
        "base" => &base_txt, "until" => until, "date" => date, "choices" => cv
    });
    let suite = if !base_txt.is_empty() { format!(" ({base_txt})") } else { String::new() };
    g.log("evenement", &format!("{title}. {text}{suite} Une décision vous attend."), &xy(dict! {"who" => code, "important" => true}));
    g.alert_pause(true);
}

/// Python : `resolve(g, pid, choice, auto=False)`.
/// pid : l'identifiant de la décision (g.nid('e')) ; auto : False par défaut (expire passe True).
// game/events.py, lignes 458 à 471
pub fn resolve(g: &mut Game, pid: &str, choice: i64, auto: bool) -> (bool, String) {
    let p = g.pending_ev.iter().find(|x| x.at("id") == pid);
    let Some(p) = p else {
        return (false, "Décision introuvable.".to_string());
    };
    if !(0 <= choice && (choice as usize) < p.at("choices").len()) {
        return (false, "Choix inconnu.".to_string());
    }
    let c = p.at("choices").at(choice);
    let player = g.player.clone();
    if !auto && !affordable(g, &player, &c.at("fx")) {
        return (false, "Vous n'en avez pas les moyens.".to_string());
    }
    g.pending_ev.remove(&p);
    apply(g, &player, &c.at("fx"), &p.at("town"));
    let t = format!(
        "{} : {}{} ({}).",
        p.at("title"),
        if auto { "faute de décision, " } else { "" },
        _min1(c.at("label").s()),
        _join(&c.at("desc"))
    );
    g.log("evenement", &t, &dict! {"important" => true});
    (true, format!("{} : {}.", p.at("title"), _min1(c.at("label").s())))
}

/// Python : `expire(g)`.
// game/events.py, lignes 474 à 479
pub fn expire(g: &mut Game) {
    for p in g.pending_ev.copy().iter() {
        if g.t >= p.atf("until") {
            let last = p.at("choices").len() as i64 - 1;
            let player = g.player.clone();
            let ok: Vec<i64> = (0..p.at("choices").len() as i64).filter(|&i| affordable(g, &player, &p.at("choices").at(i).at("fx"))).collect();
            let choice = if ok.contains(&last) || ok.is_empty() { last } else { ok[ok.len() - 1] };
            resolve(g, p.at("id").s(), choice, true);
        }
    }
}
