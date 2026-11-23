//! Villes : emplacements et chaînes de bâtiments, politique de la ville, petits événements locaux.
//!
//! Emplacements : chaque place en a selon sa taille (village et place forte 1, ville 3, chef-lieu 5), plus un par
//! agrandissement. Chacun accueille une chaîne de bâtiments (trois niveaux au plus), bâtie dans la file de la place
//! comme les remparts. Fortifications et agrandissements restent hors emplacements ; le magasin aux vivres en occupe un.
//!
//! Politique : une orientation par place (Équilibre par défaut), avec un bonus et une contrepartie ; un changement
//! prend effet peu à peu, en POLICY_TOURS tour (au début du tour suivant).
//!
//! Événements locaux : incendie, fièvre, disette, brigands, foire, crue, réfugiés, filon, émeute. Ils ne touchent que
//! la ville concernée. Pour le joueur, ils passent par les décisions de events.py (fenêtre de choix, pause) ;
//! les IA choisissent aussitôt.
//!
//! Données d'une place (dans game.nodes) :
//!   slots  {chaîne: niveau}       niveau 0 = premier niveau en chantier ; l'ordre est celui des emplacements
//!   pol    {k, p, t, u, o}        politique, précédente, début et fin du changement, camp qui l'a choisie
//!   tm     [{k, v, until}]        effets passagers d'un événement (production de la ville)
//!   bo     {ressource: par jour}  effets durables d'un événement (un filon)
//!   evt    date du dernier événement local
//!
//! Porte game/cities.py (PORTAGE.md). Une signature ne se change pas sans le signaler. `n` : une place (dict de
//! g.nodes) ; `gn` : son lieu (dict de geo.nodes) ; `chain` : une clé de CHAINS ; `ai` : l'IA de campagne (ai::AI),
//! dont `ai.g` est le `g` passé à côté (`ai.f` : `g.factions[ai.code]`).
#![allow(unused_variables)] // les fonctions de poids (et fx_text, daily) gardent les paramètres du Python

use crate::ai::AI;
use crate::engine::{Date, Game};
use crate::events as EV;
use crate::geo::TERRAIN;
use crate::py::{self, Val};
use crate::rules as R;
use crate::turns as TT;
use crate::{dict, list, py_const, tup};

py_const!(SLOTS, dict!{"village" => 1, "fort" => 1, "ville" => 3, "capitale" => 5});  // +1 par niveau d'agrandissement
py_const!(PROD, tup!["livres", "vivres", "recrues", "industrie", "fer", "bois"]);
pub const POLICY_TOURS: i64 = 1;  // transition d'une politique à l'autre
pub const POLICY_OLD_DAYS: i64 = 18;  // (sauvegardes d'avant les tours : transition en jours)
pub const EV_RATE: f64 = 1.0 / 85.0; // chance quotidienne d'un événement local, pour un camp (un tous les deux à trois mois)
pub const CITY_GAP: i64 = 240;  // une même place n'a pas deux événements à moins de huit mois d'écart
pub const COLLEGE_MAX: f64 = 0.25; // (SPEC-EMPIRE, module 4) recherches au plus +25 % (0,15 avant les universités)
py_const!(SIZE_COST, dict!{"village" => 0.5, "fort" => 0.6, "ville" => 1.0, "capitale" => 1.8});  // coûts et gains des événements selon la taille
py_const!(TOWN_W, dict!{"capitale" => 3.0, "ville" => 3.0, "fort" => 1.0, "village" => 0.6});  // places touchées : surtout les villes
/// `TECH_NAME = lambda t: R.TECH[t]['name']`.
pub fn TECH_NAME(t: &str) -> String {
    R::TECH().at(t).ats("name")
}

// ------------------------------------------------------------------ chaînes de bâtiments
// fx (totaux du niveau, pas cumulés) :
//   livres vivres recrues industrie fer bois   production de base de la place, par jour (avant population et ordre)
//   spec      part de la spécialité en plus      trade   livres de commerce fluvial (sensibles au blocus)
//   stab      ordre public visé                  grow    croissance de la population
//   train     délai de formation des régiments levés ici (cav_train : cavalerie en plus)
//   xp        expérience des régiments levés ici milice  milice de la place
//   research  jours de recherche gagnés chaque jour (collèges, plafonnés)
//   ev        {événement: part}  chances des événements locaux
// (le magasin aux vivres reprend la description, le prix et la durée de R::BUILD()["depot"])
py_const!(CHAINS, dict!{
    "marche" => dict!{
        "name" => "Commerce",
        "icon" => "livres",
        "desc" => "Marchés et halles : des livres, des foires plus fréquentes.",
        "levels" => list![
            dict!{
                "name" => "Marché",
                "cost" => dict!{"livres" => 120, "bois" => 40},
                "bat" => "marche",
                "days" => 14,
                "fx" => dict!{"livres" => 0.1},
            },
            dict!{
                "name" => "Halle couverte",
                "cost" => dict!{"livres" => 260, "bois" => 80, "outils" => 15},
                "bat" => "marche",
                "days" => 22,
                "dev" => 1,
                "up" => 0.05,
                "fx" => dict!{"livres" => 0.2, "ev" => dict!{"foire" => 0.5}},
            },
            dict!{
                "name" => "Bourse de commerce",
                "cost" => dict!{"livres" => 520, "bois" => 100, "fer" => 40, "outils" => 30},
                "bat" => "banque",
                "days" => 32,
                "dev" => 2,
                "tech" => "escompte",
                "up" => 0.15,
                "fx" => dict!{"livres" => 0.35, "ev" => dict!{"foire" => 1.0}},
            },
        ],
    },
    "moulins" => dict!{
        "name" => "Grains",
        "icon" => "vivres",
        "desc" => "Moulins et greniers : des vivres, moins de disettes.",
        "levels" => list![
            dict!{
                "name" => "Moulins",
                "cost" => dict!{"livres" => 100, "bois" => 50},
                "bat" => "moulin",
                "days" => 12,
                "fx" => dict!{"vivres" => 0.2},
            },
            dict!{
                "name" => "Minoterie",
                "cost" => dict!{"livres" => 220, "bois" => 80, "fer" => 20, "outils" => 15},
                "bat" => "moulin",
                "days" => 20,
                "dev" => 1,
                "up" => 0.05,
                "fx" => dict!{"vivres" => 0.4, "ev" => dict!{"disette" => -0.3}},
            },
            dict!{
                "name" => "Greniers d’abondance",
                "cost" => dict!{"livres" => 400, "bois" => 120, "fer" => 40},
                "bat" => "grenier",
                "days" => 30,
                "tech" => "greniers",
                "up" => 0.1,
                "fx" => dict!{"vivres" => 0.6, "ev" => dict!{"disette" => -0.6}},
            },
        ],
    },
    "specialite" => dict!{
        "name" => "Spécialité",
        "icon" => "star",
        "where" => "star",
        "desc" => "Ateliers de la spécialité de la ville : elle rapporte davantage.",
        "levels" => list![
            dict!{
                "name" => "Atelier",
                "cost" => dict!{"livres" => 140, "bois" => 50},
                "bat" => "manufacture",
                "days" => 15,
                "fx" => dict!{"spec" => 0.2},
            },
            dict!{
                "name" => "Maison",
                "cost" => dict!{"livres" => 300, "bois" => 80, "outils" => 20},
                "bat" => "manufacture",
                "days" => 24,
                "dev" => 1,
                "up" => 0.05,
                "fx" => dict!{"spec" => 0.4},
            },
            dict!{
                "name" => "Grande maison",
                "cost" => dict!{"livres" => 560, "bois" => 110, "fer" => 30, "outils" => 30},
                "bat" => "manufacture",
                "days" => 34,
                "dev" => 2,
                "tech" => "*",
                "up" => 0.15,
                "fx" => dict!{"spec" => 0.6},
            },
        ],
    },
    "atelier" => dict!{
        "name" => "Industrie",
        "icon" => "outils",
        "desc" => "Ateliers et fabriques : capacité industrielle (armes et outils).",
        "levels" => list![
            dict!{
                "name" => "Atelier",
                "cost" => dict!{"livres" => 130, "bois" => 50, "fer" => 20},
                "bat" => "forge",
                "days" => 15,
                "fx" => dict!{"industrie" => 0.1},
            },
            dict!{
                "name" => "Manufacture",
                "cost" => dict!{"livres" => 300, "bois" => 80, "fer" => 40, "outils" => 20},
                "bat" => "manufacture",
                "days" => 25,
                "dev" => 1,
                "tech" => "manufactures",
                "up" => 0.05,
                "fx" => dict!{"industrie" => 0.25},
            },
            dict!{
                "name" => "Fabrique",
                "cost" => dict!{"livres" => 600, "bois" => 100, "fer" => 80, "outils" => 40},
                "bat" => "usine",
                "days" => 36,
                "dev" => 2,
                "tech" => "vapeur",
                "up" => 0.15,
                "fx" => dict!{"industrie" => 0.45, "stab" => -0.02},
            },
        ],
    },
    "caserne" => dict!{
        "name" => "Garnison",
        "icon" => "recrues",
        "desc" => "Casernes : recrues, milice, régiments formés plus vite.",
        "levels" => list![
            dict!{
                "name" => "Caserne",
                "cost" => dict!{"livres" => 140, "bois" => 60},
                "bat" => "caserne",
                "days" => 16,
                "up" => 0.1,
                "fx" => dict!{"recrues" => 0.1, "train" => 0.15, "milice" => 40},
            },
            dict!{
                "name" => "Quartier de cavalerie",
                "cost" => dict!{"livres" => 280, "bois" => 90, "fer" => 30},
                "bat" => "caserne",
                "days" => 24,
                "dev" => 1,
                "tech" => "haras",
                "up" => 0.2,
                "fx" => dict!{"recrues" => 0.2, "train" => 0.2, "cav_train" => 0.3, "milice" => 60},
            },
            dict!{
                "name" => "École militaire",
                "cost" => dict!{"livres" => 550, "bois" => 120, "fer" => 60},
                "bat" => "caserne",
                "days" => 35,
                "dev" => 2,
                "tech" => "divisions",
                "up" => 0.35,
                "fx" => dict!{"recrues" => 0.3, "train" => 0.25, "cav_train" => 0.3, "xp" => 15, "milice" => 80},
            },
        ],
    },
    "hospice" => dict!{
        "name" => "Charité",
        "icon" => "scale",
        "desc" => "Hospices et collèges : ordre public, croissance, moins de fièvres.",
        "levels" => list![
            dict!{
                "name" => "Hospice",
                "cost" => dict!{"livres" => 120, "bois" => 40},
                "bat" => "hopital",
                "days" => 14,
                "up" => 0.05,
                "fx" => dict!{"stab" => 0.03, "grow" => 0.1, "ev" => dict!{"epidemie" => -0.25}},
            },
            dict!{
                "name" => "Hôtel-Dieu",
                "cost" => dict!{"livres" => 260, "bois" => 70, "outils" => 20},
                "bat" => "hopital",
                "days" => 22,
                "dev" => 1,
                "up" => 0.15,
                "fx" => dict!{"stab" => 0.05, "grow" => 0.2, "ev" => dict!{"epidemie" => -0.5}},
            },
            dict!{
                "name" => "Collège",
                "cost" => dict!{"livres" => 480, "bois" => 90, "outils" => 30},
                "bat" => "ecole",
                "days" => 30,
                "dev" => 2,
                "up" => 0.25,
                "fx" => dict!{
                    "stab" => 0.07,
                    "grow" => 0.25,
                    "research" => 0.03,
                    "ev" => dict!{"epidemie" => -0.6, "emeute" => -0.3},
                },
            },
        ],
    },
    "quai" => dict!{
        "name" => "Port fluvial",
        "icon" => "anchor",
        "where" => "quai",
        "desc" => "Cales et chantiers : commerce par eau, bois, industrie.",
        "levels" => list![
            dict!{
                "name" => "Cale et entrepôts",
                "cost" => dict!{"livres" => 120, "bois" => 60},
                "bat" => "entrepot",
                "days" => 14,
                "fx" => dict!{"trade" => 0.1},
            },
            dict!{
                "name" => "Chantier de gabares",
                "cost" => dict!{"livres" => 260, "bois" => 100, "fer" => 20},
                "bat" => "port",
                "days" => 22,
                "dev" => 1,
                "tech" => "gabares",
                "up" => 0.05,
                "fx" => dict!{"trade" => 0.2, "bois" => 0.1},
            },
            dict!{
                "name" => "Arsenal",
                "cost" => dict!{"livres" => 520, "bois" => 140, "fer" => 60},
                "bat" => "arsenal",
                "days" => 34,
                "dev" => 2,
                "tech" => "armureries",
                "up" => 0.15,
                "fx" => dict!{"trade" => 0.35, "bois" => 0.15, "industrie" => 0.15},
            },
        ],
    },
    "depot" => dict!{
        "name" => "Magasin aux vivres",
        "icon" => "depot",
        "desc" => format!("{}.", R::BUILD().at("depot").at("desc")),
        "levels" => list![
            dict!{"name" => "Magasin aux vivres", "cost" => R::BUILD_cost("depot", 0), "bat" => "grenier", "days" => R::BUILD_days("depot", 0), "fx" => dict!{"depot" => 1}},
        ],
    },
    // (SPEC-EMPIRE, module 4) chaînes d'Empire : les trois premières ouvrent le recrutement (R::UNIT_REQ)
    "haras" => dict!{
        "name" => "Haras",
        "icon" => "recrues",
        "desc" => "Haras et remontes : il en faut un pour lever de la cavalerie ; cavaliers formés plus vite.",
        "levels" => list![
            dict!{"name" => "Haras", "cost" => dict!{"livres" => 140, "bois" => 50}, "bat" => "haras", "days" => 16, "up" => 0.1,
                  "fx" => dict!{"cav_train" => 0.15}},
            dict!{"name" => "Haras royal", "cost" => dict!{"livres" => 300, "bois" => 80, "fer" => 20}, "bat" => "haras", "days" => 24, "dev" => 1,
                  "up" => 0.2, "fx" => dict!{"recrues" => 0.05, "cav_train" => 0.25}},
            dict!{"name" => "École de cavalerie", "cost" => dict!{"livres" => 560, "bois" => 100, "fer" => 40}, "bat" => "haras", "days" => 34,
                  "dev" => 2, "tech" => "hussards", "up" => 0.3, "fx" => dict!{"recrues" => 0.1, "cav_train" => 0.35}},
        ],
    },
    "fonderie" => dict!{
        "name" => "Fonderie",
        "icon" => "outils",
        "desc" => "Fonderies et arsenaux : il en faut une pour lever de l'artillerie (un arsenal pour les mitrailleuses).",
        "levels" => list![
            dict!{"name" => "Fonderie", "cost" => dict!{"livres" => 150, "bois" => 40, "fer" => 30}, "bat" => "fonderie", "days" => 18, "up" => 0.1,
                  "fx" => dict!{"industrie" => 0.05, "art_train" => 0.15}},
            dict!{"name" => "Fonderie de canons", "cost" => dict!{"livres" => 320, "bois" => 60, "fer" => 60, "outils" => 15}, "bat" => "armurerie",
                  "days" => 26, "dev" => 1, "up" => 0.2, "fx" => dict!{"industrie" => 0.1, "art_train" => 0.25}},
            dict!{"name" => "Arsenal", "cost" => dict!{"livres" => 620, "bois" => 100, "fer" => 100, "outils" => 30}, "bat" => "arsenal", "days" => 38,
                  "dev" => 2, "tech" => "gribeauval", "up" => 0.35, "fx" => dict!{"industrie" => 0.2, "art_train" => 0.35}},
        ],
    },
    "ecole_militaire" => dict!{
        "name" => "École militaire",
        "icon" => "recrues",
        "desc" => "Salles d'armes et écoles : il en faut une pour lever infanterie légère, chasseurs, grenadiers et sapeurs.",
        "levels" => list![
            dict!{"name" => "Salle d’armes", "cost" => dict!{"livres" => 150, "bois" => 50}, "bat" => "ecole_militaire", "days" => 18, "up" => 0.1,
                  "fx" => dict!{"train" => 0.05, "xp" => 5}},
            dict!{"name" => "École royale militaire", "cost" => dict!{"livres" => 340, "bois" => 80, "fer" => 20}, "bat" => "ecole_militaire",
                  "days" => 28, "dev" => 1, "up" => 0.25, "fx" => dict!{"train" => 0.1, "xp" => 10}},
            dict!{"name" => "École polytechnique", "cost" => dict!{"livres" => 650, "bois" => 110, "fer" => 40, "outils" => 30},
                  "bat" => "ecole_militaire", "days" => 40, "dev" => 2, "tech" => "levee", "up" => 0.4, "fx" => dict!{"train" => 0.15, "xp" => 20}},
        ],
    },
    "universite" => dict!{
        "name" => "Savoir",
        "icon" => "scale",
        "desc" => "Collèges et académies : recherches plus rapides, un peu d'ordre public.",
        "levels" => list![
            dict!{"name" => "Collège", "cost" => dict!{"livres" => 150, "bois" => 40}, "bat" => "ecole", "days" => 18, "up" => 0.1,
                  "fx" => dict!{"research" => 0.05, "stab" => 0.01}},
            dict!{"name" => "Université", "cost" => dict!{"livres" => 330, "bois" => 70, "outils" => 15}, "bat" => "universite", "days" => 28,
                  "dev" => 1, "up" => 0.2, "fx" => dict!{"research" => 0.1, "stab" => 0.02}},
            dict!{"name" => "Académie des sciences", "cost" => dict!{"livres" => 620, "bois" => 90, "outils" => 30}, "bat" => "academie",
                  "days" => 40, "dev" => 2, "up" => 0.35, "fx" => dict!{"research" => 0.18, "stab" => 0.03}},
        ],
    },
    "eglise" => dict!{
        "name" => "Église",
        "icon" => "scale",
        "desc" => "Paroisses et cathédrales : ordre public, natalité, moins d'émeutes.",
        "levels" => list![
            dict!{"name" => "Paroisse", "cost" => dict!{"livres" => 110, "bois" => 40}, "bat" => "eglise", "days" => 14, "up" => 0.05,
                  "fx" => dict!{"stab" => 0.02, "grow" => 0.05}},
            dict!{"name" => "Séminaire", "cost" => dict!{"livres" => 250, "bois" => 70}, "bat" => "seminaire", "days" => 22, "dev" => 1, "up" => 0.1,
                  "fx" => dict!{"stab" => 0.04, "grow" => 0.1, "ev" => dict!{"emeute" => -0.3}}},
            dict!{"name" => "Cathédrale", "cost" => dict!{"livres" => 600, "bois" => 120, "fer" => 20}, "bat" => "cathedrale", "days" => 45,
                  "dev" => 2, "up" => 0.2, "fx" => dict!{"stab" => 0.07, "grow" => 0.15, "ev" => dict!{"emeute" => -0.6}}},
        ],
    },
    "port" => dict!{
        "name" => "Port de mer",
        "icon" => "anchor",
        "where" => "mer",
        "desc" => "Port de commerce, chantier naval, arsenal de marine : commerce par mer ; le chantier bâtit les navires.",
        "levels" => list![
            dict!{"name" => "Port de commerce", "cost" => dict!{"livres" => 160, "bois" => 70}, "bat" => "port", "days" => 18, "up" => 0.05,
                  "fx" => dict!{"trade" => 0.15}},
            dict!{"name" => "Chantier naval", "cost" => dict!{"livres" => 340, "bois" => 140, "fer" => 30}, "bat" => "chantier_naval", "days" => 30,
                  "dev" => 1, "up" => 0.15, "fx" => dict!{"trade" => 0.25}},
            dict!{"name" => "Arsenal de marine", "cost" => dict!{"livres" => 650, "bois" => 200, "fer" => 80, "outils" => 30}, "bat" => "cale_seche",
                  "days" => 45, "dev" => 2, "up" => 0.3, "fx" => dict!{"trade" => 0.35, "industrie" => 0.1}},
        ],
    },
    "douane" => dict!{
        "name" => "Douane",
        "icon" => "livres",
        "where" => "quai",
        "desc" => "Bureau des douanes, entrepôt, compagnie de commerce : droits sur ce qui passe au quai.",
        "levels" => list![
            dict!{"name" => "Bureau des douanes", "cost" => dict!{"livres" => 130, "bois" => 30}, "bat" => "douane", "days" => 14, "up" => 0.05,
                  "fx" => dict!{"livres" => 0.12}},
            dict!{"name" => "Entrepôt", "cost" => dict!{"livres" => 280, "bois" => 80}, "bat" => "entrepot", "days" => 22, "dev" => 1, "up" => 0.1,
                  "fx" => dict!{"livres" => 0.2, "trade" => 0.05}},
            dict!{"name" => "Compagnie de commerce", "cost" => dict!{"livres" => 560, "bois" => 100, "outils" => 20}, "bat" => "comptoir", "days" => 34,
                  "dev" => 2, "tech" => "escompte", "up" => 0.2, "fx" => dict!{"livres" => 0.3, "trade" => 0.1}},
        ],
    },
    "phare" => dict!{
        "name" => "Phare",
        "icon" => "anchor",
        "where" => "mer",
        "desc" => "Un phare sur la côte : moins de naufrages, navires plus sûrs à l'entrée du port.",
        "levels" => list![
            dict!{"name" => "Phare", "cost" => dict!{"livres" => 180, "bois" => 40, "fer" => 20}, "bat" => "phare", "days" => 20, "up" => 0.05,
                  "fx" => dict!{"trade" => 0.05, "phare" => 1}},
        ],
    },
    "plantation" => dict!{
        "name" => "Plantation",
        "icon" => "vivres",
        "where" => "colonie",
        "desc" => "Plantations des colonies : des livres, et la denrée coloniale de la place.",
        "levels" => list![
            // bat : plantation_<denrée> (bat_de) ; denree : quantité produite, lue par le commerce (module 7)
            dict!{"name" => "Plantation", "cost" => dict!{"livres" => 120, "bois" => 40}, "bat" => "plantation", "days" => 16, "up" => 0.05,
                  "fx" => dict!{"livres" => 0.1, "denree" => 1}},
            dict!{"name" => "Grande plantation", "cost" => dict!{"livres" => 260, "bois" => 70}, "bat" => "plantation", "days" => 24, "dev" => 1,
                  "up" => 0.1, "fx" => dict!{"livres" => 0.2, "denree" => 2}},
            dict!{"name" => "Sucrerie", "cost" => dict!{"livres" => 520, "bois" => 100, "fer" => 40, "outils" => 20}, "bat" => "plantation", "days" => 34,
                  "dev" => 2, "tech" => "vapeur", "up" => 0.15, "fx" => dict!{"livres" => 0.3, "denree" => 3}},
        ],
    },
});
py_const!(CHAIN_ORDER, list!["marche", "moulins", "specialite", "atelier", "caserne", "hospice", "quai", "depot",
                             "haras", "fonderie", "ecole_militaire", "universite", "eglise", "port", "douane", "phare", "plantation"]);
py_const!(SIZE_K, dict!{"village" => 0.5, "fort" => 0.5, "ville" => 1.0, "capitale" => 1.5});  // production des bâtiments selon la taille de la place

// noms des ateliers de spécialité (trois niveaux) et technologie du dernier niveau
py_const!(SPEC_NAMES, dict!{
    "grand_vin" => tup![list!["Chai", "Maison de négoce", "Grand chai d’exportation"], "chais"],
    "vin" => tup![list!["Chai", "Maison de négoce", "Comptoir des vins"], "chais"],
    "eau_de_vie" => tup![list!["Alambics", "Distillerie", "Négoce d’eau-de-vie"], "chais"],
    "negoce" => tup![list!["Comptoir", "Armement maritime", "Compagnie de commerce"], "gabares"],
    "peche" => tup![list!["Pêcherie", "Saurisserie", "Armement de pêche"], "gabares"],
    "sel" => tup![list!["Salines", "Saunerie", "Raffinerie de sel"], "manufactures"],
    "prune" => tup![list!["Séchoirs", "Conserverie", "Négoce des pruneaux"], "foires"],
    "terroir" => tup![list!["Saloirs et fermes", "Conserverie", "Foirail"], "foires"],
    "salaisons" => tup![list!["Saloirs", "Salaisonnerie", "Maison de salaisons"], "foires"],
    "betail" => tup![list!["Étables", "Foirail", "Halle aux bestiaux"], "foires"],
    "ble" => tup![list!["Granges", "Halle aux grains", "Négoce des grains"], "assolement"],
    "resine" => tup![list!["Résinerie", "Distillerie de térébenthine", "Usine de produits résineux"], "gemmage"],
    "textile" => tup![list!["Métiers", "Draperie", "Filature"], "draperies"],
    "tabac" => tup![list!["Séchoirs à tabac", "Manufacture des tabacs", "Grande manufacture"], "draperies"],
    "forge" => tup![list!["Forge", "Haut fourneau", "Fonderie"], "hauts_fourneaux"],
});

// ------------------------------------------------------------------ politiques
py_const!(POLICIES, dict!{
    "equilibre" => dict!{"label" => "Équilibre", "fx" => dict!{}, "pro" => "Aucun effet particulier", "con" => ""},
    "commerce" => dict!{
        "label" => "Commerce",
        "fx" => dict!{"livres" => 0.1, "vivres" => -0.1, "recrues" => -0.15, "ev" => dict!{"foire" => 0.3}},
        "pro" => "livres +10 %, foires plus fréquentes",
        "con" => "vivres −10 %, recrues −15 %",
    },
    "grenier" => dict!{
        "label" => "Grenier",
        "fx" => dict!{"vivres" => 0.15, "livres" => -0.08, "ev" => dict!{"disette" => -0.5}},
        "pro" => "vivres +15 %, disettes deux fois plus rares",
        "con" => "livres −8 %",
    },
    "recrutement" => dict!{
        "label" => "Recrutement",
        "fx" => dict!{"recrues" => 0.25, "grow" => -0.25, "stab" => -0.03},
        "pro" => "recrues +25 %",
        "con" => "croissance −25 %, ordre public −3 %",
    },
    "armes" => dict!{
        "label" => "Place d’armes",
        "fx" => dict!{"train" => 0.2, "xp" => 5, "stab" => 0.03, "livres" => -0.1, "ev" => dict!{"brigands" => -0.5}},
        "pro" => "régiments formés 20 % plus vite et plus aguerris, ordre public +3 %, moins de brigands",
        "con" => "livres −10 %",
    },
    "fetes" => dict!{
        "label" => "Fêtes et culte",
        "fx" => dict!{"stab" => 0.07, "grow" => 0.15, "livres" => -0.15, "ev" => dict!{"emeute" => -0.5}},
        "pro" => "ordre public +7 %, croissance +15 %, moins d’émeutes",
        "con" => "livres −15 %",
    },
});
py_const!(POLICY_ORDER, list!["equilibre", "commerce", "grenier", "recrutement", "armes", "fetes"]);

py_const!(FX_LABEL, dict!{
    "livres" => "livre",
    "vivres" => "vivres",
    "recrues" => "recrues",
    "industrie" => "industrie",
    "fer" => "fer",
    "bois" => "bois",
});
py_const!(TM_LABEL, dict!{
    "prod" => "production",
    "livres" => "livres",
    "vivres" => "vivres",
    "recrues" => "recrues",
    "industrie" => "industrie",
});

/// Python : `_n(x)`.
/// `f"{x:.2f}"`, sans zéros ni point final, virgule décimale.
// game/cities.py, lignes 133 à 134
pub fn _n(x: f64) -> String {
    format!("{x:.2}").trim_end_matches('0').trim_end_matches('.').replace('.', ",")
}

/// Effets d'un niveau, en clair : production par tour (TOUR_DAYS jours), ou par jour (temps réel).
/// Python : `fx_text(fx, star=None, per_day=False)`.
/// star : None par défaut (ne sert pas) ; per_day : False par défaut.
/// Piège : `+{fx['xp']}`, `+{fx['milice']}` gardent le type du Python (des entiers).
// game/cities.py, lignes 137 à 166
pub fn fx_text(fx: &Val, star: &Val, per_day: bool) -> String {
    let out: Vec<String> = {
        let mut out = vec![];
        let (k_, u) = if per_day { (1.0, "/j") } else { (TT::TOUR_DAYS, "/tour") };
        for k in PROD().iter() {
            if fx.getb(&k) {
                let x = fx.atf(&k) * k_;
                let lab = if k != "livres" || x < 2.0 { FX_LABEL().ats(&k) } else { "livres".to_string() };
                out.push(format!("+{} {lab} {u}", _n(x)));
            }
        }
        if fx.getb("trade") {
            let x = fx.atf("trade") * k_;
            out.push(format!("+{} livre{} {u} de commerce par eau", _n(x), if x >= 2.0 { "s" } else { "" }));
        }
        if fx.getb("spec") {
            out.push(format!("spécialité +{} %", py::round(fx.atf("spec") * 100.0)));
        }
        if fx.getb("stab") {
            let s = fx.atf("stab");
            out.push(format!("ordre public {}{} %", if s > 0.0 { "+" } else { "−" }, py::round(s.abs() * 100.0)));
        }
        if fx.getb("grow") {
            out.push(format!("croissance +{} %", py::round(fx.atf("grow") * 100.0)));
        }
        if fx.getb("train") {
            let cav = if fx.getb("cav_train") {
                format!(" (cavalerie {} %)", py::round((fx.atf("train") + fx.get_or("cav_train", 0).f()) * 100.0))
            } else {
                String::new()
            };
            out.push(format!("régiments formés {} % plus vite{cav}", py::round(fx.atf("train") * 100.0)));
        }
        // (SPEC-EMPIRE, module 4) haras et fonderies
        if fx.getb("cav_train") && !fx.getb("train") {
            out.push(format!("cavaliers formés {} % plus vite", py::round(fx.atf("cav_train") * 100.0)));
        }
        if fx.getb("art_train") {
            out.push(format!("artilleurs formés {} % plus vite", py::round(fx.atf("art_train") * 100.0)));
        }
        if fx.getb("xp") {
            out.push(format!("régiments levés ici aguerris (+{} d’expérience)", fx.at("xp")));
        }
        if fx.getb("milice") {
            out.push(format!("milice +{}", fx.at("milice")));
        }
        if fx.getb("research") {
            out.push(format!("recherches +{} %", py::round(fx.atf("research") * 100.0)));
        }
        let ev = fx.get("ev");
        for (k, v) in (if ev.truthy() { ev } else { dict! {} }).items() {
            let lab = if LOCAL_BY_ID().has(&k) { LOCAL_BY_ID().at(&k).at("short") } else { k };
            out.push(format!("{lab} {}", if v > 0i64 { "plus fréquentes" } else { "plus rares" }));
        }
        if fx.getb("depot") {
            out.push("ravitaille les armées à moins de 30 km".to_string());
        }
        if fx.getb("phare") {
            out.push("moins de naufrages".to_string());
        }
        if fx.getb("denree") {
            out.push(format!("denrée coloniale ×{}", fx.at("denree")));
        }
        out
    };
    out.join(", ")
}

// ------------------------------------------------------------------ emplacements

/// Python : `slots(n)`.
/// Rend n['slots'] (créé s'il manque : le même dict).
// game/cities.py, lignes 170 à 174
pub fn slots(n: &Val) -> Val {
    let s = n.get("slots");
    if s.is_none() {
        let s = if n.getb("depot") { dict! {"depot" => 1} } else { dict! {} };
        n.set("slots", &s);
        return s;
    }
    s
}

/// Python : `slot_count(g, n)`.
// game/cities.py, lignes 177 à 178
pub fn slot_count(g: &Game, n: &Val) -> i64 {
    SLOTS().ati(g.geo.nodes.at(n.at("id")).at("type")) + n.get_or("dev", 0).i()
}

/// Nom d'un niveau (1 à 3) ; les ateliers de spécialité changent de nom selon la ville.
/// Python : `level_name(g, nid, chain, lvl)`.
// game/cities.py, lignes 181 à 187
pub fn level_name(g: &Game, nid: i64, chain: &str, lvl: i64) -> String {
    if chain == "specialite" {
        let st = g.geo.nodes.at(nid).get("star");
        let star = if st.truthy() { st.at(0) } else { Val::None };
        if SPEC_NAMES().has(&star) {
            return SPEC_NAMES().at(&star).at(0).ats(lvl - 1);
        }
    }
    CHAINS().at(chain).at("levels").at(lvl - 1).ats("name")
}

/// Python : `level_tech(g, nid, chain, lvl)`.
// game/cities.py, lignes 190 à 195
pub fn level_tech(g: &Game, nid: i64, chain: &str, lvl: i64) -> Option<String> {
    let mut t = CHAINS().at(chain).at("levels").at(lvl - 1).get("tech");
    if t == "*" {
        let st = g.geo.nodes.at(nid).get("star");
        let star = if st.truthy() { st.at(0) } else { Val::None };
        t = SPEC_NAMES().get_or(&star, tup![Val::None, Val::None]).at(1);
    }
    if t.is_none() { None } else { Some(t.string()) }
}

/// La chaîne a-t-elle sa place ici ? (spécialité, quai)
/// Python : `fits(g, nid, chain)`.
// game/cities.py, lignes 198 à 206
pub fn fits(g: &Game, nid: i64, chain: &str) -> bool {
    let gn = g.geo.nodes.at(nid);
    let w = CHAINS().at(chain).get("where");
    if w == "star" {
        return gn.getb("star") && R::SPECIALTY().has(gn.at("star").at(0));
    }
    if w == "quai" {
        return g.geo.ports.has(nid) && gn.at("type") != "fort";
    }
    if w == "mer" {
        return port_de_mer(g, nid) && gn.at("type") != "fort";
    }
    if w == "colonie" {
        return est_colonie(g, nid);
    }
    true
}

/// (SPEC-EMPIRE, module 4) Port sur la mer : un de ses quais donne sur une voie d'eau marine (pas un quai de fleuve).
pub fn port_de_mer(g: &Game, nid: i64) -> bool {
    // un mouillage en mer (celui des flottes) suffit : la plupart des ports de mer des théâtres (Brest, Alger…) n'ont pas
    // de quai sur une voie d'eau marine
    crate::engine::marine::case_port(&g.geo, nid).is_some() || g.geo.ports.get_or(nid, list![]).iter().any(|w| g.geo.ways.at(w).atb("sea"))
}

/// (SPEC-EMPIRE, module 4) Place hors d'Europe (plantations) : son champ `theatre` quand la géographie le donne (la
/// carte « monde »), sinon le théâtre de la carte (ni l'Europe ni l'Aquitaine).
pub fn est_colonie(g: &Game, nid: i64) -> bool {
    let t = g.geo.nodes.at(nid).get("theatre");
    if t.truthy() {
        return t != "europe";
    }
    g.geo.theatre.is_some_and(|t| t.id != "europe")
}

/// (SPEC-EMPIRE, module 4) Le chantier naval de la place a-t-il ce niveau (chaîne `port` achevée) ? Pour la marine.
pub fn chantier_ok(g: &Game, nid: i64, lvl: i64) -> bool {
    niveau(&g.nodes.at(nid), "port") >= lvl
}

/// Niveau achevé d'une chaîne dans la place (0 : absente ou en chantier), sans créer `slots` (lu à chaque levée).
pub fn niveau(n: &Val, chain: &str) -> i64 {
    let s = n.get("slots");
    if s.is_none() { 0 } else { s.get_or(chain, 0).i() }
}

/// (SPEC-EMPIRE, module 4) Raison du refus quand le type d'unité exige un bâtiment que la place n'a pas (R::UNIT_REQ).
/// Un chantier en cours (niveau 0) ne compte pas.
pub fn unit_req_why(g: &Game, nid: i64, typ: &str) -> Option<String> {
    let r = R::UNIT_REQ().get(typ);
    if r.is_none() {
        return None;
    }
    let (chain, lvl) = r.pair();
    if niveau(&g.nodes.at(nid), chain.s()) >= lvl.i() {
        return None;
    }
    Some(format!("Bâtiment requis dans la ville : {}.", level_name(g, nid, chain.s(), lvl.i()).to_lowercase()))
}

/// (SPEC-EMPIRE, module 4) Clé web_engine du bâtiment de ce niveau (les plantations selon la denrée de la place).
pub fn bat_de(g: &Game, nid: i64, chain: &str, lvl: i64) -> String {
    let b = CHAINS().at(chain).at("levels").at(lvl.max(1) - 1).ats("bat");
    if chain == "plantation" {
        // (SPEC-EMPIRE, module 7) la denrée de la place d'après sa géographie ; sucre hors des théâtres coloniaux
        return format!("{b}_{}", crate::engine::commerce::denree_place(&g.geo, nid).unwrap_or("sucre"));
    }
    b
}

/// (niveau visé, raison du refus ou None) pour bâtir ou améliorer cette chaîne ici.
/// Python : `check(g, code, n, chain)`.
// game/cities.py, lignes 209 à 234
pub fn check(g: &Game, code: &str, n: &Val, chain: &str) -> (Option<i64>, Option<String>) {
    let nid = n.ati("id");
    if !CHAINS().has(chain) {
        return (None, Some("Bâtiment inconnu.".to_string()));
    }
    if !fits(g, nid, chain) {
        return (
            None,
            Some(match CHAINS().at(chain).get("where").s() {
                "star" => "Il faut une spécialité dans la ville.".to_string(),
                "mer" => "Il faut un port de mer.".to_string(),
                "colonie" => "Seulement dans les colonies.".to_string(),
                _ => "Il faut un quai sur un fleuve navigable.".to_string(),
            }),
        );
    }
    let s = slots(n);
    let cur = s.get(chain);
    // (un magasin aux vivres commandé avant les emplacements est encore une file « build »)
    if cur == 0i64 || n.at("queue").iter().any(|q| (q.at("kind") == "slot" || q.at("kind") == "build") && q.at("what") == chain) {
        return (None, Some("Déjà en chantier.".to_string()));
    }
    let lvl = if cur.is_none() { 1 } else { cur.i() + 1 };
    let levels = CHAINS().at(chain).at("levels");
    if lvl > levels.len() as i64 {
        return (None, Some("Niveau maximal atteint.".to_string()));
    }
    if cur.is_none() && s.len() as i64 >= slot_count(g, n) {
        return (None, Some("Plus d'emplacement libre : agrandissez la ville ou démolissez un bâtiment.".to_string()));
    }
    let L = levels.at(lvl - 1);
    if n.get_or("dev", 0) < L.get_or("dev", 0) {
        return (None, Some(format!("Il faut d'abord agrandir la ville (niveau {}).", L.at("dev"))));
    }
    let t = level_tech(g, nid, chain, lvl);
    if let Some(t) = t {
        if !t.is_empty() && !g.factions.at(code).at("techs").has(t.as_str()) {
            return (None, Some(format!("Technologie requise : {}.", TECH_NAME(&t))));
        }
    }
    (Some(lvl), None)
}

/// Python : `slot_build(g, code, nid, chain)`.
// game/cities.py, lignes 237 à 259
pub fn slot_build(g: &mut Game, code: &str, nid: i64, chain: &str) -> (bool, String) {
    let n = g.nodes.at(nid);
    let gn = g.geo.nodes.at(nid);
    if n.at("owner") != code {
        return (false, "Cette ville ne vous appartient pas.".to_string());
    }
    sync(g, &n);
    let (lvl, why) = check(g, code, &n, chain);
    if let Some(why) = why {
        return (false, why);
    }
    let lvl = lvl.unwrap();
    if n.atb("siege") {
        return (false, "La place est assiégée.".to_string());
    }
    if n.at("queue").len() >= 4 {
        return (false, "File de production pleine.".to_string());
    }
    let L = CHAINS().at(chain).at("levels").at(lvl - 1);
    let (cost, days) = (g.build_cost(code, &L.at("cost")), g.build_days(code, L.atf("days")));
    if !g.can_pay(code, &cost) {
        return (false, "Ressources insuffisantes.".to_string());
    }
    g.pay(code, &cost);
    n.at("queue").push(dict! {"kind" => "slot", "what" => chain, "lvl" => lvl, "left" => days, "total" => days});
    if lvl == 1 {
        slots(&n).set(chain, 0); // l'emplacement est pris dès le début du chantier
    }
    let name = level_name(g, nid, chain, lvl);
    if lvl == 1 {
        (true, format!("{name} : chantier lancé à {}.", gn.at("name")))
    } else {
        (true, format!("{name} : amélioration lancée à {}.", gn.at("name")))
    }
}

/// Fin d'un chantier d'emplacement (appelé par la file de la place).
/// Python : `finish(g, n, q)`.
/// q : l'élément de la file (dict(kind='slot', what, lvl, …)).
// game/cities.py, lignes 262 à 274
pub fn finish(g: &mut Game, n: &Val, q: &Val) {
    let (chain, lvl) = (q.ats("what"), q.ati("lvl"));
    let s = slots(n);
    let old = s.get(chain.as_str()).or(0).i();
    s.set(chain.as_str(), lvl);
    _milice(n, &chain, old, lvl);
    if chain == "depot" {
        n.set("depot", 1);
    }
    g._dirty_income = true;
    if n.at("owner") == g.player {
        let gn = g.geo.nodes.at(n.at("id"));
        let t = format!("Fin des travaux à {} : {}.", gn.at("name"), level_name(g, n.ati("id"), &chain, lvl).to_lowercase());
        g.log("eco", &t, &dict! {"x" => gn.at("x"), "y" => gn.at("y")});
    }
}

/// Les casernes logent de la milice : on suit la différence entre deux niveaux.
/// Python : `_milice(n, chain, old, new)`.
// game/cities.py, lignes 277 à 284
pub fn _milice(n: &Val, chain: &str, old: i64, new: i64) {
    let lv = CHAINS().at(chain).at("levels");
    let a = if old > 0 { lv.at(old - 1).at("fx").get_or("milice", 0) } else { Val::from(0) };
    let b = if new > 0 { lv.at(new - 1).at("fx").get_or("milice", 0) } else { Val::from(0) };
    if a != b {
        n.set("milice_max", EV::_max(Val::from(20.0), &(&n.at("milice_max") + &b) - &a));
        n.set("milice", EV::_min(n.at("milice"), n.at("milice_max")));
    }
}

/// Python : `demolish(g, code, nid, chain)`.
// game/cities.py, lignes 287 à 305
pub fn demolish(g: &mut Game, code: &str, nid: i64, chain: &str) -> (bool, String) {
    let n = g.nodes.at(nid);
    let gn = g.geo.nodes.at(nid);
    if n.at("owner") != code {
        return (false, "Cette ville ne vous appartient pas.".to_string());
    }
    let s = slots(&n);
    if !s.has(chain) {
        return (false, "Aucun bâtiment de ce type ici.".to_string());
    }
    if n.atb("siege") {
        return (false, "La place est assiégée.".to_string());
    }
    let lvl = s.pop(chain).i();
    let q: Val = n.at("queue").iter().filter(|q| !(q.at("kind") == "slot" && q.at("what") == chain)).collect();
    n.set("queue", q);
    _milice(&n, chain, lvl, 0);
    if chain == "depot" {
        n.set("depot", 0);
    }
    g._dirty_income = true;
    if lvl == 0 {
        return (true, format!("Chantier abandonné à {} : l'emplacement est libre.", gn.at("name")));
    }
    (true, format!("Démolition à {} : {} ; l'emplacement est libre.", gn.at("name"), level_name(g, nid, chain, lvl).to_lowercase()))
}

/// Remet d'accord les emplacements avec la place : magasin pillé, chantier perdu à la prise de la ville,
/// ancienne sauvegarde dont le magasin occupe un emplacement, politique d'un ancien maître.
/// Python : `sync(g, n)`.
// game/cities.py, lignes 308 à 323
pub fn sync(g: &mut Game, n: &Val) {
    let s = slots(n);
    if n.getb("depot") && !s.has("depot") {
        s.set("depot", 1);
    } else if !n.getb("depot") && s.getb("depot") {
        s.del("depot");
    }
    let zeros: Vec<Val> = s.items().into_iter().filter(|(_, v)| *v == 0i64).map(|(k, _)| k).collect();
    for k in zeros {
        if !n.at("queue").iter().any(|q| q.at("kind") == "slot" && q.at("what") == k) {
            s.del(&k);
        }
    }
    let p = n.get("pol");
    if p.truthy() && p.get("o") != n.at("owner") {
        n.del("pol");
    }
    if n.getb("tm") {
        let tm: Val = n.at("tm").iter().filter(|e| e.atf("until") > g.t).collect();
        n.set("tm", tm);
    }
}

// ------------------------------------------------------------------ effets

/// Python : `_add(tot, fx, w=1.0)`.
/// tot : le dict à compléter ; w : 1.0 par défaut.
/// Piège : `v * w` avec w = 1.0 rend un flottant (un int de fx devient float dans tot).
// game/cities.py, lignes 327 à 334
pub fn _add(tot: &Val, fx: &Val, w: f64) {
    for (k, v) in fx.items() {
        if k == "ev" {
            let ev = tot.setdefault("ev", dict! {});
            for (e, x) in v.items() {
                ev.set(&e, &ev.get_or(&e, 0) + &(&x * w));
            }
        } else if v.is_num() {
            tot.set(&k, &tot.get_or(&k, 0) + &(&v * w));
        }
    }
}

py_const!(_EMPTY, dict!{}); // (le dict vide partagé que rendent bfx et pfx : ne pas le modifier)
// Effets de chaque politique, cumulés une fois (`for _k, _p in POLICIES.items(): _add(_PFX.setdefault(_k, {}), _p['fx'])`,
// plus bas dans le Python, après bfx : fait ici à la création).
py_const!(_PFX, {
    let pfx = dict! {};
    for (k, p) in POLICIES().items() {
        _add(&pfx.setdefault(k, dict! {}), &p.at("fx"), 1.0);
    }
    pfx
});
py_const!(_BFX, dict!{}); // effets d'une combinaison de bâtiments (ne dépend que des emplacements) : calculés une fois ; clé : le tuple des (chaîne, niveau)

/// Effets cumulés des bâtiments achevés de la place (dictionnaire partagé : ne pas le modifier).
/// Python : `bfx(n)`.
/// Rend le dict partagé de _BFX (ou _EMPTY).
// game/cities.py, lignes 342 à 357
pub fn bfx(n: &Val) -> Val {
    let s = n.get("slots");
    if !s.truthy() {
        return _EMPTY();
    }
    let key = Val::tuple(s.items().into_iter().map(|(c, l)| tup![c, l]).collect());
    let mut tot = _BFX().get(&key);
    if tot.is_none() {
        tot = dict! {};
        for cl in key.iter() {
            let (c, lvl) = cl.pair();
            if lvl > 0i64 && CHAINS().has(&c) {
                let levels = CHAINS().at(&c).at("levels");
                let i = if (levels.len() as i64) < lvl.i() { levels.len() as i64 } else { lvl.i() };
                _add(&tot, &levels.at(i - 1).at("fx"), 1.0);
            }
        }
        if _BFX().len() > 5000 {
            _BFX().clear();
        }
        _BFX().set(&key, &tot);
    }
    tot
}

// (la boucle qui remplit _PFX : faite à sa création, plus haut)

/// Avancement du changement de politique (0 au début, 1 une fois achevé).
/// Python : `policy_w(g, n)`.
// game/cities.py, lignes 364 à 370
pub fn policy_w(g: &Game, n: &Val) -> f64 {
    let p = n.get("pol");
    if !p.truthy() {
        return 1.0;
    }
    let u = p.get("u");
    let u = if u.truthy() { u.f() } else { TT::turn_start_after(g, p.atf("t") + POLICY_OLD_DAYS as f64) };
    let d = u - p.atf("t");
    let x = (g.t - p.atf("t")) / if d > 1e-6 { d } else { 1e-6 };
    let x = if x < 1.0 { x } else { 1.0 };
    if x > 0.0 { x } else { 0.0 }
}

/// Effets de la politique en vigueur, mêlés à ceux de la précédente pendant la transition
/// (dictionnaire partagé une fois la transition achevée : ne pas le modifier).
/// Python : `pfx(g, n)`.
// game/cities.py, lignes 373 à 385
pub fn pfx(g: &Game, n: &Val) -> Val {
    let p = n.get("pol");
    if !p.truthy() || p.get("o") != n.at("owner") {
        return _EMPTY();
    }
    let w = policy_w(g, n);
    if w >= 1.0 {
        return _PFX().at(p.at("k"));
    }
    let tot = dict! {};
    _add(&tot, &POLICIES().at(p.at("k")).at("fx"), w);
    _add(&tot, &POLICIES().at(p.get_or("p", "equilibre")).at("fx"), 1.0 - w);
    tot
}

/// Production de base ajoutée par les bâtiments, la politique et les événements de la place
/// (avant population, ordre public et outils). Renvoie la part de commerce, sensible au blocus.
/// Python : `node_extra(g, n, code, out, trade)`.
/// out : le dict de production de la place (modifié) ; rend le commerce.
// game/cities.py, lignes 388 à 425
pub fn node_extra(g: &Game, n: &Val, code: &str, out: &Val, trade: f64) -> f64 {
    let mut trade = trade;
    if !(n.getb("slots") || n.getb("pol") || n.getb("tm") || n.getb("bo")) {
        return trade;
    }
    let b = bfx(n);
    let gn = g.geo.nodes.at(n.at("id"));
    let sk = SIZE_K().atf(gn.at("type"));
    for k in PROD().iter() {
        if b.getb(&k) {
            out.set(&k, &out.get_or(&k, 0) + &(&b.at(&k) * sk));
        }
    }
    let bo = n.get("bo");
    for (k, v) in (if bo.truthy() { bo } else { dict! {} }).items() {
        out.set(&k, &out.get_or(&k, 0) + &v);
    }
    if b.getb("spec") && gn.getb("star") && R::SPECIALTY().has(gn.at("star").at(0)) {
        let sp = R::SPECIALTY().at(gn.at("star").at(0));
        let boost = if sp.getb("boost") { g.mod_(code, sp.at("boost").s(), 0.0) } else { 0.0 };
        let k = (1.0 + boost) * (if gn.at("type") == "capitale" { R::SPECIALTY_CAPITAL } else { 1.0 }) * b.atf("spec");
        for r in PROD().iter() {
            if sp.has(&r) {
                out.set(&r, &out.at(&r) + &(&sp.at(&r) * k));
            }
        }
        if sp.get("boost") == "port" {
            trade += sp.get_or("livres", 0).f() * k;
        }
    }
    if b.getb("trade") {
        out.set("livres", &out.at("livres") + &(&b.at("trade") * sk));
        trade += b.atf("trade") * sk;
    }
    let mut m = pfx(g, n);
    if n.getb("tm") {
        m = m.copy();
        for e in n.at("tm").iter() {
            if e.atf("until") > g.t {
                m.set(e.at("k"), &m.get_or(e.at("k"), 0) + &e.at("v"));
            }
        }
    }
    if m.truthy() {
        for r in PROD().iter() {
            let k = &(1i64 + &m.get_or(&r, 0)) + &m.get_or("prod", 0);
            if k != 1i64 {
                out.set(&r, &out.at(&r) * &EV::_max(Val::from(0.1), k));
            }
        }
        trade *= EV::_max(Val::from(0.1), &(1i64 + &m.get_or("livres", 0)) + &m.get_or("prod", 0)).f();
    }
    trade
}

/// Python : `stab_bonus(g, n)`.
// game/cities.py, lignes 428 à 435
pub fn stab_bonus(g: &Game, n: &Val) -> f64 {
    // appelé très souvent (ordre public) : seuls l'hospice, la fabrique, l'église, le collège et la politique comptent
    let (s, mut v) = (n.get("slots"), 0.0);
    if s.truthy() && (s.has("hospice") || s.has("atelier") || s.has("eglise") || s.has("universite")) {
        v += bfx(n).get_or("stab", 0).f();
    }
    if n.getb("pol") {
        v += pfx(g, n).get_or("stab", 0).f();
    }
    v
}

/// Python : `growth_k(g, n)`.
// game/cities.py, lignes 438 à 439
pub fn growth_k(g: &Game, n: &Val) -> f64 {
    let k = 1.0 + bfx(n).get_or("grow", 0).f() + pfx(g, n).get_or("grow", 0).f();
    if k > 0.2 { k } else { 0.2 }
}

/// Python : `train_k(g, n, typ)`.
// game/cities.py, lignes 442 à 445
pub fn train_k(g: &Game, n: &Val, typ: &str) -> f64 {
    let (b, p) = (bfx(n), pfx(g, n));
    let k = b.get_or("train", 0).f() + p.get_or("train", 0).f() + if typ == "cavalerie" { b.get_or("cav_train", 0).f() } else { 0.0 }
        + if R::UNITS().at(typ).get("cls") == "artillerie" { b.get_or("art_train", 0).f() } else { 0.0 }; // (SPEC-EMPIRE, module 4) fonderies
    let k = 1.0 - k;
    if k > 0.4 { k } else { 0.4 }
}

/// Python : `train_xp(g, n)`.
/// Rend un nombre (int ou float, comme le Python : il s'ajoute à l'expérience des régiments).
// game/cities.py, lignes 448 à 449
pub fn train_xp(g: &Game, n: &Val) -> Val {
    &bfx(n).get_or("xp", 0) + &pfx(g, n).get_or("xp", 0)
}

/// Entretien des bâtiments d'emplacement, en livres par jour.
/// Python : `upkeep(g, code)`.
// game/cities.py, lignes 452 à 460
pub fn upkeep(g: &Game, code: &str) -> f64 {
    let mut tot = 0.0;
    for n in g.owned(code) {
        if n.getb("slots") {
            for (c, lvl) in n.at("slots").items() {
                if lvl > 0i64 && CHAINS().has(&c) {
                    let levels = CHAINS().at(&c).at("levels");
                    let i = if (levels.len() as i64) < lvl.i() { levels.len() as i64 } else { lvl.i() };
                    tot += levels.at(i - 1).get_or("up", 0).f();
                }
            }
        }
    }
    tot
}

/// Un demi-point de rayonnement par niveau de bâtiment.
/// Python : `prestige(nodes)`.
/// nodes : une liste de places.
// game/cities.py, lignes 463 à 465
pub fn prestige(nodes: &Val) -> f64 {
    let mut v = vec![];
    for n in nodes.iter() {
        let s = n.get("slots");
        for x in (if s.truthy() { s } else { dict! {} }).values() {
            v.push(EV::_max(Val::from(0), x));
        }
    }
    py::sum_v(v).f() / 2.0
}

/// Python : `set_policy(g, code, nid, k, same_type=False)`.
/// same_type : False par défaut.
// game/cities.py, lignes 468 à 485
pub fn set_policy(g: &mut Game, code: &str, nid: i64, k: &str, same_type: bool) -> (bool, String) {
    if !POLICIES().has(k) {
        return (false, "Politique inconnue.".to_string());
    }
    let n = g.nodes.at(nid);
    if n.at("owner") != code {
        return (false, "Cette ville ne vous appartient pas.".to_string());
    }
    let typ = g.geo.nodes.at(nid).ats("type");
    let targets: Vec<Val> = if same_type {
        g.owned_nodes(code).iter().filter(|m| g.geo.nodes.at(m.at("id")).at("type") == typ).collect()
    } else {
        vec![n.clone()]
    };
    let mut changed = 0i64;
    for m in &targets {
        if _set_policy(g, m, k) {
            changed += 1;
        }
    }
    let lab = POLICIES().at(k).ats("label");
    let name = g.geo.nodes.at(nid).ats("name");
    if same_type {
        let what = match typ.as_str() {
            "village" => "tous vos villages",
            "fort" => "toutes vos places fortes",
            "ville" => "toutes vos villes",
            "capitale" if g.theatre() => "toutes vos capitales",
            "capitale" => "tous vos chefs-lieux",
            _ => panic!("KeyError: {}", py::repr_s(&typ)),
        };
        return if changed != 0 {
            (true, format!("Politique « {lab} » dans {} de plus ({what}).", R::pl(changed, "place", None)))
        } else {
            let mut c = what.chars();
            let w = c.next().unwrap().to_uppercase().chain(c).collect::<String>();
            (true, format!("{w} suivent déjà la politique « {lab} »."))
        };
    }
    if changed == 0 {
        return (true, format!("{name} suit déjà la politique « {lab} »."));
    }
    (true, format!("{name} : politique « {lab} », en place au prochain tour."))
}

/// Python : `_set_policy(g, n, k)`.
// game/cities.py, lignes 488 à 497
pub fn _set_policy(g: &mut Game, n: &Val, k: &str) -> bool {
    let p = n.get("pol");
    let cur = if p.truthy() && p.get("o") == n.at("owner") { p.at("k") } else { Val::from("equilibre") };
    if cur == k {
        return false;
    }
    // en pleine transition, on repart de la politique qui dominait encore
    let prev = if !p.truthy() || policy_w(g, n) >= 0.5 { cur } else { p.get_or("p", "equilibre") };
    let owner = n.ats("owner");
    let u = TT::deadline(g, POLICY_TOURS, &[owner.as_str()]);
    n.set("pol", dict! {"k" => k, "p" => prev, "t" => g.t, "u" => u, "o" => &owner});
    g._dirty_income = true;
    true
}

// ------------------------------------------------------------------ chaque jour

/// Python : `daily(g, d)`.
// game/cities.py, lignes 501 à 507
pub fn daily(g: &mut Game, d: Date) {
    for n in g.nodes.iter() {
        if n.getb("slots") || n.getb("depot") || n.getb("pol") || n.getb("tm") {
            sync(g, &n);
        }
    }
    research(g);
    if !g.over.truthy() {
        tick(g);
    }
}

/// Jours de recherche gagnés chaque jour grâce aux collèges et universités (au plus COLLEGE_MAX).
/// Python : `college_k(g, code)`.
// game/cities.py, lignes 510 à 512
pub fn college_k(g: &Game, code: &str) -> f64 {
    let s = py::sum_v(g.owned_nodes(code).iter().filter(|n| n.getb("slots")).map(|n| bfx(&n).get_or("research", 0))).f();
    if s < COLLEGE_MAX { s } else { COLLEGE_MAX }
}

/// Les collèges forment des savants : les recherches en cours avancent un peu plus vite (au plus +25 %).
/// Python : `research(g)`.
// game/cities.py, lignes 515 à 524
pub fn research(g: &mut Game) {
    for (code, f) in g.factions.items() {
        if !f.atb("alive") {
            continue;
        }
        let k = college_k(g, code.s());
        if k > 0.0 {
            for cur in f.at("research").values() {
                if cur.truthy() {
                    cur.dec("left", k);
                }
            }
        }
    }
}

// ------------------------------------------------------------------ événements locaux

/// Python : `_river(g, nid)`.
/// Rend la liste des voies d'eau (noms) du quai, sans la mer.
// game/cities.py, lignes 528 à 529
pub fn _river(g: &Game, nid: i64) -> Val {
    g.geo.ports.get_or(nid, list![]).iter().filter(|w| !g.geo.ways.at(w).atb("sea")).collect()
}

/// Python : `_hilly(g, nid)`.
// game/cities.py, lignes 532 à 535
pub fn _hilly(g: &Game, nid: i64) -> bool {
    let gn = g.geo.nodes.at(nid);
    let t = TERRAIN().at(g.geo.terrain_at(gn.atf("x"), gn.atf("y"))).at(0);
    t == "Collines" || t == "Montagne" || t == "Haute montagne"
}

/// Python : `_troops(g, n, code)`.
// game/cities.py, lignes 538 à 543
pub fn _troops(g: &Game, n: &Val, code: &str) -> bool {
    if n.at("owner") != code {
        return false;
    }
    if n.atb("garrison") {
        return true;
    }
    g.armies.values().iter().any(|a| a.at("owner") == code && a.at("at_node") == n.at("id") && a.at("state") == "idle")
}

/// Python : `_w_incendie(g, n, gn, s)`.
/// s : la saison (g.season()).
// game/cities.py, lignes 546 à 547
pub fn _w_incendie(g: &Game, n: &Val, gn: &Val, s: &str) -> f64 {
    match s {
        "été" => 1.5,
        "hiver" => 1.2,
        _ => 1.0,
    }
}

/// Python : `_w_epidemie(g, n, gn, s)`.
// game/cities.py, lignes 550 à 551
pub fn _w_epidemie(g: &Game, n: &Val, gn: &Val, s: &str) -> f64 {
    (match s {
        "été" => 1.5,
        "automne" => 1.2,
        _ => 0.9,
    }) * (if g.geo.ports.has(n.at("id")) { 1.3 } else { 1.0 })
}

/// Python : `_w_disette(g, n, gn, s)`.
// game/cities.py, lignes 554 à 556
pub fn _w_disette(g: &Game, n: &Val, gn: &Val, s: &str) -> f64 {
    let f = g.factions.at(n.at("owner"));
    let k = match s {
        "hiver" => 1.4,
        "printemps" => 1.6,
        "été" => 0.6,
        "automne" => 0.4,
        _ => panic!("KeyError: {}", py::repr_s(s)),
    };
    k * (if f.getb("famine") { 3.0 } else { 1.0 })
}

/// Python : `_w_brigands(g, n, gn, s)`.
// game/cities.py, lignes 559 à 561
pub fn _w_brigands(g: &Game, n: &Val, gn: &Val, s: &str) -> f64 {
    let o0 = n.ats("owner");
    let wars = g.factions.keys().iter().any(|o| *o != o0 && g.factions.at(o).atb("alive") && g.at_war(&o0, o.s()));
    let st = 0.8 - n.atf("stab");
    (if gn.at("type") == "village" { 1.5 } else { 1.0 }) * (1.0 + 2.0 * if st > 0.0 { st } else { 0.0 }) * (if wars { 1.3 } else { 1.0 })
}

/// Python : `_w_foire(g, n, gn, s)`.
// game/cities.py, lignes 564 à 567
pub fn _w_foire(g: &Game, n: &Val, gn: &Val, s: &str) -> f64 {
    let t = gn.at("type");
    if (t == "village" || t == "fort") && !gn.atb("spec") {
        return 0.0;
    }
    match s {
        "printemps" => 1.4,
        "automne" => 1.5,
        "hiver" => 0.3,
        _ => 1.0,
    }
}

py_const!(GRANDS, tup!["Garonne", "Dordogne"]);  // les grands fleuves, ceux de la grande crue (engine : flood_until)

/// Au printemps, au bord de la Garonne ou de la Dordogne : surtout pendant la grande crue, un peu l'année d'une
/// grande crue, presque jamais les autres années.
/// Python : `_w_crue(g, n, gn, s)`.
// game/cities.py, lignes 573 à 580
pub fn _w_crue(g: &Game, n: &Val, gn: &Val, s: &str) -> f64 {
    // (un théâtre : toutes les voies d'eau douce y sont de grands fleuves)
    if s != "printemps" || !_river(g, n.ati("id")).iter().any(|w| g.theatre() || GRANDS().has(&w)) {
        return 0.0;
    }
    if g.flooded() {
        return 3.0;
    }
    if g.flood_until > 0.0 && g.date(&Val::from(g.flood_until)).year == g.date(&Val::None).year { 0.5 } else { 0.05 }
}

/// Python : `_w_refugies(g, n, gn, s)`.
// game/cities.py, lignes 583 à 587
pub fn _w_refugies(g: &Game, n: &Val, gn: &Val, s: &str) -> f64 {
    let t = gn.at("type");
    if !(t == "ville" || t == "capitale") {
        return 0.0;
    }
    let o0 = n.ats("owner");
    let wars = g.factions.keys().iter().any(|o| *o != o0 && g.factions.at(o).atb("alive") && g.at_war(&o0, o.s()));
    if wars { 3.0 } else { 0.4 }
}

/// Python : `_w_filon(g, n, gn, s)`.
// game/cities.py, lignes 590 à 596
pub fn _w_filon(g: &Game, n: &Val, gn: &Val, s: &str) -> f64 {
    let bo = n.get("bo");
    if (if bo.truthy() { bo } else { dict! {} }).getb("fer") {
        return 0.0;
    }
    let mut k = if _hilly(g, n.ati("id")) { 2.0 } else { 1.0 };
    let st = gn.get("star");
    if gn.at("spec").has("fer") || (if st.truthy() { st } else { list![""] }).at(0) == "forge" {
        k *= 2.0;
    }
    k
}

/// Python : `_w_emeute(g, n, gn, s)`.
// game/cities.py, lignes 599 à 601
pub fn _w_emeute(g: &Game, n: &Val, gn: &Val, s: &str) -> f64 {
    let tax = g.factions.at(n.at("owner")).get_or("tax", 0.5);
    let st = 0.8 - n.atf("stab");
    0.4 * (1.0 + 6.0 * if st > 0.0 { st } else { 0.0 }) * (if tax > 0.6 { 2.0 } else { 1.0 })
}

// Chaque choix : res (coût ou gain du camp, multiplié selon la taille de la place), v (effets sur la ville :
// pop, stab, tm {k: part} pendant days jours, add {ressource: par jour} durable), troops (garnison exigée), ai (poids).
py_const!(LOCAL, list![
    dict!{
        "id" => "incendie",
        "short" => "incendies",
        "w" => 3.0,
        "weight" => "_w_incendie",
        "title" => "L'incendie {de_ville}",
        "text" => "Un soir de grand vent, le feu prend chez un boulanger et court de toit en toit : des rues entières {de_ville} partent en fumée.",
        "base" => dict!{"pop" => -0.02},
        "choices" => list![
            dict!{
                "label" => "Rebâtir en pierre et en tuile",
                "res" => dict!{"livres" => -150, "bois" => -40},
                "v" => dict!{"stab" => 0.04},
                "ai" => 2,
            },
            dict!{
                "label" => "Envoyer la garnison faire la chaîne",
                "troops" => true,
                "v" => dict!{"stab" => 0.02, "tm" => dict!{"prod" => -0.1}, "days" => 60},
                "ai" => 2,
            },
            dict!{
                "label" => "Laisser les habitants rebâtir",
                "v" => dict!{"stab" => -0.06, "tm" => dict!{"prod" => -0.25}, "days" => 120},
                "ai" => 1,
            },
        ],
    },
    dict!{
        "id" => "epidemie",
        "short" => "fièvres",
        "w" => 2.5,
        "weight" => "_w_epidemie",
        "title" => "La fièvre {a_ville}",
        "text" => "Une fièvre maligne se déclare dans les quartiers bas {de_ville}. Les médecins parlent de miasmes et réclament des mesures.",
        "base" => dict!{"pop" => -0.015},
        "choices" => list![
            dict!{
                "label" => "Quarantaine et médecins",
                "res" => dict!{"livres" => -120},
                "v" => dict!{"stab" => 0.02},
                "ai" => 2,
            },
            dict!{
                "label" => "Cordon sanitaire tenu par la garnison",
                "troops" => true,
                "v" => dict!{"tm" => dict!{"prod" => -0.15}, "days" => 45},
                "ai" => 2,
            },
            dict!{"label" => "Laisser passer l'épidémie", "v" => dict!{"pop" => -0.04, "stab" => -0.05}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "disette",
        "short" => "disettes",
        "w" => 2.5,
        "weight" => "_w_disette",
        "title" => "Disette {a_ville}",
        "text" => "La soudure est difficile : le pain manque et son prix double sur le marché {de_ville}. On murmure contre les accapareurs.",
        "choices" => list![
            dict!{
                "label" => "Ouvrir les greniers",
                "res" => dict!{"vivres" => -80},
                "v" => dict!{"stab" => 0.04},
                "ai" => 2,
            },
            dict!{
                "label" => "Faire venir du grain",
                "res" => dict!{"livres" => -110},
                "v" => dict!{"stab" => 0.02},
                "ai" => 2,
            },
            dict!{"label" => "Laisser faire le marché", "v" => dict!{"stab" => -0.08, "pop" => -0.02}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "brigands",
        "short" => "brigands",
        "w" => 2.5,
        "weight" => "_w_brigands",
        "title" => "Des brigands près {de_ville}",
        "text" => "Une bande de déserteurs et de faux-sauniers détrousse marchands et rouliers sur les chemins {de_ville}.",
        "choices" => list![
            dict!{
                "label" => "Envoyer la garnison battre la campagne",
                "troops" => true,
                "v" => dict!{"stab" => 0.03},
                "ai" => 3,
            },
            dict!{"label" => "Payer la maréchaussée", "res" => dict!{"livres" => -90}, "ai" => 2},
            dict!{
                "label" => "Fermer les yeux",
                "v" => dict!{"stab" => -0.04, "tm" => dict!{"livres" => -0.3}, "days" => 90},
                "ai" => 1,
            },
        ],
    },
    dict!{
        "id" => "foire",
        "short" => "foires",
        "w" => 2.5,
        "weight" => "_w_foire",
        "title" => "La grande foire {de_ville}",
        "text" => "Maquignons, drapiers et colporteurs affluent de tout le pays : la foire {de_ville} s'annonce comme la plus belle depuis des années.",
        "choices" => list![
            dict!{
                "label" => "Accorder des franchises aux marchands",
                "res" => dict!{"livres" => -60},
                "v" => dict!{"stab" => 0.02, "tm" => dict!{"livres" => 0.4}, "days" => 60},
                "ai" => 2,
            },
            dict!{
                "label" => "Lever un droit sur les étals",
                "res" => dict!{"livres" => 90},
                "v" => dict!{"stab" => -0.02},
                "ai" => 1,
            },
        ],
    },
    dict!{
        "id" => "crue",
        "short" => "crues",
        "w" => 3.0,
        "weight" => "_w_crue",
        "title" => "Crue {a_ville}",
        "text" => "Grossie par les pluies du printemps et la fonte des neiges, {riviere} sort de son lit : les quais et les bas quartiers {de_ville} sont sous l'eau.",
        "choices" => list![
            dict!{
                "label" => "Renforcer les digues",
                "res" => dict!{"livres" => -100, "bois" => -50},
                "v" => dict!{"tm" => dict!{"prod" => -0.05}, "days" => 30},
                "ai" => 2,
            },
            dict!{
                "label" => "Évacuer les bas quartiers",
                "v" => dict!{"tm" => dict!{"prod" => -0.15}, "days" => 45},
                "ai" => 2,
            },
            dict!{
                "label" => "Attendre la décrue",
                "res" => dict!{"vivres" => -40},
                "v" => dict!{"pop" => -0.01, "tm" => dict!{"prod" => -0.3}, "days" => 60},
                "ai" => 1,
            },
        ],
    },
    dict!{
        "id" => "refugies",
        "short" => "réfugiés",
        "w" => 1.5,
        "weight" => "_w_refugies",
        "title" => "Des réfugiés {a_ville}",
        "text" => "Des familles chassées par la guerre et la misère se pressent aux portes {de_ville}, leurs hardes entassées sur des charrettes.",
        "choices" => list![
            dict!{
                "label" => "Les accueillir",
                "res" => dict!{"vivres" => -60},
                "v" => dict!{"pop" => 0.03, "stab" => -0.02},
                "ai" => 2,
            },
            dict!{
                "label" => "Enrôler les hommes valides",
                "res" => dict!{"recrues" => 120},
                "v" => dict!{"stab" => -0.03},
                "ai" => 1,
            },
            dict!{"label" => "Leur fermer les portes", "v" => dict!{}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "filon",
        "short" => "filons",
        "w" => 0.7,
        "weight" => "_w_filon",
        "title" => "Un filon près {de_ville}",
        "text" => "En creusant un puits, des paysans tombent sur une veine de minerai de fer. Un maître de forges propose de l'exploiter.",
        "choices" => list![
            dict!{
                "label" => "Ouvrir une mine",
                "res" => dict!{"livres" => -160, "outils" => -20},
                "v" => dict!{"add" => dict!{"fer" => 0.4}},
                "ai" => 2,
            },
            dict!{"label" => "Vendre la concession", "res" => dict!{"livres" => 120}, "ai" => 1},
        ],
    },
    dict!{
        "id" => "emeute",
        "short" => "émeutes",
        "w" => 1.0,
        "weight" => "_w_emeute",
        "title" => "Émotion populaire {a_ville}",
        "text" => "Des femmes du peuple s'attroupent devant l'hôtel de ville {de_ville} : on réclame du pain à juste prix et la fin de l'octroi.",
        "choices" => list![
            dict!{
                "label" => "Disperser l'attroupement avec la garnison",
                "troops" => true,
                "v" => dict!{"stab" => 0.05},
                "ai" => 2,
            },
            dict!{
                "label" => "Baisser l'octroi",
                "res" => dict!{"livres" => -80},
                "v" => dict!{"stab" => 0.06},
                "ai" => 2,
            },
            dict!{
                "label" => "Laisser gronder",
                "v" => dict!{"stab" => -0.08, "tm" => dict!{"prod" => -0.15}, "days" => 30},
                "ai" => 1,
            },
        ],
    },
]);
py_const!(LOCAL_BY_ID, {
    let d = dict! {};
    for e in LOCAL().iter() {
        d.set(e.at("id"), e);
    }
    d
}); // (les mêmes dict que LOCAL)

/// Les fonctions de poids que LOCAL tient (`weight=_w_incendie`…) : une valeur ne tient pas de fonction, LOCAL tient
/// donc leur nom. `e['weight'](g, n, gn, s)` s'écrit `_LOCAL_WEIGHT(e.at("weight").s())(g, n, gn, s)`.
pub fn _LOCAL_WEIGHT(nom: &str) -> fn(&Game, &Val, &Val, &str) -> f64 {
    match nom {
        "_w_incendie" => _w_incendie,
        "_w_epidemie" => _w_epidemie,
        "_w_disette" => _w_disette,
        "_w_brigands" => _w_brigands,
        "_w_foire" => _w_foire,
        "_w_crue" => _w_crue,
        "_w_refugies" => _w_refugies,
        "_w_filon" => _w_filon,
        "_w_emeute" => _w_emeute,
        _ => panic!("pas de fonction de poids {nom:?} dans LOCAL"),
    }
}

/// Python : `_fill(g, nid, s)`.
/// `s.format(ville=…, de_ville=…, a_ville=…, riviere=…)`.
// game/cities.py, lignes 662 à 669
pub fn _fill(g: &Game, nid: i64, s: &str) -> String {
    let gn = g.geo.nodes.at(nid);
    let v = gn.ats("name");
    let a_ville = EV::_a_ville(&v);
    let riv = py::sorted_by_key(_river(g, nid).vec(), |w| !GRANDS().has(w)); // (Libourne : la Dordogne plutôt que l'Isle)
    let r0 = if riv.is_empty() { String::new() } else { riv[0].string() };
    let riviere = match r0.as_str() {
        "Garonne" => "la Garonne",
        "Dordogne" => "la Dordogne",
        "Isle" => "l'Isle",
        "Lot" => "le Lot",
        "Baïse" => "la Baïse",
        "Midouze" => "la Midouze",
        "Adour" => "l'Adour",
        _ if g.theatre() && !r0.is_empty() => "le fleuve",
        _ => "la rivière",
    };
    EV::_format(s, &[("ville", v.clone()), ("de_ville", R::de(&v)), ("a_ville", a_ville), ("riviere", riviere.to_string())])
}

/// Chaque jour, chaque camp peut connaître un événement dans une de ses places.
/// Python : `tick(g)`.
/// Hasard (g.rng) : random() par camp vivant, puis `choices(cands, poids)[0]` (choix_pondere).
/// Piège : busy est un set de numéros de places (ou None) : il ne sert qu'aux tests d'appartenance.
// game/cities.py, lignes 672 à 695
pub fn tick(g: &mut Game) {
    let st = stats(g);
    let busy: Val = Val::set_from(g.pending_ev.iter().filter(|p| p.get("kind") == "ville").map(|p| p.get("town")).collect());
    for (code, f) in g.factions.items() {
        let code = code.string();
        if !f.atb("alive") {
            continue;
        }
        if code == g.player && busy.truthy() {
            continue; // une décision locale à la fois : le joueur n'est pas assailli
        }
        let mine = g.owned_nodes(&code);
        if !mine.truthy() {
            continue;
        }
        let avg = py::sum_v(mine.iter().map(|n| n.at("stab"))).f() / mine.len() as f64;
        let wars = g.factions.keys().iter().any(|o| *o != code && g.factions.at(o).atb("alive") && g.at_war(&code, o.s()));
        let x = 0.75 - avg;
        let p = EV_RATE * (1.0 + 2.0 * if x > 0.0 { x } else { 0.0 }) * (if wars { 1.2 } else { 1.0 });
        if g.rng.random() >= p {
            continue;
        }
        let cands: Vec<Val> = mine
            .iter()
            .filter(|n| !n.atb("siege") && g.t - n.get_or("evt", -1e9).f() > CITY_GAP as f64 && !busy.has(n.at("id")))
            .collect();
        if cands.is_empty() {
            continue;
        }
        let w: Vec<f64> = cands.iter().map(|m| TOWN_W().atf(g.geo.nodes.at(m.at("id")).at("type"))).collect();
        let n = g.rng.choix_pondere(&cands, &w);
        if fire(g, &code, &n, &Val::None) {
            let key = format!("ev_{}", if code == g.player { "joueur" } else { "ia" });
            st.set(key.as_str(), &st.get_or(key.as_str(), 0) + 1i64);
        }
    }
}

/// La grande crue tirée (engine.monthly) : dans un camp sur deux, une place au bord de la Garonne ou de la Dordogne
/// sous l'eau.
/// Python : `grande_crue(g)`.
// game/cities.py, lignes 698 à 708
pub fn grande_crue(g: &mut Game) {
    let busy: Val = Val::set_from(g.pending_ev.iter().filter(|p| p.get("kind") == "ville").map(|p| p.get("town")).collect());
    for (code, f) in g.factions.items() {
        let code = code.string();
        if !f.atb("alive") || (code == g.player && busy.truthy()) {
            continue;
        }
        let bords: Vec<Val> = g
            .owned_nodes(&code)
            .iter()
            .filter(|n| {
                !n.atb("siege")
                    && g.t - n.get_or("evt", -1e9).f() > CITY_GAP as f64
                    && _river(g, n.ati("id")).iter().any(|w| GRANDS().has(&w))
            })
            .collect();
        if !bords.is_empty() && g.rng.random() < 0.5 {
            let w: Vec<f64> = bords.iter().map(|m| TOWN_W().atf(g.geo.nodes.at(m.at("id")).at("type"))).collect();
            let n = g.rng.choix_pondere(&bords, &w);
            fire(g, &code, &n, &LOCAL_BY_ID().at("crue"));
        }
    }
}

/// Événements possibles dans cette place, avec leur poids (saison, ordre public, bâtiments, politique).
/// Python : `weights(g, n)`.
/// Rend les (événement de LOCAL, poids) de poids positif, dans l'ordre de LOCAL.
// game/cities.py, lignes 711 à 724
pub fn weights(g: &Game, n: &Val) -> Vec<(Val, f64)> {
    let gn = g.geo.nodes.at(n.at("id"));
    let s = g.season();
    let mods = dict! {};
    _add(&mods, &dict! {"ev" => bfx(n).get_or("ev", dict! {})}, 1.0);
    _add(&mods, &dict! {"ev" => pfx(g, n).get_or("ev", dict! {})}, 1.0);
    let mods = mods.get_or("ev", dict! {});
    let mut out = vec![];
    for e in LOCAL().iter() {
        let m = 1.0 + mods.get_or(e.at("id"), 0).f();
        let w = e.atf("w") * _LOCAL_WEIGHT(e.at("weight").s())(g, n, &gn, &s) * if m > 0.1 { m } else { 0.1 };
        if w > 0.0 {
            out.push((e, w));
        }
    }
    out
}

/// Python : `fire(g, code, n, ev=None)`.
/// ev : None (par défaut : tiré selon weights) ou un événement de LOCAL.
// game/cities.py, lignes 727 à 767
pub fn fire(g: &mut Game, code: &str, n: &Val, ev: &Val) -> bool {
    let mut ev = ev.clone();
    if ev.is_none() {
        let ev_w = weights(g, n);
        if ev_w.is_empty() {
            return false;
        }
        let es: Vec<Val> = ev_w.iter().map(|(e, _)| e.clone()).collect();
        let ws: Vec<f64> = ev_w.iter().map(|(_, w)| *w).collect();
        ev = g.rng.choix_pondere(&es, &ws);
    }
    let nid = n.ati("id");
    let gn = g.geo.nodes.at(nid);
    n.set("evt", g.t);
    n.set("lev", ev.at("id")); // le dernier événement local, que la carte montre (incendie, foire, crue…)
    let k = SIZE_COST().atf(gn.at("type"));
    let (title, text) = (_fill(g, nid, ev.at("title").s()), _fill(g, nid, ev.at("text").s()));
    let id = ev.ats("id");
    let b0 = if ev.getb("base") {
        let b = ev.at("base").copy();
        b.set("nid", nid);
        EV::soften(g, code, &id, &b)
    } else {
        Val::None
    };
    if b0.truthy() {
        apply_local(g, code, &b0);
    }
    let base = if b0.truthy() { EV::_join(&describe_local(g, &b0)) } else { String::new() };
    let mut choices: Vec<(Val, Val)> = vec![];
    for c in ev.at("choices").iter() {
        let v = c.get_or("v", dict! {}).copy();
        v.set("nid", nid);
        let fx = dict! {"ville" => v};
        if c.getb("troops") {
            fx.at("ville").set("troops", true);
        }
        if c.getb("res") {
            fx.set("res", Val::dict_from(c.at("res").items().into_iter().map(|(r, q)| (r, Val::from(py::round(q.f() * k)))).collect()));
        }
        let fx = EV::soften(g, code, &id, &fx);
        choices.push((c, fx));
    }
    stats(g).setdefault("quoi", dict! {}).setdefault(id.as_str(), 0);
    stats(g).at("quoi").inc(id.as_str(), 1);
    if code != g.player {
        let mut ok: Vec<usize> = (0..choices.len()).filter(|&i| EV::affordable(g, code, &choices[i].1)).collect();
        if ok.is_empty() {
            ok = vec![choices.len() - 1];
        }
        let rich = g.factions.at(code).at("res").at("livres") > 1500i64;
        let wts: Vec<f64> = ok
            .iter()
            .map(|&i| {
                let r = choices[i].1.get("res");
                let neg = (if r.truthy() { r } else { dict! {} }).get_or("livres", 0) < 0i64;
                choices[i].0.get_or("ai", 1).f() * if rich && neg { 2.0 } else { 1.0 }
            })
            .collect();
        let i = g.rng.choix_pondere(&ok, &wts);
        EV::apply(g, code, &choices[i].1, &Val::None);
        return true;
    }
    let pid = g.nid("e");
    let until = TT::deadline(g, EV::ANSWER_TOURS, &[]);
    let date = g.date_str(&Val::None);
    let cv: Val = choices
        .iter()
        .map(|(c, fx)| dict! {"label" => c.at("label"), "fx" => fx, "desc" => EV::describe(g, code, fx, &Val::from(nid))})
        .collect();
    g.pending_ev.push(dict! {
        "id" => pid, "ev" => &id, "kind" => "ville", "title" => &title, "text" => &text, "town" => nid,
        "base" => &base, "until" => until, "date" => date, "choices" => cv
    });
    let suite = if !base.is_empty() { format!(" ({base})") } else { String::new() };
    let t = format!("{title}. {text}{suite} Une décision vous attend.");
    g.log("evenement", &t, &dict! {"x" => gn.at("x"), "y" => gn.at("y"), "who" => code, "important" => true});
    g.alert_pause(true);
    true
}

/// Ce choix est-il possible ? (place toujours à nous, garnison sur place si on l'envoie)
/// Python : `local_ok(g, code, v)`.
/// v : l'effet `ville` (dict(nid, …)).
// game/cities.py, lignes 770 à 775
pub fn local_ok(g: &Game, code: &str, v: &Val) -> bool {
    let n = g.nodes.at(v.at("nid"));
    if n.at("owner") != code {
        return true; // la place est perdue : le choix ne fait plus rien, mais on peut le prendre
    }
    !v.getb("troops") || _troops(g, &n, code)
}

/// Taux par jour du moteur, dits par tour en tour par tour (×TOUR_DAYS), par jour en temps réel.
/// Python : `per_k(g)`.
// game/cities.py, lignes 778 à 780
pub fn per_k(g: &Game) -> f64 {
    if g.tour.atb("on") { TT::TOUR_DAYS } else { 1.0 }
}

/// Python : `per_txt(g)`.
// game/cities.py, lignes 783 à 784
pub fn per_txt(g: &Game) -> &'static str {
    if g.tour.atb("on") { "par tour" } else { "par jour" }
}

/// Durée d'un effet d'événement local, écrite en jours dans LOCAL_EVENTS : en tours entiers (30 à 120 jours → 1 à 4).
/// Python : `tours_of(days)`.
// game/cities.py, lignes 787 à 789
pub fn tours_of(days: f64) -> i64 {
    let n = py::int(days / 30.0 + 0.5);
    if n > 1 { n } else { 1 }
}

/// Python : `apply_local(g, code, v)`.
// game/cities.py, lignes 792 à 805
pub fn apply_local(g: &mut Game, code: &str, v: &Val) {
    let n = g.nodes.at(v.at("nid"));
    if n.at("owner") != code {
        return;
    }
    if v.getb("pop") {
        n.set("pop", &n.get_or("pop", 0) * &(1i64 + &v.at("pop")));
    }
    if v.getb("stab") {
        n.set("stab", EV::_max(Val::from(0.0), EV::_min(Val::from(1.0), &n.at("stab") + &v.at("stab"))));
    }
    let tm = v.get("tm");
    for (k, x) in (if tm.truthy() { tm } else { dict! {} }).items() {
        let until = TT::deadline(g, tours_of(v.get_or("days", 60).f()), &[code]);
        n.setdefault("tm", list![]).push(dict! {"k" => k, "v" => x, "until" => until});
    }
    let add = v.get("add");
    for (k, x) in (if add.truthy() { add } else { dict! {} }).items() {
        let bo = n.setdefault("bo", dict! {});
        bo.set(&k, py::round_n((&bo.get_or(&k, 0) + &x).f(), 3));
    }
    g._dirty_income = true;
}

/// Python : `_pct(v)`.
// game/cities.py, lignes 808 à 809
pub fn _pct(v: f64) -> String {
    format!("{}{} %", if v > 0.0 { "+" } else { "−" }, py::round(v * 100.0).abs())
}

/// Python : `describe_local(g, v)`.
/// Rend une liste de textes.
// game/cities.py, lignes 812 à 826
pub fn describe_local(g: &Game, v: &Val) -> Val {
    let name = g.geo.nodes.at(v.at("nid")).ats("name");
    let out = list![];
    if v.getb("troops") {
        out.push("exige une garnison ou une armée au repos dans la place");
    }
    if v.getb("pop") {
        out.push(format!("population {} {}", R::de(&name), _pct(v.atf("pop"))));
    }
    if v.getb("stab") {
        out.push(format!("ordre public {} {}", R::de(&name), _pct(v.atf("stab"))));
    }
    let tm = v.get("tm");
    for (k, x) in (if tm.truthy() { tm } else { dict! {} }).items() {
        let n = tours_of(v.get_or("days", 60).f());
        out.push(format!("{} {} {} pendant {}", TM_LABEL().get_or(&k, &k), R::de(&name), _pct(x.f()), R::pl(n, "tour", None)));
    }
    let add = v.get("add");
    for (k, x) in (if add.truthy() { add } else { dict! {} }).items() {
        out.push(format!(
            "+{} {} {} à {name} (durable)",
            _n(x.f() * per_k(g)),
            R::RES_LABEL().get_or(&k, &k).s().to_lowercase(),
            per_txt(g)
        ));
    }
    out
}

/// Compteurs de la session (simulations) : non sauvegardés.
/// Python : `stats(g)`.
/// Rend g.city_stats (le même dict).
// game/cities.py, lignes 829 à 833
pub fn stats(g: &Game) -> Val {
    g.city_stats.clone()
}

// ------------------------------------------------------------------ IA
// goût de chaque personnalité, selon sa branche de technologie préférée
py_const!(AI_TASTE, dict!{
    "civil" => dict!{"hospice" => 1.4, "marche" => 1.2},
    "industriel" => dict!{"atelier" => 1.5, "quai" => 1.1},
    "agricole" => dict!{"moulins" => 1.4, "specialite" => 1.2},
    "militaire" => dict!{"caserne" => 1.5},
});

/// Gain approché d'un niveau, en livres par jour, selon la place (mult : sa production) et la personnalité de l'IA.
/// Python : `_ai_value(g, ai, n, chain, lvl, mult)`.
// game/cities.py, lignes 843 à 869
pub fn _ai_value(g: &Game, ai: &AI, n: &Val, chain: &str, lvl: i64, mult: f64) -> f64 {
    let f = g.factions.at(ai.code.as_str()); // ai.f
    let code = ai.code.as_str();
    let gn = g.geo.nodes.at(n.at("id"));
    let levels = CHAINS().at(chain).at("levels");
    let L = levels.at(lvl - 1);
    let prev = if lvl > 1 { levels.at(lvl - 2).at("fx") } else { dict! {} };
    let fx = Val::dict_from(L.at("fx").items().into_iter().filter(|(_, v)| v.is_num()).map(|(k, v)| (k.clone(), &v - &prev.get_or(&k, 0))).collect());
    let x = |k: &str| fx.get_or(k, 0).f();
    let hungry = f.at("income").get_or("vivres", 0) < 5i64 || f.getb("famine");
    let mut val = x("livres") + x("trade");
    val += x("vivres") * if hungry { 0.9 } else { 0.35 };
    val += x("industrie") * 0.6 + (x("fer") + x("bois")) * 0.5;
    val += x("recrues") * (0.4 + 0.4 * ai.pers.atf("aggr"));
    val *= SIZE_K().atf(gn.at("type"));
    if fx.getb("spec") && gn.getb("star") && R::SPECIALTY().has(gn.at("star").at(0)) {
        let sp = R::SPECIALTY().at(gn.at("star").at(0));
        let s = |k: &str| sp.get_or(k, 0).f();
        let boost = if sp.getb("boost") { g.mod_(code, sp.at("boost").s(), 0.0) } else { 0.0 };
        let kk = (1.0 + boost) * if gn.at("type") == "capitale" { R::SPECIALTY_CAPITAL } else { 1.0 };
        val += x("spec") * kk * (s("livres") + 0.4 * s("vivres") + 0.5 * (s("fer") + s("bois")) + 0.6 * s("industrie") + 0.4 * s("recrues"));
    }
    val *= mult;
    let t = gn.at("type");
    val += x("stab") * (if n.atf("stab") < 0.8 { 40.0 } else { 8.0 }) + x("grow") * 1.5;
    val += x("train") * (if t == "capitale" || t == "fort" { 3.0 } else { 1.0 })
        + if college_k(g, code) < COLLEGE_MAX { x("research") * 30.0 } else { 0.0 }; // (au-delà du plafond, un collège ne sert plus)
    val -= L.get_or("up", 0).f() - if lvl > 1 { levels.at(lvl - 2).get_or("up", 0).f() } else { 0.0 };
    val *= AI_TASTE().get_or(ai.pers.at("tech"), dict! {}).get_or(chain, 1.0).f();
    if chain == "marche" || chain == "quai" || chain == "specialite" {
        val *= 0.7 + 0.5 * ai.pers.atf("trade");
    }
    val
}

/// (SPEC-EMPIRE, module 4) Le premier bâtiment qu'exige le mélange d'armes de l'IA (ai::MIX, R::UNIT_REQ) et qu'aucune
/// de ses villes n'a ni n'a en chantier : (place, chaîne), dans son meilleur chef-lieu qui peut le bâtir (le chef-lieu,
/// sinon la ville la plus peuplée). Sans place libre, rien : l'IA lève alors de la ligne.
pub fn ai_besoin_mil(g: &Game, code: &str) -> Option<(i64, String)> {
    let villes: Vec<Val> = g
        .owned_nodes(code)
        .iter()
        .filter(|n| {
            let t = g.geo.nodes.at(n.at("id")).at("type");
            (t == "capitale" || t == "ville") && !n.atb("siege")
        })
        .collect();
    let villes = py::sorted_by_key(villes, |n| (g.geo.nodes.at(n.at("id")).at("type") != "capitale", -n.atf("pop")));
    let mut vus: Vec<Val> = vec![];
    for typ in crate::ai::MIX().get_or(code, list![]).iter() {
        let r = R::UNIT_REQ().get(&typ);
        if r.is_none() || vus.contains(&r) {
            continue;
        }
        vus.push(r.clone());
        let (chain, lvl) = r.pair();
        let a = |n: &Val| {
            niveau(n, chain.s()) >= lvl.i() || n.at("queue").iter().any(|q| q.at("kind") == "slot" && q.at("what") == chain)
        };
        if villes.iter().any(a) {
            continue;
        }
        if let Some(n) = villes.iter().find(|n| n.at("queue").len() < 2 && check(g, code, n, chain.s()).1.is_none()) {
            return Some((n.ati("id"), chain.string()));
        }
    }
    None
}

/// Bâtir ou améliorer un bâtiment d'emplacement, là où il rapporte le plus pour ce qu'il coûte.
/// Python : `ai_build(ai, budget, wars)`.
/// wars : la liste des camps en guerre (ai.wars()). Rend le budget restant.
/// `getattr(ai, '_ct_clock', 0)` : le champ `ai._ct_clock`.
/// Piège : `cands.sort(key=lambda c: -c[0])` est stable (py::sorted_by_key / Val::sort_by_key).
// game/cities.py, lignes 872 à 913
pub fn ai_build(g: &mut Game, ai: &mut AI, budget: f64, wars: &Val) -> f64 {
    let code = ai.code.clone();
    let mut budget = budget;
    if budget < 150.0 || g.t < ai._ct_clock {
        return budget;
    }
    ai._ct_clock = g.t + 12.0; // un coup d'œil sur les chantiers toutes les deux semaines environ
    // (SPEC-EMPIRE, module 4) d'abord le bâtiment qui manque au mélange d'armes de l'IA (haras, fonderie, école)
    let mut mil = 0;
    if let Some((nid, chain)) = ai_besoin_mil(g, &code) {
        let lvl = check(g, &code, &g.nodes.at(nid), &chain).0.unwrap();
        let cost = g.build_cost(&code, &CHAINS().at(&chain).at("levels").at(lvl - 1).at("cost"));
        if let Some(extra) = ai.provide(g, &cost, budget) {
            if slot_build(g, &code, nid, &chain).0 {
                budget -= cost.get_or("livres", 0).f() + extra;
                mil = 1;
            }
        }
    }
    let mut cands: Vec<(f64, Val, Val, Val, f64)> = vec![];
    for n in g.owned_nodes(&code).iter() {
        let gn = g.geo.nodes.at(n.at("id"));
        if n.atb("siege") || n.at("queue").len() >= 2 || (wars.truthy() && ai.threat_at(g, n.ati("id"), 45.0, &Val::None, &Val::None) > 0.0) {
            continue;
        }
        if gn.at("type") == "village" && !gn.atb("spec") {
            continue; // les simples villages gardent leur emplacement (un magasin aux vivres, en guerre)
        }
        let mut mult: Option<f64> = None;
        for chain in CHAIN_ORDER().iter() {
            if chain == "depot" || (gn.at("type") == "fort" && chain != "caserne") {
                continue; // le magasin aux vivres suit la guerre (AI.build_depot) ; une place forte loge des troupes
            }
            let (lvl, why) = check(g, &code, &n, chain.s());
            if why.is_some() {
                continue;
            }
            let lvl = lvl.unwrap();
            let m = match mult {
                Some(m) => m,
                None => {
                    let st = n.atf("stab");
                    let m = g.pop_factor(&n) * (if st > 0.3 { st } else { 0.3 }) * (0.7 + 0.3 * g.assim(&n));
                    mult = Some(m);
                    m
                }
            };
            let cost = g.build_cost(&code, &CHAINS().at(&chain).at("levels").at(lvl - 1).at("cost"));
            let price = py::sum_v(cost.items().into_iter().map(|(k, v)| &v * &(if k == "livres" { Val::from(1) } else { Val::from(1.6) }))).f();
            let val = _ai_value(g, ai, &n, chain.s(), lvl, m) * g.assim(&n);
            if val > 0.0 {
                cands.push((val / price, n.clone(), chain, cost, price));
            }
        }
    }
    let cands = py::sorted_by_key(cands, |c| -c.0);
    let mut built = mil;
    let slow = if ai.idle_money(g) > 0.0 { 1.0 / 4000.0 } else { 1.0 / 1500.0 }; // (un trésor qui dort attend dix ans, sinon quatre)
    for (ratio, n, chain, cost, _price) in cands {
        if built >= (if wars.truthy() { 1 } else { 2 }) || budget < 150.0 || ratio < slow {
            break; // au-delà de quatre ans pour se rembourser, on attend
        }
        let Some(extra) = ai.provide(g, &cost, budget) else {
            continue;
        };
        if slot_build(g, &code, n.ati("id"), chain.s()).0 {
            budget -= cost.get_or("livres", 0).f() + extra;
            built += 1;
            let st = stats(g).setdefault("bati", dict! {});
            st.set(code.as_str(), &st.get_or(code.as_str(), 0) + 1i64);
        }
    }
    budget
}

/// Place de négoce : port, quai, vignoble ou spécialité vendue au loin.
/// Python : `_trading(g, nid)`.
// game/cities.py, lignes 916 à 921
pub fn _trading(g: &Game, nid: i64) -> bool {
    let gn = g.geo.nodes.at(nid);
    let st = gn.get("star");
    let star = if st.truthy() { st.at(0) } else { Val::None };
    let b = R::SPECIALTY().get_or(&star, dict! {}).get("boost");
    gn.at("spec").has("port") || gn.at("spec").has("vin") || g.geo.ports.has(nid) || b == "port" || b == "vin"
}

/// Choisir l'orientation de chaque ville (les villages restent en équilibre), sans revenir sans cesse dessus.
/// Python : `ai_policies(ai)`.
// game/cities.py, lignes 924 à 954
pub fn ai_policies(g: &mut Game, ai: &mut AI) {
    let code = ai.code.clone();
    let f = g.factions.at(code.as_str()); // ai.f
    let wars = ai.wars(g);
    let viv = f.at("income").get_or("vivres", 0);
    let rec = f.at("res").at("recrues");
    for n in g.owned_nodes(&code).iter() {
        let gn = g.geo.nodes.at(n.at("id"));
        if gn.at("type") == "village" || n.atb("siege") {
            continue;
        }
        let p = n.get("pol");
        let cur = if p.truthy() && p.get("o") == code { p.at("k") } else { Val::from("equilibre") };
        if p.truthy() && p.get("o") == code && g.t - p.atf("t") < 240.0 {
            continue;
        }
        let o = R::NODE_BASE().at(gn.at("type"));
        let typ = gn.at("type");
        // on ne quitte une politique qu'une fois sa raison bien passée (pas d'allers-retours)
        let k = if n.atf("stab") < (if cur == "fetes" { 0.75 } else { 0.6 }) {
            "fetes"
        } else if wars.truthy() && rec < (if cur == "recrutement" { 800i64 } else { 400 }) && (typ == "capitale" || typ == "ville") {
            "recrutement"
        } else if wars.truthy() && (typ == "fort" || ai.threat_at(g, n.ati("id"), 40.0, &Val::None, &Val::None) > 0.0) {
            "armes"
        } else if (viv < (if cur == "grenier" { 15i64 } else { 0 }) || f.getb("famine")) && (o.at("vivres") >= 1.3 || gn.at("spec").has("ble")) {
            "grenier"
        } else if _trading(g, n.ati("id")) && ai.pers.atf("trade") >= 0.5 {
            "commerce" // les places de négoce des camps marchands
        } else {
            "equilibre"
        };
        if _set_policy(g, &n, k) {
            let st = stats(g).setdefault("pol", dict! {});
            st.set(k, &st.get_or(k, 0) + 1i64);
        }
    }
}

// ------------------------------------------------------------------ vues et sauvegardes

/// Anciennes sauvegardes : le magasin aux vivres existant occupe un emplacement.
/// Python : `migrate(g)`.
// game/cities.py, lignes 958 à 961
pub fn migrate(g: &mut Game) {
    for n in g.nodes.iter() {
        slots(&n);
    }
}

/// (SPEC-EMPIRE, module 4) Emplacements d'une place pour l'écran : `slots` {chaîne: niveau}, `slot_max`, et les chaînes
/// qui ont leur place ici, `chains` : [{id, nom, niveau, max, possible, raison, cout, tours, bat}] (cout et tours : le
/// prochain niveau, null au niveau maximal ; tours en fraction de tour ; bat : clé web_engine du niveau bâti, ou du
/// premier niveau s'il n'y a encore rien).
pub fn chains_view(g: &Game, n: &Val) -> Val {
    let (nid, code) = (n.ati("id"), n.ats("owner"));
    let s = slots(n);
    let l = list![];
    if !g.factions.has(code.as_str()) {
        return dict! {"slots" => s.copy(), "slot_max" => slot_count(g, n), "chains" => l}; // (place neutre : rien à bâtir)
    }
    for chain in CHAIN_ORDER().iter() {
        let c = chain.s();
        if !fits(g, nid, c) {
            continue;
        }
        let levels = CHAINS().at(c).at("levels");
        let niveau = s.get_or(c, 0).i();
        let (lvl, why) = check(g, &code, n, c);
        let next = lvl.unwrap_or(niveau + 1);
        let (cout, tours) = if next <= levels.len() as i64 {
            let L = levels.at(next - 1);
            (g.build_cost(&code, &L.at("cost")), Val::from(py::round_n(g.build_days(&code, L.atf("days")) / TT::TOUR_DAYS, 2)))
        } else {
            (Val::None, Val::None)
        };
        l.push(dict! {"id" => c, "nom" => CHAINS().at(c).at("name"), "niveau" => niveau, "max" => levels.len(),
                      "possible" => why.is_none(), "raison" => Val::from(why), "cout" => cout, "tours" => tours,
                      "bat" => bat_de(g, nid, c, niveau)});
    }
    dict! {"slots" => s.copy(), "slot_max" => slot_count(g, n), "chains" => l}
}

/// Ce que le joueur voit de ses propres places : emplacements, politique, effets d'événements.
/// Python : `node_view(g, n)`.
// game/cities.py, lignes 964 à 978
pub fn node_view(g: &Game, n: &Val) -> Val {
    let sl: Val = slots(n).items().into_iter().map(|(k, v)| list![k, v]).collect();
    let d = dict! {"sl" => sl, "sn" => slot_count(g, n)};
    d.update(&chains_view(g, n)); // (SPEC-EMPIRE, module 4)
    let p = n.get("pol");
    if p.truthy() && p.get("o") == n.at("owner") && (p.at("k") != "equilibre" || policy_w(g, n) < 1.0) {
        let u = p.get("u");
        let u = if u.truthy() { u.f() } else { TT::turn_start_after(g, p.atf("t") + POLICY_OLD_DAYS as f64) };
        d.set("pol", list![p.at("k"), p.get_or("p", "equilibre"), py::round_n(policy_w(g, n), 2), TT::tours_left(g, u)]);
    }
    let tm0 = n.get("tm");
    let tm: Vec<Val> = (if tm0.truthy() { tm0 } else { list![] }).iter().filter(|e| e.atf("until") > g.t).collect();
    if !tm.is_empty() || n.getb("bo") {
        let l = list![];
        for e in &tm {
            l.push(format!("{} {} jusqu'au {}", TM_LABEL().get_or(e.at("k"), e.at("k")), _pct(e.atf("v")), g.date_str(&e.at("until"))));
        }
        let bo = n.get("bo");
        for (k, x) in (if bo.truthy() { bo } else { dict! {} }).items() {
            l.push(format!(
                "+{} {} {} ({})",
                _n(x.f() * per_k(g)),
                R::RES_LABEL().get_or(&k, &k).s().to_lowercase(),
                per_txt(g),
                if k == "fer" { "filon" } else { "durable" }
            ));
        }
        d.set("tm", l);
    }
    if g.pending_ev.iter().any(|p| p.get("kind") == "ville" && p.get("town") == n.at("id")) {
        d.set("ev", 1);
    }
    d
}

/// Python : `rules_payload()`.
// game/cities.py, lignes 981 à 991
pub fn rules_payload() -> Val {
    let chains = dict! {};
    for (k, c) in CHAINS().items() {
        let levels: Val = c
            .at("levels")
            .iter()
            .map(|L| {
                dict! {
                    "name" => L.at("name"), "cost" => L.at("cost"), "days" => L.at("days"), "dev" => L.get_or("dev", 0),
                    "tech" => L.get("tech"), "up" => L.get_or("up", 0), "txt" => fx_text(&L.at("fx"), &Val::None, false),
                    "txtj" => fx_text(&L.at("fx"), &Val::None, true), "bat" => L.get("bat")
                }
            })
            .collect();
        chains.set(&k, dict! {"name" => c.at("name"), "icon" => c.at("icon"), "desc" => c.at("desc"), "where" => c.get("where"), "levels" => levels});
    }
    let spec_names = Val::dict_from(SPEC_NAMES().items().into_iter().map(|(k, v)| (k, dict! {"names" => v.at(0), "tech" => v.at(1)})).collect());
    let policies = Val::dict_from(
        POLICIES().items().into_iter().map(|(k, p)| (k, dict! {"label" => p.at("label"), "pro" => p.at("pro"), "con" => p.at("con")})).collect(),
    );
    let tech_names = Val::dict_from(R::TECH().values().into_iter().map(|t| (t.at("id"), t.at("name"))).collect());
    dict! {
        "slots" => SLOTS(), "size_k" => SIZE_K(), "chains" => chains, "order" => CHAIN_ORDER(), "spec_names" => spec_names,
        "policies" => policies, "policy_order" => POLICY_ORDER(), "tech_names" => tech_names
    }
}
