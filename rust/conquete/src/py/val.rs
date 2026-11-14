//! Une valeur de Python : None, bool, int, float, str, list, tuple, dict, set. Le moteur du jeu tenait ses
//! armées, ses villes et ses camps dans des dict partagés (la même armée est vue par la carte, par la bataille,
//! par l'IA) : `Val` garde ce partage (une liste ou un dict copié par `clone()` est LE MÊME objet, comme une
//! référence de Python) et la différence entre 1 et 1.0, que les textes et les sauvegardes laissent voir.
//!
//! Aucun emprunt ne dure : chaque accès (`at`, `get`, `set`…) emprunte l'objet le temps de l'appel et rend une
//! valeur à soi. On peut donc modifier un dict pendant qu'on parcourt une copie de sa liste, comme en Python.

use indexmap::{Equivalent, IndexMap, IndexSet};
use std::cell::RefCell;
use std::cmp::Ordering;
use std::fmt;
use std::hash::{Hash, Hasher};
use std::rc::Rc;

pub type Liste = Rc<RefCell<Vec<Val>>>;
pub type Dico = Rc<RefCell<IndexMap<Val, Val>>>;
pub type Ens = Rc<RefCell<IndexSet<Val>>>;

#[derive(Clone, Default)]
pub enum Val {
    #[default]
    None,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(Rc<str>),
    List(Liste),
    Tuple(Rc<Vec<Val>>),
    Dict(Dico),
    /// Un set : parcouru dans l'ordre d'insertion (celui de CPython dépend de la table : voir PORTAGE.md).
    Set(Ens),
}

// ------------------------------------------------------------------ construire
impl Val {
    pub fn list(v: Vec<Val>) -> Val {
        Val::List(Rc::new(RefCell::new(v)))
    }
    pub fn tuple(v: Vec<Val>) -> Val {
        Val::Tuple(Rc::new(v))
    }
    pub fn dict() -> Val {
        Val::Dict(Rc::new(RefCell::new(IndexMap::new())))
    }
    pub fn dict_from(paires: Vec<(Val, Val)>) -> Val {
        Val::Dict(Rc::new(RefCell::new(paires.into_iter().collect())))
    }
    pub fn new_set() -> Val {
        Val::Set(Rc::new(RefCell::new(IndexSet::new())))
    }
    pub fn set_from(v: Vec<Val>) -> Val {
        Val::Set(Rc::new(RefCell::new(v.into_iter().collect())))
    }
    pub fn str(s: &str) -> Val {
        Val::Str(Rc::from(s))
    }
}

macro_rules! depuis {
    ($($t:ty => |$x:ident| $e:expr),* $(,)?) => { $(impl From<$t> for Val { fn from($x: $t) -> Val { $e } })* };
}
depuis! {
    bool => |x| Val::Bool(x), i64 => |x| Val::Int(x), i32 => |x| Val::Int(x as i64), u8 => |x| Val::Int(x as i64),
    u32 => |x| Val::Int(x as i64), usize => |x| Val::Int(x as i64), f64 => |x| Val::Float(x),
    &str => |x| Val::Str(Rc::from(x)), String => |x| Val::Str(Rc::from(x)), &String => |x| Val::Str(Rc::from(x.as_str())),
    Rc<str> => |x| Val::Str(x), &Val => |x| x.clone(), Vec<Val> => |x| Val::list(x),
}
impl<T: Into<Val>> From<Option<T>> for Val {
    fn from(x: Option<T>) -> Val {
        x.map_or(Val::None, Into::into)
    }
}
impl<A: Into<Val>, B: Into<Val>> From<(A, B)> for Val {
    fn from(x: (A, B)) -> Val {
        Val::tuple(vec![x.0.into(), x.1.into()])
    }
}
impl<A: Into<Val>, B: Into<Val>, C: Into<Val>> From<(A, B, C)> for Val {
    fn from(x: (A, B, C)) -> Val {
        Val::tuple(vec![x.0.into(), x.1.into(), x.2.into()])
    }
}
impl FromIterator<Val> for Val {
    fn from_iter<I: IntoIterator<Item = Val>>(it: I) -> Val {
        Val::list(it.into_iter().collect())
    }
}

/// `list![a, b]` : une liste de Python (chaque élément passe par `Val::from`).
#[macro_export]
macro_rules! list {
    ($($x:expr),* $(,)?) => { $crate::py::Val::list(vec![$($crate::py::Val::from($x)),*]) };
}
/// `tup![a, b]` : un tuple.
#[macro_export]
macro_rules! tup {
    ($($x:expr),* $(,)?) => { $crate::py::Val::tuple(vec![$($crate::py::Val::from($x)),*]) };
}
/// `dict!{"cle" => valeur, …}` : un dict, dans l'ordre écrit.
#[macro_export]
macro_rules! dict {
    ($($k:expr => $v:expr),* $(,)?) => {
        $crate::py::Val::dict_from(vec![$(($crate::py::Val::from($k), $crate::py::Val::from($v))),*])
    };
}
/// `pyset![a, b]` : un set.
#[macro_export]
macro_rules! pyset {
    ($($x:expr),* $(,)?) => { $crate::py::Val::set_from(vec![$($crate::py::Val::from($x)),*]) };
}

// ------------------------------------------------------------------ clés
#[derive(Clone, Copy, PartialEq)]
pub enum Num {
    I(i64),
    F(f64),
}
impl Num {
    pub fn f(self) -> f64 {
        match self {
            Num::I(i) => i as f64,
            Num::F(f) => f,
        }
    }
}

fn hacher_num<H: Hasher>(n: Num, h: &mut H) {
    // 1, 1.0 et True sont la même clé, comme en Python
    match n {
        Num::F(f) if f.fract() != 0.0 || f.abs() >= 9.2e18 || f.is_nan() => {
            2u8.hash(h);
            f.to_bits().hash(h)
        }
        n => {
            1u8.hash(h);
            (match n {
                Num::I(i) => i,
                Num::F(f) => f as i64,
            })
            .hash(h)
        }
    }
}
fn hacher_str<H: Hasher>(s: &str, h: &mut H) {
    3u8.hash(h);
    s.hash(h)
}

impl Hash for Val {
    fn hash<H: Hasher>(&self, h: &mut H) {
        match self {
            Val::None => 0u8.hash(h),
            Val::Str(s) => hacher_str(s, h),
            Val::Tuple(t) => {
                4u8.hash(h);
                t.len().hash(h);
                for x in t.iter() {
                    x.hash(h)
                }
            }
            Val::Bool(_) | Val::Int(_) | Val::Float(_) => hacher_num(self.num().unwrap(), h),
            _ => panic!("TypeError: unhashable type: '{}'", self.type_name()),
        }
    }
}

/// Une clé de dict ou un indice de liste : `&str`, entier, ou une `Val`.
pub trait Cle {
    fn dans<'a>(&self, m: &'a IndexMap<Val, Val>) -> Option<&'a Val>;
    fn val(&self) -> Val;
    fn indice(&self) -> Option<i64>;
}
struct CleStr<'a>(&'a str);
impl Hash for CleStr<'_> {
    fn hash<H: Hasher>(&self, h: &mut H) {
        hacher_str(self.0, h)
    }
}
impl Equivalent<Val> for CleStr<'_> {
    fn equivalent(&self, k: &Val) -> bool {
        matches!(k, Val::Str(s) if &**s == self.0)
    }
}
impl Cle for &str {
    fn dans<'a>(&self, m: &'a IndexMap<Val, Val>) -> Option<&'a Val> {
        m.get(&CleStr(self))
    }
    fn val(&self) -> Val {
        Val::str(self)
    }
    fn indice(&self) -> Option<i64> {
        None
    }
}
impl Cle for &String {
    fn dans<'a>(&self, m: &'a IndexMap<Val, Val>) -> Option<&'a Val> {
        m.get(&CleStr(self))
    }
    fn val(&self) -> Val {
        Val::str(self)
    }
    fn indice(&self) -> Option<i64> {
        None
    }
}
impl Cle for String {
    fn dans<'a>(&self, m: &'a IndexMap<Val, Val>) -> Option<&'a Val> {
        m.get(&CleStr(self))
    }
    fn val(&self) -> Val {
        Val::str(self)
    }
    fn indice(&self) -> Option<i64> {
        None
    }
}
macro_rules! cle_entiere {
    ($($t:ty),*) => { $(impl Cle for $t {
        fn dans<'a>(&self, m: &'a IndexMap<Val, Val>) -> Option<&'a Val> { m.get(&Val::Int(*self as i64)) }
        fn val(&self) -> Val { Val::Int(*self as i64) }
        fn indice(&self) -> Option<i64> { Some(*self as i64) }
    })* };
}
cle_entiere!(i64, i32, usize);
impl Cle for &Val {
    fn dans<'a>(&self, m: &'a IndexMap<Val, Val>) -> Option<&'a Val> {
        m.get(*self)
    }
    fn val(&self) -> Val {
        (*self).clone()
    }
    fn indice(&self) -> Option<i64> {
        match self {
            Val::Int(i) => Some(*i),
            Val::Bool(b) => Some(*b as i64),
            _ => None,
        }
    }
}
impl Cle for Val {
    fn dans<'a>(&self, m: &'a IndexMap<Val, Val>) -> Option<&'a Val> {
        m.get(self)
    }
    fn val(&self) -> Val {
        self.clone()
    }
    fn indice(&self) -> Option<i64> {
        (&self).indice()
    }
}

/// L'indice d'une séquence de longueur n : les négatifs partent de la fin.
fn rang(i: i64, n: usize) -> Option<usize> {
    let j = if i < 0 { i + n as i64 } else { i };
    (j >= 0 && (j as usize) < n).then_some(j as usize)
}

// ------------------------------------------------------------------ lire
impl Val {
    pub fn type_name(&self) -> &'static str {
        match self {
            Val::None => "NoneType",
            Val::Bool(_) => "bool",
            Val::Int(_) => "int",
            Val::Float(_) => "float",
            Val::Str(_) => "str",
            Val::List(_) => "list",
            Val::Tuple(_) => "tuple",
            Val::Dict(_) => "dict",
            Val::Set(_) => "set",
        }
    }
    pub fn is_none(&self) -> bool {
        matches!(self, Val::None)
    }
    pub fn is_some(&self) -> bool {
        !self.is_none()
    }
    pub fn is_num(&self) -> bool {
        matches!(self, Val::Int(_) | Val::Float(_) | Val::Bool(_))
    }
    pub fn is_int(&self) -> bool {
        matches!(self, Val::Int(_) | Val::Bool(_))
    }
    pub fn is_float(&self) -> bool {
        matches!(self, Val::Float(_))
    }
    pub fn is_str(&self) -> bool {
        matches!(self, Val::Str(_))
    }
    pub fn is_list(&self) -> bool {
        matches!(self, Val::List(_))
    }
    pub fn is_tuple(&self) -> bool {
        matches!(self, Val::Tuple(_))
    }
    pub fn is_dict(&self) -> bool {
        matches!(self, Val::Dict(_))
    }
    /// `a is b` : le même objet (ou la même valeur simple).
    pub fn is(&self, o: &Val) -> bool {
        match (self, o) {
            (Val::List(a), Val::List(b)) => Rc::ptr_eq(a, b),
            (Val::Dict(a), Val::Dict(b)) => Rc::ptr_eq(a, b),
            (Val::Set(a), Val::Set(b)) => Rc::ptr_eq(a, b),
            (Val::Tuple(a), Val::Tuple(b)) => Rc::ptr_eq(a, b),
            (Val::Int(a), Val::Int(b)) => a == b,
            (Val::Bool(a), Val::Bool(b)) => a == b,
            (Val::Float(a), Val::Float(b)) => a.to_bits() == b.to_bits(),
            (Val::Str(a), Val::Str(b)) => a == b,
            (Val::None, Val::None) => true,
            _ => false,
        }
    }
    pub fn num(&self) -> Option<Num> {
        match self {
            Val::Int(i) => Some(Num::I(*i)),
            Val::Float(f) => Some(Num::F(*f)),
            Val::Bool(b) => Some(Num::I(*b as i64)),
            _ => None,
        }
    }
    /// Le nombre, en flottant (int, float ou bool).
    #[track_caller]
    pub fn f(&self) -> f64 {
        match self.num() {
            Some(n) => n.f(),
            None => panic!("TypeError: un nombre était attendu, pas {} ({})", self.type_name(), self.repr()),
        }
    }
    /// L'entier (int ou bool). Un float est refusé, comme pour un indice en Python : `py::int` le tronque.
    #[track_caller]
    pub fn i(&self) -> i64 {
        match self {
            Val::Int(i) => *i,
            Val::Bool(b) => *b as i64,
            _ => panic!("TypeError: un entier était attendu, pas {} ({})", self.type_name(), self.repr()),
        }
    }
    #[track_caller]
    pub fn u(&self) -> usize {
        self.i() as usize
    }
    #[track_caller]
    pub fn s(&self) -> &str {
        match self {
            Val::Str(s) => s,
            _ => panic!("TypeError: un texte était attendu, pas {} ({})", self.type_name(), self.repr()),
        }
    }
    /// Le texte en propre (pour le garder au-delà de la valeur).
    #[track_caller]
    pub fn string(&self) -> String {
        self.s().to_string()
    }
    /// La véracité de Python : faux pour None, False, 0, 0.0, '', [], (), {} et set().
    pub fn truthy(&self) -> bool {
        match self {
            Val::None => false,
            Val::Bool(b) => *b,
            Val::Int(i) => *i != 0,
            Val::Float(f) => *f != 0.0,
            Val::Str(s) => !s.is_empty(),
            Val::List(l) => !l.borrow().is_empty(),
            Val::Tuple(t) => !t.is_empty(),
            Val::Dict(d) => !d.borrow().is_empty(),
            Val::Set(s) => !s.borrow().is_empty(),
        }
    }
    /// `a or b`.
    pub fn or(&self, autre: impl Into<Val>) -> Val {
        if self.truthy() {
            self.clone()
        } else {
            autre.into()
        }
    }
    /// `a or f()` : f n'est appelée que si a est faux.
    pub fn or_else(&self, f: impl FnOnce() -> Val) -> Val {
        if self.truthy() {
            self.clone()
        } else {
            f()
        }
    }
    /// `a and b`.
    pub fn and(&self, autre: impl Into<Val>) -> Val {
        if self.truthy() {
            autre.into()
        } else {
            self.clone()
        }
    }
    #[track_caller]
    pub fn len(&self) -> usize {
        match self {
            Val::Str(s) => s.chars().count(),
            Val::List(l) => l.borrow().len(),
            Val::Tuple(t) => t.len(),
            Val::Dict(d) => d.borrow().len(),
            Val::Set(s) => s.borrow().len(),
            _ => panic!("TypeError: object of type '{}' has no len()", self.type_name()),
        }
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// `v[k]` : la clé d'un dict, l'indice d'une liste, d'un tuple ou d'un texte. Absent : KeyError, IndexError.
    #[track_caller]
    pub fn at(&self, k: impl Cle) -> Val {
        match self.try_at(&k) {
            Some(v) => v,
            None => match self {
                Val::Dict(_) => panic!("KeyError: {}", k.val().repr()),
                Val::List(_) | Val::Tuple(_) | Val::Str(_) => panic!("IndexError: indice {} hors de {}", k.val().repr(), self.repr_court()),
                _ => panic!("TypeError: '{}' object is not subscriptable (clé {})", self.type_name(), k.val().repr()),
            },
        }
    }
    fn try_at(&self, k: &impl Cle) -> Option<Val> {
        match self {
            Val::Dict(d) => k.dans(&d.borrow()).cloned(),
            Val::List(l) => {
                let l = l.borrow();
                rang(k.indice()?, l.len()).map(|i| l[i].clone())
            }
            Val::Tuple(t) => rang(k.indice()?, t.len()).map(|i| t[i].clone()),
            Val::Str(s) => {
                let n = s.chars().count();
                rang(k.indice()?, n).map(|i| Val::from(s.chars().nth(i).unwrap().to_string()))
            }
            _ => None,
        }
    }
    /// `v[k]` en flottant : `u.atf("x")` pour `u.x` ou `u['x']`.
    #[track_caller]
    pub fn atf(&self, k: impl Cle) -> f64 {
        self.at(k).f()
    }
    /// `v[k]` en entier.
    #[track_caller]
    pub fn ati(&self, k: impl Cle) -> i64 {
        self.at(k).i()
    }
    /// `v[k]` en texte (à soi).
    #[track_caller]
    pub fn ats(&self, k: impl Cle) -> String {
        self.at(k).string()
    }
    /// `bool(v[k])` : la véracité de `v[k]` (`if u.seen:`).
    #[track_caller]
    pub fn atb(&self, k: impl Cle) -> bool {
        self.at(k).truthy()
    }
    /// `bool(d.get(k))` : faux si la clé manque (`if a.get('qrt'):`).
    #[track_caller]
    pub fn getb(&self, k: impl Cle) -> bool {
        self.get(k).truthy()
    }
    /// `d.get(k)` : None si la clé manque. (Sur None lui-même : None, pour `(d.get('a') or {}).get('b')`.)
    #[track_caller]
    pub fn get(&self, k: impl Cle) -> Val {
        match self {
            Val::Dict(d) => k.dans(&d.borrow()).cloned().unwrap_or(Val::None),
            _ => panic!("AttributeError: '{}' object has no attribute 'get' (clé {})", self.type_name(), k.val().repr()),
        }
    }
    /// `d.get(k, defaut)`.
    #[track_caller]
    pub fn get_or(&self, k: impl Cle, defaut: impl Into<Val>) -> Val {
        match self {
            Val::Dict(d) => k.dans(&d.borrow()).cloned().unwrap_or_else(|| defaut.into()),
            _ => panic!("AttributeError: '{}' object has no attribute 'get' (clé {})", self.type_name(), k.val().repr()),
        }
    }
    /// `k in v` : clé d'un dict, élément d'une liste, d'un tuple ou d'un set, morceau d'un texte.
    #[track_caller]
    pub fn has(&self, k: impl Cle) -> bool {
        match self {
            Val::Dict(d) => k.dans(&d.borrow()).is_some(),
            Val::Set(s) => s.borrow().contains(&k.val()),
            Val::List(l) => {
                let x = k.val();
                l.borrow().iter().any(|e| *e == x)
            }
            Val::Tuple(t) => {
                let x = k.val();
                t.iter().any(|e| *e == x)
            }
            Val::Str(s) => s.contains(k.val().s()),
            _ => panic!("TypeError: argument of type '{}' is not iterable", self.type_name()),
        }
    }

    /// Les éléments, copiés à l'instant : ceux d'une liste, d'un tuple, d'un set, les clés d'un dict, les
    /// caractères d'un texte. L'objet peut changer pendant le parcours sans le troubler.
    #[track_caller]
    pub fn iter(&self) -> std::vec::IntoIter<Val> {
        self.vec().into_iter()
    }
    #[track_caller]
    pub fn vec(&self) -> Vec<Val> {
        match self {
            Val::List(l) => l.borrow().clone(),
            Val::Tuple(t) => (**t).clone(),
            Val::Dict(d) => d.borrow().keys().cloned().collect(),
            Val::Set(s) => s.borrow().iter().cloned().collect(),
            Val::Str(s) => s.chars().map(|c| Val::from(c.to_string())).collect(),
            _ => panic!("TypeError: '{}' object is not iterable", self.type_name()),
        }
    }
    #[track_caller]
    pub fn keys(&self) -> Vec<Val> {
        match self {
            Val::Dict(d) => d.borrow().keys().cloned().collect(),
            _ => panic!("AttributeError: '{}' object has no attribute 'keys'", self.type_name()),
        }
    }
    #[track_caller]
    pub fn values(&self) -> Vec<Val> {
        match self {
            Val::Dict(d) => d.borrow().values().cloned().collect(),
            _ => panic!("AttributeError: '{}' object has no attribute 'values'", self.type_name()),
        }
    }
    #[track_caller]
    pub fn items(&self) -> Vec<(Val, Val)> {
        match self {
            Val::Dict(d) => d.borrow().iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
            _ => panic!("AttributeError: '{}' object has no attribute 'items'", self.type_name()),
        }
    }
    /// `a, b = v`.
    #[track_caller]
    pub fn pair(&self) -> (Val, Val) {
        let v = self.vec();
        match <[Val; 2]>::try_from(v) {
            Ok([a, b]) => (a, b),
            Err(v) => panic!("ValueError: 2 valeurs attendues, {} reçues", v.len()),
        }
    }
    #[track_caller]
    pub fn triple(&self) -> (Val, Val, Val) {
        let v = self.vec();
        match <[Val; 3]>::try_from(v) {
            Ok([a, b, c]) => (a, b, c),
            Err(v) => panic!("ValueError: 3 valeurs attendues, {} reçues", v.len()),
        }
    }
    #[track_caller]
    pub fn quad(&self) -> (Val, Val, Val, Val) {
        let v = self.vec();
        match <[Val; 4]>::try_from(v) {
            Ok([a, b, c, d]) => (a, b, c, d),
            Err(v) => panic!("ValueError: 4 valeurs attendues, {} reçues", v.len()),
        }
    }
    /// `(x, y)` en flottants.
    #[track_caller]
    pub fn xy(&self) -> (f64, f64) {
        (self.at(0).f(), self.at(1).f())
    }
    /// `v[a:b]` (None : le bout) sur une liste, un tuple ou un texte ; rend un objet neuf.
    #[track_caller]
    pub fn slice(&self, a: Option<i64>, b: Option<i64>) -> Val {
        let borne = |x: Option<i64>, defaut: usize, n: usize| -> usize {
            match x {
                None => defaut,
                Some(i) if i < 0 => (i + n as i64).max(0) as usize,
                Some(i) => (i as usize).min(n),
            }
        };
        let coupe = |n: usize| {
            let (i, j) = (borne(a, 0, n), borne(b, n, n));
            (i, j.max(i))
        };
        match self {
            Val::List(l) => {
                let l = l.borrow();
                let (i, j) = coupe(l.len());
                Val::list(l[i..j].to_vec())
            }
            Val::Tuple(t) => {
                let (i, j) = coupe(t.len());
                Val::tuple(t[i..j].to_vec())
            }
            Val::Str(s) => {
                let c: Vec<char> = s.chars().collect();
                let (i, j) = coupe(c.len());
                Val::from(c[i..j].iter().collect::<String>())
            }
            _ => panic!("TypeError: '{}' object is not subscriptable", self.type_name()),
        }
    }
    /// `dict(d)`, `list(l)`, `l[:]`, `set(s)` : une copie d'un niveau.
    pub fn copy(&self) -> Val {
        match self {
            Val::List(l) => Val::list(l.borrow().clone()),
            Val::Dict(d) => Val::Dict(Rc::new(RefCell::new(d.borrow().clone()))),
            Val::Set(s) => Val::Set(Rc::new(RefCell::new(s.borrow().clone()))),
            autre => autre.clone(),
        }
    }
    /// `copy.deepcopy(v)` (sans objet partagé ni cycle : ceux du jeu n'en ont pas dans ce qu'il copie ainsi).
    pub fn deepcopy(&self) -> Val {
        match self {
            Val::List(l) => Val::list(l.borrow().iter().map(Val::deepcopy).collect()),
            Val::Tuple(t) => Val::tuple(t.iter().map(Val::deepcopy).collect()),
            Val::Dict(d) => Val::dict_from(d.borrow().iter().map(|(k, v)| (k.clone(), v.deepcopy())).collect()),
            Val::Set(s) => Val::Set(Rc::new(RefCell::new(s.borrow().clone()))),
            autre => autre.clone(),
        }
    }
    /// `list(v)` : une liste neuve des éléments.
    #[track_caller]
    pub fn to_list(&self) -> Val {
        Val::list(self.vec())
    }
    /// `tuple(v)`.
    #[track_caller]
    pub fn to_tuple(&self) -> Val {
        Val::tuple(self.vec())
    }
    /// `set(v)`.
    #[track_caller]
    pub fn to_set(&self) -> Val {
        Val::set_from(self.vec())
    }
}

// ------------------------------------------------------------------ écrire
impl Val {
    /// `v[k] = x` : sur un dict (la clé est créée) ou une liste (l'indice doit exister).
    #[track_caller]
    pub fn set(&self, k: impl Cle, x: impl Into<Val>) {
        match self {
            Val::Dict(d) => {
                d.borrow_mut().insert(k.val(), x.into());
            }
            Val::List(l) => {
                let mut l = l.borrow_mut();
                let n = l.len();
                match k.indice().and_then(|i| rang(i, n)) {
                    Some(i) => l[i] = x.into(),
                    None => panic!("IndexError: list assignment index out of range ({})", k.val().repr()),
                }
            }
            _ => panic!("TypeError: '{}' object does not support item assignment", self.type_name()),
        }
    }
    /// `d[k] += x` (ou `l[i] += x`), avec les règles de Python (int + float = float).
    #[track_caller]
    pub fn inc(&self, k: impl Cle, x: impl Into<Val>) {
        let v = &self.at(&k.val()) + &x.into();
        self.set(k, v)
    }
    /// `d[k] -= x`.
    #[track_caller]
    pub fn dec(&self, k: impl Cle, x: impl Into<Val>) {
        let v = &self.at(&k.val()) - &x.into();
        self.set(k, v)
    }
    /// `d[k] *= x`.
    #[track_caller]
    pub fn scale(&self, k: impl Cle, x: impl Into<Val>) {
        let v = &self.at(&k.val()) * &x.into();
        self.set(k, v)
    }
    /// `d.setdefault(k, defaut)` : la valeur déjà là, sinon `defaut`, qui est alors rangé.
    #[track_caller]
    pub fn setdefault(&self, k: impl Cle, defaut: impl Into<Val>) -> Val {
        match self {
            Val::Dict(d) => {
                if let Some(v) = k.dans(&d.borrow()) {
                    return v.clone();
                }
                let v = defaut.into();
                d.borrow_mut().insert(k.val(), v.clone());
                v
            }
            _ => panic!("AttributeError: '{}' object has no attribute 'setdefault'", self.type_name()),
        }
    }
    /// `d.pop(k, None)` : retire la clé et rend sa valeur (None si absente). L'ordre des autres clés est gardé.
    #[track_caller]
    pub fn pop(&self, k: impl Cle) -> Val {
        match self {
            Val::Dict(d) => d.borrow_mut().shift_remove(&k.val()).unwrap_or(Val::None),
            Val::List(l) => {
                let mut l = l.borrow_mut();
                let n = l.len();
                match k.indice().and_then(|i| rang(i, n)) {
                    Some(i) => l.remove(i),
                    None => panic!("IndexError: pop index out of range"),
                }
            }
            Val::Set(s) => {
                let x = k.val();
                s.borrow_mut().shift_remove(&x);
                x
            }
            _ => panic!("AttributeError: '{}' object has no attribute 'pop'", self.type_name()),
        }
    }
    /// `del d[k]` ; KeyError si la clé manque.
    #[track_caller]
    pub fn del(&self, k: impl Cle) {
        match self {
            Val::Dict(d) => {
                if d.borrow_mut().shift_remove(&k.val()).is_none() {
                    panic!("KeyError: {}", k.val().repr())
                }
            }
            Val::List(_) => {
                self.pop(k);
            }
            _ => panic!("TypeError: '{}' object doesn't support item deletion", self.type_name()),
        }
    }
    /// `l.pop()` : le dernier élément.
    #[track_caller]
    pub fn pop_last(&self) -> Val {
        match self {
            Val::List(l) => l.borrow_mut().pop().unwrap_or_else(|| panic!("IndexError: pop from empty list")),
            _ => panic!("AttributeError: '{}' object has no attribute 'pop'", self.type_name()),
        }
    }
    /// `d.update(autre)` ou `s.update(autre)` / `s |= autre`.
    #[track_caller]
    pub fn update(&self, autre: &Val) {
        match self {
            Val::Dict(d) => {
                let paires = autre.items();
                d.borrow_mut().extend(paires)
            }
            Val::Set(s) => {
                let v = autre.vec();
                s.borrow_mut().extend(v)
            }
            _ => panic!("AttributeError: '{}' object has no attribute 'update'", self.type_name()),
        }
    }
    /// `l.append(x)` ou `s.add(x)`.
    #[track_caller]
    pub fn push(&self, x: impl Into<Val>) {
        match self {
            Val::List(l) => l.borrow_mut().push(x.into()),
            Val::Set(s) => {
                s.borrow_mut().insert(x.into());
            }
            _ => panic!("AttributeError: '{}' object has no attribute 'append'", self.type_name()),
        }
    }
    /// `l.extend(v)` / `l += v`.
    #[track_caller]
    pub fn extend(&self, autre: &Val) {
        let v = autre.vec();
        match self {
            Val::List(l) => l.borrow_mut().extend(v),
            _ => panic!("AttributeError: '{}' object has no attribute 'extend'", self.type_name()),
        }
    }
    /// `l.insert(i, x)`.
    #[track_caller]
    pub fn insert(&self, i: i64, x: impl Into<Val>) {
        match self {
            Val::List(l) => {
                let mut l = l.borrow_mut();
                let n = l.len() as i64;
                let j = if i < 0 { (i + n).max(0) } else { i.min(n) };
                l.insert(j as usize, x.into())
            }
            _ => panic!("AttributeError: '{}' object has no attribute 'insert'", self.type_name()),
        }
    }
    /// `l.remove(x)` (ValueError s'il n'y est pas) ou `s.remove(x)` (KeyError).
    #[track_caller]
    pub fn remove(&self, x: &Val) {
        if !self.discard(x) {
            panic!("ValueError/KeyError: {} n'est pas dans {}", x.repr(), self.repr_court())
        }
    }
    /// `s.discard(x)` ; sur une liste, retire la première occurrence. Vrai si quelque chose est parti.
    #[track_caller]
    pub fn discard(&self, x: &Val) -> bool {
        match self {
            Val::List(l) => {
                let mut l = l.borrow_mut();
                match l.iter().position(|e| e == x) {
                    Some(i) => {
                        l.remove(i);
                        true
                    }
                    None => false,
                }
            }
            Val::Set(s) => s.borrow_mut().shift_remove(x),
            _ => panic!("AttributeError: '{}' object has no attribute 'remove'", self.type_name()),
        }
    }
    /// `l.index(x)` : le rang de la première occurrence, ou None.
    #[track_caller]
    pub fn index_of(&self, x: &Val) -> Option<usize> {
        match self {
            Val::List(l) => l.borrow().iter().position(|e| e == x),
            Val::Tuple(t) => t.iter().position(|e| e == x),
            _ => panic!("AttributeError: '{}' object has no attribute 'index'", self.type_name()),
        }
    }
    /// `l.clear()`, `d.clear()`, `s.clear()`.
    pub fn clear(&self) {
        match self {
            Val::List(l) => l.borrow_mut().clear(),
            Val::Dict(d) => d.borrow_mut().clear(),
            Val::Set(s) => s.borrow_mut().clear(),
            _ => panic!("AttributeError: '{}' object has no attribute 'clear'", self.type_name()),
        }
    }
    /// `l[:] = v` : la liste garde son identité et prend ces éléments.
    #[track_caller]
    pub fn replace_all(&self, v: Vec<Val>) {
        match self {
            Val::List(l) => *l.borrow_mut() = v,
            _ => panic!("TypeError: '{}' object does not support slice assignment", self.type_name()),
        }
    }
    /// `l.reverse()`.
    pub fn reverse(&self) {
        match self {
            Val::List(l) => l.borrow_mut().reverse(),
            _ => panic!("AttributeError: '{}' object has no attribute 'reverse'", self.type_name()),
        }
    }
    /// `l.sort()` : tri stable, par `<` de Python.
    #[track_caller]
    pub fn sort(&self) {
        self.sort_by_key(|x| x.clone())
    }
    /// `l.sort(key=f)` : tri stable (la clé est calculée une fois par élément, comme en Python).
    #[track_caller]
    pub fn sort_by_key<K: PartialOrd>(&self, f: impl FnMut(&Val) -> K) {
        match self {
            Val::List(l) => {
                let v = super::sorted_by_key(l.borrow().clone(), f);
                *l.borrow_mut() = v
            }
            _ => panic!("AttributeError: '{}' object has no attribute 'sort'", self.type_name()),
        }
    }
}

// ------------------------------------------------------------------ comparer
impl PartialEq for Val {
    fn eq(&self, o: &Val) -> bool {
        match (self, o) {
            (Val::None, Val::None) => true,
            (Val::Str(a), Val::Str(b)) => a == b,
            (Val::List(a), Val::List(b)) => Rc::ptr_eq(a, b) || *a.borrow() == *b.borrow(),
            (Val::Tuple(a), Val::Tuple(b)) => a == b,
            (Val::Dict(a), Val::Dict(b)) => {
                Rc::ptr_eq(a, b) || {
                    let (a, b) = (a.borrow(), b.borrow());
                    a.len() == b.len() && a.iter().all(|(k, v)| b.get(k) == Some(v))
                }
            }
            (Val::Set(a), Val::Set(b)) => {
                Rc::ptr_eq(a, b) || {
                    let (a, b) = (a.borrow(), b.borrow());
                    a.len() == b.len() && a.iter().all(|k| b.contains(k))
                }
            }
            _ => match (self.num(), o.num()) {
                (Some(Num::I(a)), Some(Num::I(b))) => a == b,
                (Some(a), Some(b)) => a.f() == b.f(),
                _ => false,
            },
        }
    }
}
impl Eq for Val {}

impl PartialOrd for Val {
    /// `<` de Python : nombres entre eux, textes entre eux, listes et tuples élément par élément. Le reste ne se
    /// compare pas (TypeError en Python, None ici : `<` et `>` rendent faux).
    fn partial_cmp(&self, o: &Val) -> Option<Ordering> {
        fn suite(a: &[Val], b: &[Val]) -> Option<Ordering> {
            for (x, y) in a.iter().zip(b) {
                if x != y {
                    return x.partial_cmp(y);
                }
            }
            a.len().partial_cmp(&b.len())
        }
        match (self, o) {
            (Val::Str(a), Val::Str(b)) => a.partial_cmp(b),
            (Val::List(a), Val::List(b)) => suite(&a.borrow(), &b.borrow()),
            (Val::Tuple(a), Val::Tuple(b)) => suite(a, b),
            _ => match (self.num()?, o.num()?) {
                (Num::I(a), Num::I(b)) => a.partial_cmp(&b),
                (a, b) => a.f().partial_cmp(&b.f()),
            },
        }
    }
}

macro_rules! comparer_avec {
    ($($t:ty),*) => { $(
        impl PartialEq<$t> for Val { fn eq(&self, o: &$t) -> bool { *self == Val::from(*o) } }
        impl PartialOrd<$t> for Val { fn partial_cmp(&self, o: &$t) -> Option<Ordering> { self.partial_cmp(&Val::from(*o)) } }
    )* };
}
comparer_avec!(i64, f64, bool);
impl PartialEq<&str> for Val {
    fn eq(&self, o: &&str) -> bool {
        matches!(self, Val::Str(s) if &**s == *o)
    }
}
impl PartialEq<str> for Val {
    fn eq(&self, o: &str) -> bool {
        matches!(self, Val::Str(s) if &**s == o)
    }
}
impl PartialEq<String> for Val {
    fn eq(&self, o: &String) -> bool {
        matches!(self, Val::Str(s) if &**s == o.as_str())
    }
}

// ------------------------------------------------------------------ calculer
#[track_caller]
fn refus(op: &str, a: &Val, b: &Val) -> ! {
    panic!("TypeError: unsupported operand type(s) for {op}: '{}' and '{}' ({} {op} {})", a.type_name(), b.type_name(), a.repr_court(), b.repr_court())
}
#[track_caller]
fn deborde(op: &str, a: i64, b: i64) -> ! {
    panic!("OverflowError: {a} {op} {b} dépasse 64 bits (un int de Python n'a pas de borne : passer par i128)")
}

impl Val {
    #[track_caller]
    pub fn py_add(&self, o: &Val) -> Val {
        match (self, o) {
            (Val::Str(a), Val::Str(b)) => Val::from(format!("{a}{b}")),
            (Val::List(a), Val::List(b)) => Val::list(a.borrow().iter().chain(b.borrow().iter()).cloned().collect()),
            (Val::Tuple(a), Val::Tuple(b)) => Val::tuple(a.iter().chain(b.iter()).cloned().collect()),
            _ => match (self.num(), o.num()) {
                (Some(Num::I(a)), Some(Num::I(b))) => Val::Int(a.checked_add(b).unwrap_or_else(|| deborde("+", a, b))),
                (Some(a), Some(b)) => Val::Float(a.f() + b.f()),
                _ => refus("+", self, o),
            },
        }
    }
    #[track_caller]
    pub fn py_sub(&self, o: &Val) -> Val {
        match (self, o) {
            (Val::Set(a), Val::Set(b)) => {
                let b = b.borrow();
                Val::set_from(a.borrow().iter().filter(|x| !b.contains(*x)).cloned().collect())
            }
            _ => match (self.num(), o.num()) {
                (Some(Num::I(a)), Some(Num::I(b))) => Val::Int(a.checked_sub(b).unwrap_or_else(|| deborde("-", a, b))),
                (Some(a), Some(b)) => Val::Float(a.f() - b.f()),
                _ => refus("-", self, o),
            },
        }
    }
    #[track_caller]
    pub fn py_mul(&self, o: &Val) -> Val {
        let repete = |n: i64, v: &[Val]| -> Vec<Val> { (0..n.max(0)).flat_map(|_| v.iter().cloned()).collect() };
        match (self, o) {
            (Val::List(l), n @ (Val::Int(_) | Val::Bool(_))) | (n @ (Val::Int(_) | Val::Bool(_)), Val::List(l)) => Val::list(repete(n.i(), &l.borrow())),
            (Val::Tuple(l), n @ (Val::Int(_) | Val::Bool(_))) | (n @ (Val::Int(_) | Val::Bool(_)), Val::Tuple(l)) => Val::tuple(repete(n.i(), l)),
            (Val::Str(s), n @ (Val::Int(_) | Val::Bool(_))) | (n @ (Val::Int(_) | Val::Bool(_)), Val::Str(s)) => Val::from(s.repeat(n.i().max(0) as usize)),
            _ => match (self.num(), o.num()) {
                (Some(Num::I(a)), Some(Num::I(b))) => Val::Int(a.checked_mul(b).unwrap_or_else(|| deborde("*", a, b))),
                (Some(a), Some(b)) => Val::Float(a.f() * b.f()),
                _ => refus("*", self, o),
            },
        }
    }
    /// `a / b` : toujours un float.
    #[track_caller]
    pub fn py_div(&self, o: &Val) -> Val {
        match (self.num(), o.num()) {
            (Some(a), Some(b)) => {
                if b.f() == 0.0 {
                    panic!("ZeroDivisionError: {} / {}", self.repr(), o.repr())
                }
                Val::Float(a.f() / b.f())
            }
            _ => refus("/", self, o),
        }
    }
    /// `a // b` : un int entre entiers, un float sinon ; arrondi vers −∞.
    #[track_caller]
    pub fn floordiv(&self, o: impl Into<Val>) -> Val {
        let o = o.into();
        match (self.num(), o.num()) {
            (Some(Num::I(a)), Some(Num::I(b))) => Val::Int(super::floordiv_i(a, b)),
            (Some(a), Some(b)) => Val::Float(super::floordiv_f(a.f(), b.f())),
            _ => refus("//", self, &o),
        }
    }
    /// `a % b` : du signe de b.
    #[track_caller]
    pub fn py_rem(&self, o: &Val) -> Val {
        match (self.num(), o.num()) {
            (Some(Num::I(a)), Some(Num::I(b))) => Val::Int(super::mod_i(a, b)),
            (Some(a), Some(b)) => Val::Float(super::mod_f(a.f(), b.f())),
            _ => refus("%", self, o),
        }
    }
    #[track_caller]
    pub fn py_neg(&self) -> Val {
        match self.num() {
            Some(Num::I(a)) => Val::Int(-a),
            Some(Num::F(a)) => Val::Float(-a),
            None => panic!("TypeError: bad operand type for unary -: '{}'", self.type_name()),
        }
    }
    /// `abs(a)`.
    #[track_caller]
    pub fn abs(&self) -> Val {
        match self.num() {
            Some(Num::I(a)) => Val::Int(a.abs()),
            Some(Num::F(a)) => Val::Float(a.abs()),
            None => panic!("TypeError: bad operand type for abs(): '{}'", self.type_name()),
        }
    }
}

macro_rules! operateur {
    ($tr:ident, $m:ident, $f:ident) => {
        impl std::ops::$tr<&Val> for &Val { type Output = Val; #[track_caller] fn $m(self, o: &Val) -> Val { self.$f(o) } }
        impl std::ops::$tr<Val> for Val { type Output = Val; #[track_caller] fn $m(self, o: Val) -> Val { self.$f(&o) } }
        impl std::ops::$tr<&Val> for Val { type Output = Val; #[track_caller] fn $m(self, o: &Val) -> Val { self.$f(o) } }
        impl std::ops::$tr<Val> for &Val { type Output = Val; #[track_caller] fn $m(self, o: Val) -> Val { self.$f(&o) } }
        operateur!(@prim $tr, $m, $f, f64);
        operateur!(@prim $tr, $m, $f, i64);
    };
    (@prim $tr:ident, $m:ident, $f:ident, $t:ty) => {
        impl std::ops::$tr<$t> for &Val { type Output = Val; #[track_caller] fn $m(self, o: $t) -> Val { self.$f(&Val::from(o)) } }
        impl std::ops::$tr<$t> for Val { type Output = Val; #[track_caller] fn $m(self, o: $t) -> Val { self.$f(&Val::from(o)) } }
        impl std::ops::$tr<&Val> for $t { type Output = Val; #[track_caller] fn $m(self, o: &Val) -> Val { Val::from(self).$f(o) } }
        impl std::ops::$tr<Val> for $t { type Output = Val; #[track_caller] fn $m(self, o: Val) -> Val { Val::from(self).$f(&o) } }
    };
}
operateur!(Add, add, py_add);
operateur!(Sub, sub, py_sub);
operateur!(Mul, mul, py_mul);
operateur!(Div, div, py_div);
operateur!(Rem, rem, py_rem);
impl std::ops::Neg for &Val {
    type Output = Val;
    #[track_caller]
    fn neg(self) -> Val {
        self.py_neg()
    }
}
impl std::ops::Neg for Val {
    type Output = Val;
    #[track_caller]
    fn neg(self) -> Val {
        self.py_neg()
    }
}

// ------------------------------------------------------------------ écrire en texte
impl Val {
    /// `repr(v)`.
    pub fn repr(&self) -> String {
        let mut s = String::new();
        self.ecrire(&mut s, true);
        s
    }
    /// repr abrégée, pour les messages d'erreur.
    fn repr_court(&self) -> String {
        let r = self.repr();
        if r.chars().count() > 120 {
            format!("{}…", r.chars().take(120).collect::<String>())
        } else {
            r
        }
    }
    fn ecrire(&self, s: &mut String, repr: bool) {
        let suite = |s: &mut String, v: &[Val], ouvre: &str, ferme: &str| {
            s.push_str(ouvre);
            for (i, x) in v.iter().enumerate() {
                if i > 0 {
                    s.push_str(", ")
                }
                x.ecrire(s, true)
            }
            s.push_str(ferme)
        };
        match self {
            Val::None => s.push_str("None"),
            Val::Bool(b) => s.push_str(if *b { "True" } else { "False" }),
            Val::Int(i) => s.push_str(&i.to_string()),
            Val::Float(f) => s.push_str(&super::repr_f(*f)),
            Val::Str(t) if repr => s.push_str(&super::repr_s(t)),
            Val::Str(t) => s.push_str(t),
            Val::List(l) => suite(s, &l.borrow(), "[", "]"),
            Val::Tuple(t) if t.len() == 1 => suite(s, t, "(", ",)"),
            Val::Tuple(t) => suite(s, t, "(", ")"),
            Val::Set(e) if e.borrow().is_empty() => s.push_str("set()"),
            Val::Set(e) => suite(s, &e.borrow().iter().cloned().collect::<Vec<_>>(), "{", "}"),
            Val::Dict(d) => {
                s.push('{');
                for (i, (k, v)) in d.borrow().iter().enumerate() {
                    if i > 0 {
                        s.push_str(", ")
                    }
                    k.ecrire(s, true);
                    s.push_str(": ");
                    v.ecrire(s, true)
                }
                s.push('}')
            }
        }
    }
}
/// `str(v)` : ce qu'un f-string écrit pour `{v}`.
impl fmt::Display for Val {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        let mut s = String::new();
        self.ecrire(&mut s, false);
        f.write_str(&s)
    }
}
impl fmt::Debug for Val {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str(&self.repr())
    }
}
