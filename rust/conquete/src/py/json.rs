//! `json` de Python : loads et dumps. Un entier reste un entier, un flottant s'écrit à la repr, les clés
//! gardent leur ordre, et une clé entière devient un texte, comme json.dumps le fait.

use super::{repr_f, Val};

/// `json.loads(texte)`.
pub fn loads(texte: &str) -> Result<Val, String> {
    serde_json::from_str::<serde_json::Value>(texte).map(|v| de_serde(&v)).map_err(|e| e.to_string())
}

pub fn de_serde(v: &serde_json::Value) -> Val {
    use serde_json::Value as J;
    match v {
        J::Null => Val::None,
        J::Bool(b) => Val::Bool(*b),
        J::Number(n) => match n.as_i64() {
            Some(i) => Val::Int(i),
            None if n.is_u64() => Val::Float(n.as_u64().unwrap() as f64),
            None => Val::Float(n.as_f64().unwrap()),
        },
        J::String(s) => Val::str(s),
        J::Array(a) => Val::list(a.iter().map(de_serde).collect()),
        J::Object(o) => Val::dict_from(o.iter().map(|(k, v)| (Val::str(k), de_serde(v))).collect()),
    }
}

#[derive(Clone, Copy, Default)]
pub struct Ecriture {
    /// Références : un flottant entier s'écrit comme un entier (5.0 → 5), pour que 5 et 5.0 se valent.
    pub nombres_ref: bool,
    /// `ensure_ascii=True` (le défaut de Python) : tout ce qui n'est pas ASCII part en \uXXXX.
    pub ascii: bool,
    /// `separators=(',', ':')` ; sinon « , » et « : » suivis d'une espace.
    pub compact: bool,
    pub sort_keys: bool,
    pub indent: Option<usize>,
}

/// `json.dumps(v)` : séparateurs « , » et « : », tout en ASCII.
pub fn dumps(v: &Val) -> String {
    dumps_avec(v, Ecriture { ascii: true, ..Default::default() })
}
/// `json.dumps(v, ensure_ascii=False, separators=(',', ':'))` : ce qui part au navigateur et dans les sauvegardes.
pub fn dumps_compact(v: &Val) -> String {
    dumps_avec(v, Ecriture { compact: true, ..Default::default() })
}
/// La forme qui sert aux références : clés triées, compacte, sans échappement ASCII.
pub fn dumps_canon(v: &Val) -> String {
    dumps_avec(v, Ecriture { compact: true, sort_keys: true, ..Default::default() })
}
/// La forme des références du portage (outils/jumeau/commun.py : `canon`) : clés triées, compacte, et les
/// flottants entiers écrits comme des entiers. Deux états qui se valent s'écrivent pareil, que le Python ait
/// rangé 5 ou 5.0 ; tout le reste (chaque bit des autres nombres, chaque texte) doit être identique.
pub fn dumps_ref(v: &Val) -> String {
    dumps_avec(v, Ecriture { compact: true, sort_keys: true, nombres_ref: true, ..Default::default() })
}
/// L'empreinte SHA-256 (hexadécimale) de `dumps_ref(v)` : `empreinte` du jumeau.
pub fn empreinte(v: &Val) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(dumps_ref(v).as_bytes()).iter().map(|o| format!("{o:02x}")).collect()
}
pub fn dumps_avec(v: &Val, e: Ecriture) -> String {
    let mut s = String::new();
    ecrire(v, &e, 0, &mut s);
    s
}

fn cle(k: &Val) -> String {
    match k {
        Val::Str(s) => s.to_string(),
        Val::Int(i) => i.to_string(),
        Val::Float(f) => repr_f(*f),
        Val::Bool(b) => (if *b { "true" } else { "false" }).into(),
        Val::None => "null".into(),
        _ => panic!("TypeError: keys must be str, int, float, bool or None, not {} ({})", k.type_name(), k.repr()),
    }
}

fn texte(t: &str, ascii: bool, s: &mut String) {
    s.push('"');
    for c in t.chars() {
        match c {
            '"' => s.push_str("\\\""),
            '\\' => s.push_str("\\\\"),
            '\n' => s.push_str("\\n"),
            '\r' => s.push_str("\\r"),
            '\t' => s.push_str("\\t"),
            '\u{8}' => s.push_str("\\b"),
            '\u{c}' => s.push_str("\\f"),
            c if (c as u32) < 0x20 => s.push_str(&format!("\\u{:04x}", c as u32)),
            c if ascii && !c.is_ascii() => {
                let mut b = [0u16; 2];
                for u in c.encode_utf16(&mut b) {
                    s.push_str(&format!("\\u{:04x}", u))
                }
            }
            c => s.push(c),
        }
    }
    s.push('"');
}

fn ecrire(v: &Val, e: &Ecriture, niveau: usize, s: &mut String) {
    let retour = |s: &mut String, niveau: usize| {
        if let Some(n) = e.indent {
            s.push('\n');
            s.push_str(&" ".repeat(n * niveau));
        }
    };
    let virgule = if e.compact || e.indent.is_some() { "," } else { ", " };
    let deux_points = if e.compact { ":" } else { ": " };
    let suite = |s: &mut String, v: &[Val]| {
        if v.is_empty() {
            return s.push_str("[]");
        }
        s.push('[');
        for (i, x) in v.iter().enumerate() {
            if i > 0 {
                s.push_str(virgule)
            }
            retour(s, niveau + 1);
            ecrire(x, e, niveau + 1, s)
        }
        retour(s, niveau);
        s.push(']')
    };
    match v {
        Val::None => s.push_str("null"),
        Val::Bool(b) => s.push_str(if *b { "true" } else { "false" }),
        Val::Int(i) => s.push_str(&i.to_string()),
        Val::Float(f) if f.is_nan() => s.push_str("NaN"),
        Val::Float(f) if f.is_infinite() => s.push_str(if *f > 0.0 { "Infinity" } else { "-Infinity" }),
        Val::Float(f) if e.nombres_ref && f.fract() == 0.0 && f.abs() < 9007199254740992.0 => s.push_str(&(*f as i64).to_string()),
        Val::Float(f) => s.push_str(&repr_f(*f)),
        Val::Str(t) => texte(t, e.ascii, s),
        Val::List(l) => suite(s, &l.borrow()),
        Val::Tuple(t) => suite(s, t),
        Val::Set(_) if e.nombres_ref => {
            // références : un set s'écrit comme la liste triée de ses éléments (`canon` du jumeau)
            let mut t = v.vec();
            t.sort_by(|a, b| a.partial_cmp(b).expect("set aux éléments qui ne se comparent pas"));
            suite(s, &t)
        }
        Val::Set(_) => panic!("TypeError: Object of type set is not JSON serializable"),
        Val::Dict(d) => {
            let d = d.borrow();
            if d.is_empty() {
                return s.push_str("{}");
            }
            let mut paires: Vec<(&Val, &Val)> = d.iter().collect();
            if e.sort_keys {
                // les clés sont triées avant d'être écrites : 2 passe avant 10, comme en Python
                paires.sort_by(|a, b| a.0.partial_cmp(b.0).expect("TypeError: sort_keys : des clés ne se comparent pas"))
            }
            let paires: Vec<(String, &Val)> = paires.into_iter().map(|(k, v)| (cle(k), v)).collect();
            s.push('{');
            for (i, (k, x)) in paires.iter().enumerate() {
                if i > 0 {
                    s.push_str(virgule)
                }
                retour(s, niveau + 1);
                texte(k, e.ascii, s);
                s.push_str(deux_points);
                ecrire(x, e, niveau + 1, s)
            }
            retour(s, niveau);
            s.push('}')
        }
    }
}
