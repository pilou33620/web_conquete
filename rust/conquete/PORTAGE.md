# Portage du moteur Python en Rust

Le jeu était écrit en Python (`server.py`, `game/`, `game/tactics/`). Il est porté en Rust, comme les outils de
WEB·SUITE : plus de Python à installer, un seul exécutable, et un moteur bien plus rapide (la carte se prépare en
quelques secondes au lieu d'une minute et demie sur un petit poste).

**Le portage est fidèle au bit près.** À la même graine, le Rust rend la même carte, le même champ de bataille, la
même bataille et le même tour de campagne que le Python. Ce n'est pas un luxe :

- une sauvegarde ne garde pas ses cartes, elle les refait de leur graine : une carte différente casserait la partie ;
- c'est le seul moyen de vérifier 25 000 lignes : chaque module est comparé à son **jumeau Python**, qui écrit des
  **références** (`tests/references/`) que les essais Rust doivent retrouver exactement.

Le Python reste dans le dépôt tant que tout n'est pas porté et vérifié ; il est retiré à la fin, les références
restent.

## Où sont les choses

| Python | Rust |
|---|---|
| `game/x.py` | `rust/conquete/src/x.rs` (même nom) |
| `game/tactics/x.py` | `rust/conquete/src/tactics/x.rs` |
| `server.py`, `appairage.py` | `rust/conquete/src/serveur.rs` + la caisse commune `web_tools_commun` (dépôt web_suite) |
| ce que Python faisait tout seul | `rust/conquete/src/py/` (le **socle**) |
| jumeaux (provisoires) | `outils/jumeau/*.py` |
| références | `rust/conquete/tests/references/` |

## Règle d'or : traduire, ne pas réécrire

- Un module Rust par fichier Python, **les mêmes noms** (fonctions, constantes, clés des dict), **dans le même ordre**.
  On doit pouvoir lire les deux côte à côte. Pas de refonte, pas d'« amélioration », pas de correction de bogue en
  passant : un bogue du Python se porte tel quel et se signale dans le compte rendu.
- **Les commentaires se portent aussi** (en français, tels quels) : ils disent le pourquoi des règles du jeu.
- Chaque module commence par un `//!` qui dit ce qu'il porte.
- Ce qui manque au socle : l'ajouter dans son propre module (fonction privée) et le signaler ; ne pas modifier
  `src/py/` (plusieurs portages avancent en même temps).

## Les types

| Python | Rust |
|---|---|
| dict, list, tuple, set qui tiennent des données du jeu (armée, ville, camp, régiment, ordre, vue JSON…) | `py::Val` (`dict!{}`, `list![]`, `tup![]`, `pyset![]`) |
| classe (`Game`, `GeoMap`, `TacticalBattle`, `BattleMap`…) | `struct` du même nom, mêmes attributs ; `impl` avec les mêmes méthodes |
| attribut d'une classe | champ typé quand son type est sûr (`f64`, `i64`, `bool`, `String`, `Vec<u8>`…), sinon `Val` |
| `bytearray` / `bytes` | `Vec<u8>` |
| `array('f')` | `Vec<f32>` : **la valeur est arrondie en f32 à l'écriture** (`x as f32`) et relue en `f64` (`v as f64`), comme en Python |
| `array('H')`, `array('i')`, `array('d')`… | `Vec<u16>`, `Vec<i32>`, `Vec<f64>`… |
| nombre local d'un calcul | `f64` ou `i64` natifs (surtout dans les boucles : pas de `Val` dans un calcul de grille) |
| constante de module, nombre ou texte | `pub const NOM: f64 / i64 / &str` (un `int` de Python reste `i64`, un `float` reste `f64`) |
| constante de module, dict / liste / tuple / set | `py_const!(NOM, …);` puis `NOM()` ; ou un tableau natif (`pub const X: [(f64, f64); 8]`) si elle n'est faite que de nombres et sert dans des calculs |
| `None` possible | `Val` (`Val::None`), ou `Option<T>` pour un champ typé |
| fonction qui rend plusieurs valeurs | un tuple Rust (`(bool, String)`) |
| `import x as R` | `use crate::x as R;` puis `R::UNITS()`, `R::REPL_ARMES` |

`Val` est une **référence partagée**, comme en Python : `let a = g.armies.at(id);` puis `a.set("qrt", true)` modifie
l'armée du jeu. `clone()` ne copie pas l'objet (`copy()` et `deepcopy()` le font). Aucun emprunt ne dure : on peut
modifier pendant qu'on parcourt (`for r in a.at("regs").iter()` parcourt une copie de la liste prise à l'instant).

L'essentiel de `Val` (tout est dans `src/py/val.rs`) :

```rust
a.at("regs")            // a['regs']            (KeyError / IndexError : arrêt avec le message de Python)
a.get("qrt")            // a.get('qrt')         (Val::None si absent)
a.get_or("xp", 0)       // a.get('xp', 0)
a.set("qrt", true)      // a['qrt'] = True
a.inc("n", 5) / dec / scale     // a['n'] += 5, -=, *=
a.has("gen")            // 'gen' in a   (élément d'une liste, d'un set, morceau d'un texte aussi)
a.pop("rg") / a.del("rg") / a.setdefault("k", list![]) / a.update(&autre)
l.push(x) / l.extend(&m) / l.insert(i, x) / l.remove(&x) / l.pop_last() / l.pop(0) / l.index_of(&x)
l.sort_by_key(|r| r.at("n").f()) / l.slice(Some(1), None) / l.len() / l.at(-1)
d.items() / d.keys() / d.values() / v.iter() / v.pair() / v.triple() / v.xy()
u.atf("x")  u.ati("id")  u.ats("name")  u.atb("seen")  a.getb("qrt")   // u['x'] en f64, i64, String, bool ; bool(a.get('qrt'))
v.f()  v.i()  v.s()  v.truthy()  v.is_none()  v.or(defaut)      // float, int, &str, « if v », « v or defaut »
&a + &b, &a * 2.0, a / b, a.floordiv(b), a % b                  // les règles de Python (int + float = float, / rend un float)
v == "texte", v == 3, v < 2.5, v.is(&w)                         // ==, <, is
format!("{v}") = str(v) ; v.repr() = repr(v)
```

## Ce qui doit être identique au bit près (les pièges)

Un seul écart d'un dernier bit, ou un tirage de plus, et toute la suite de la partie diverge.

1. **L'ordre des tirages du hasard.** `py::Random` rend les mêmes nombres que `random.Random` ; encore faut-il
   tirer dans le même ordre : attention aux `and` / `or` (le second terme n'est évalué que s'il le faut), aux
   compréhensions (l'ordre de parcours), aux arguments (de gauche à droite), aux `if` qui tirent ou non.
   `rng.choice(l)` → `l[rng.choice_i(n)]` ou `rng.choice(&vec)` ; `rng.randrange(a, b)` → `randrange2` ;
   `rng.choices(pop, weights=w)[0]` → `choix_pondere` ; `random.Random("texte")` → `Random::new_str`.
2. **L'ordre des opérations flottantes.** `a + b + c` reste `(a + b) + c` ; ne pas factoriser, ne pas réordonner,
   ne pas remplacer `x / 3` par `x * (1.0 / 3.0)`, ni `a * b + c` par `mul_add`.
3. `sum(...)` → `py::sum` (flottants) ou `py::sum_v` (valeurs) : la somme de Python est compensée, un `fold` ne
   rend pas le même dernier bit. Une addition en boucle (`s += x`) reste une boucle.
4. `math.hypot` → `py::hypot` ; `math.dist` → `py::dist` (la libm rend parfois le flottant voisin).
5. `x ** y` entre flottants → `py::pow(x, y)`, **même pour `x ** 2` et `x ** 0.5`** (`x * x` et `sqrt` diffèrent
   une fois sur mille) ; `math.sqrt` → `.sqrt()` ; entiers : `py::pow_i`.
6. `round(x)` → `py::round` (moitiés au pair, rend un entier) ; `round(x, n)` → `py::round_n` ; `int(x)` →
   `py::int` (vers zéro) ; `//` et `%` → `py::floordiv_i`, `mod_i`, `floordiv_f`, `mod_f` (vers −∞, signe du
   diviseur) ; `/` rend toujours un flottant, même entre entiers (`3 / 2 = 1.5`).
7. `min(…)` / `max(…)` avec ou sans `key` → `py::min_by_key` / `py::max_by_key` : **le premier gagne** en cas
   d'égalité (le `max_by` de Rust rend le dernier). `min(a, b)` simple : `if b < a { b } else { a }`.
8. `sorted` / `.sort()` sont stables : `py::sorted_by_key`, `Val::sort_by_key`. Avec `reverse=True`, les égaux
   gardent leur ordre : `py::sorted_by_key_rev` (jamais trier puis retourner).
9. `heapq` → `py::heapq` (mêmes échanges : l'ordre de sortie des égaux en dépend).
10. `math.sin`, `cos`, `atan2`, `exp`, `log`… → les méthodes de `f64` (la même libm que Python sur ce poste).
    `game/tactics/jsmath.py` (l'arithmétique du navigateur) se porte opération par opération.
11. **Les entiers de Python n'ont pas de borne.** Un hachage qui multiplie puis masque (`& 0xFFFFFFFF`) peut
    dépasser 64 bits en chemin : calculer en `i128` / `u128`, ou en `wrapping_mul` quand seuls les bits bas sont
    gardés ensuite (et alors seulement).
12. **1 n'est pas 1.0** dans un texte (`f"{x}"` écrit « 5 » ou « 5.0 ») : garder le type de Python pour tout ce qui
    finit dans un message. Les références, elles, tiennent 5 et 5.0 pour égaux.
13. **Parcourir un `set`.** L'ordre d'un set d'entiers de CPython n'est ni l'ordre d'insertion ni l'ordre trié.
    Si le Python parcourt un set et que l'ordre peut changer le résultat (somme de flottants, premier trouvé,
    tirage au hasard, liste rendue), **le signaler dans le compte rendu** avec la ligne ; un set de textes est
    déjà parcouru dans un ordre qui change d'un lancement à l'autre en Python (rien à reproduire).
14. Un dict garde l'ordre d'insertion (`Val` aussi, y compris après un `pop`).
15. `f"{x:.1f}"` → `format!("{:.1}", x)` (même arrondi) ; `{n:02d}` → `{:02}` ; `{x:+.0f}` → `{:+.0}` ;
    `{x:,}` → `py::milliers` ; `str(float)` → `py::repr_f` ; `s.capitalize()` → `py::capitalize`.
16. `json.load` → `py::json::loads` ; `json.dumps(o, separators=(',', ':'), ensure_ascii=False)` →
    `py::json::dumps_compact` ; un flottant relu est celui qui a été écrit.

## Les deux grands ensembles : la bataille et la campagne

Leurs fichiers s'appellent les uns les autres dans tous les sens. Ils se portent en deux temps : d'abord le
**squelette** (constantes, structs, et la signature de chaque fonction avec un corps `todo!()`), qui compile ; puis
les **corps**, à plusieurs en parallèle, chacun dans ses fichiers. Une signature du squelette ne se change pas sans
le signaler : d'autres l'appellent déjà.

Conventions communes aux deux ensembles :

- **Les objets du jeu restent des `Val`** : une unité tactique (`Unit`, classe à `__slots__` en Python) est un dict
  dont les clés sont ses attributs (`u.x` → `u.atf("x")`, `u.state == 'deroute'` → `u.at("state") == "deroute"`,
  `u.men -= p` → `u.dec("men", p)`) ; armées, villes, camps, régiments, ordres, mémoire de l'IA sont déjà des dict.
  Les méthodes et propriétés d'`Unit` deviennent des fonctions de `units.rs` : `U::alive(&u)`, `U::valid(&u)`,
  `U::size(&u)`, `U::view(&u, …)`, et `U::Unit(&kw)` la construit.
- **`Game` et `TacticalBattle` sont des structs**, passés en `&mut` : `g: &mut Game`, `b: &mut TacticalBattle`.
  Leurs attributs sont des champs du même nom : `f64`, `i64`, `bool`, `String` quand c'est un simple nombre ou
  texte jamais `None` ; **`Val` pour tout conteneur et pour tout ce qui peut valoir `None`** ; `Vec<u8>`,
  `Vec<f32>`… pour les grilles ; `Random` pour un hasard ; `Rc<GeoMap>` pour la carte (partagée).
  Deux attributs qui désignent le même objet en Python (`self.t = self.map.t`) n'en font qu'un en Rust : on écrit
  `self.map.t`.
- Les méthodes gardent leur nom dans `impl` ; `&mut self` sauf lecture pure évidente.
- **Types des paramètres** : positions, angles, durées, facteurs → `f64` ; numéros, rangs, camps (0 / 1), cases →
  `i64` ; drapeaux → `bool` ; codes et sortes (`code`, `kind`, `typ`) → `&str` ; tout objet du jeu, toute liste,
  tout dict, et **tout paramètre qui peut recevoir `None`** → `&Val`. Un paramètre à valeur par défaut reste un
  paramètre (Rust n'a pas de défaut) : le commentaire de la fonction dit sa valeur par défaut, l'appelant la passe.
  Une suite de paramètres optionnels nommés (`**kw`, ou plus de trois défauts rarement donnés) → un `kw: &Val`
  (dict) dont le commentaire liste les clés.
- **Retours** : un type natif s'il est sûr, un tuple Rust pour plusieurs valeurs, `Val` pour un objet du jeu, une
  collection ou ce qui peut être `None`.
- Un objet qui en contient un autre et l'appelle en retour (`g.ais[code]` qui agit sur `g`, `g.tactical` que le
  pont fait avancer avec `g`) : on le **sort** de son champ le temps de l'appel (`let mut tb = g.tactical.take()…`)
  puis on le remet.
- Un gros fichier Python se découpe en parties, dans l'ordre du Python : `battle/mod.rs` (constantes, struct,
  création) puis `battle/<partie>.rs`, chacune avec son `impl`. L'en-tête de chaque partie dit les lignes du
  Python qu'elle porte. Chaque partie est remplie par une seule personne.

## Erreurs

- Une exception de programmation de Python (KeyError, IndexError, TypeError) : `panic!` (le socle le fait avec le
  même message). On ne les rattrape pas plus que le Python.
- Un `try / except` du Python se porte : `Result`, ou un test avant l'accès.
- `return False, "message"` → `(false, "message".to_string())`.

## Jumeau et références : comment vérifier un module

1. Écrire `outils/jumeau/<module>_ref.py` : il importe `commun` (ce dossier), fait tourner le module Python sur
   des cas choisis (plusieurs graines, les cas limites, toutes les fonctions publiques) et range ce qu'il obtient
   avec `commun.ecrire('<module>', ref)` → `rust/conquete/tests/references/<module>.json`.
2. Écrire les essais Rust (`rust/conquete/tests/<module>.rs`, ou un `mod essais` dans le module) : ils relisent la
   référence (`py::json::loads`) et comparent **exactement** (`f64::to_bits`, ou `py::json::dumps_ref` des deux
   côtés).
3. Une sortie volumineuse (une carte, un état de partie) ne va pas dans le dépôt : y ranger son **empreinte**
   (`commun.empreinte(o)` = `py::json::empreinte(&v)`), plus quelques valeurs lisibles. Une référence : 1 Mo au plus.
   Pour chercher un écart, le jumeau et un essai peuvent écrire la forme complète (`commun.canon` /
   `dumps_ref`) dans un dossier temporaire et on compare les deux textes.
   Préférer la forme **ordonnée** (`commun.canon_ordre` / `empreinte_ordre` = `dumps_ref_ordre` /
   `empreinte_ordre`) : elle vérifie aussi l'ordre des clés des dict, qu'une boucle suit.
4. Hasard : `commun.tracer_hasard(fichier)` côté Python, `CONQUETE_TRACE_HASARD=fichier` côté Rust ; le premier
   tirage qui diffère (valeur, ou tirage en trop) donne la ligne des deux côtés.
5. Lancer : `cargo test -p conquete` (depuis la racine du dépôt).

Tous les modules existent déjà, vides (`//! À porter : …`), et sont déclarés dans `lib.rs` et `tactics/mod.rs` :
on remplit le sien sans toucher aux autres.

Un module n'est porté que lorsque ses essais passent contre les références du jumeau.

## Porter les corps (bataille, campagne)

Le squelette est en place : chaque fonction a sa signature, son commentaire, la signature Python d'origine et ses
lignes, et un corps `todo!()`. Porter un corps :

- Remplacer le `todo!()` par la traduction ligne à ligne du corps Python (règles et pièges plus haut). Les notes de
  pièges de l'en-tête du fichier et du commentaire de la fonction sont à lire avant.
- **Ne pas changer une signature** d'un autre fichier que les siens. Si c'est vraiment nécessaire (le Python ne
  peut pas s'écrire autrement), faire le plus petit changement, corriger ses appelants, et le signaler.
- On appelle librement les fonctions des autres parties, même encore en `todo!()` : elles seront portées en
  parallèle. On compile (`cargo check -p conquete`) ; on ne peut pas encore tout exécuter.
- **Vérifier ce qui peut l'être tout de suite** : une fonction qui ne dépend que de son entrée (calcul, texte,
  table) se compare au Python par un petit jumeau, comme les modules feuilles. Le reste sera vérifié de bout en
  bout (batailles et campagnes entières rejouées à la même graine, état comparé pas à pas) une fois tout porté.
- À la fin d'une part, **plus aucun `todo!()`** dans ses fichiers, et `cargo test -p conquete` passe.
