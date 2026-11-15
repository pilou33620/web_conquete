//! Les textes comme Python les écrit : repr d'un float (la plus courte écriture qui le redonne, « 1e-05 »,
//! « 1e+16 », « 3.0 »), repr d'un str, séparateur de milliers. Pour le reste d'un f-string, `format!` rend la
//! même chose : `{x:.1f}` → `{:.1}`, `{n:02d}` → `{:02}`, `{x:+.1f}` → `{:+.1}`, `{x:.0%}` → `{:.0}%` de x * 100.

/// `repr(x)` et `str(x)` d'un float.
pub fn repr_f(x: f64) -> String {
    if x.is_nan() {
        return "nan".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "inf".into() } else { "-inf".into() };
    }
    // Rust donne les mêmes chiffres (les plus courts) : « d.ddde-5 » ; reste à les poser comme Python
    let e = format!("{:e}", x.abs());
    let (mantisse, exp) = e.split_once('e').unwrap();
    let chiffres: String = mantisse.chars().filter(|c| *c != '.').collect();
    let decpt: i32 = exp.parse::<i32>().unwrap() + 1; // rang de la virgule dans les chiffres
    let (chiffres, decpt) = moitie_au_pair(x.abs(), chiffres, decpt);
    let n = chiffres.len() as i32;
    let corps = if decpt <= -4 || decpt > 16 {
        let e10 = decpt - 1;
        let m = if n > 1 { format!("{}.{}", &chiffres[..1], &chiffres[1..]) } else { chiffres };
        format!("{m}e{}{:02}", if e10 < 0 { '-' } else { '+' }, e10.abs())
    } else if decpt <= 0 {
        format!("0.{}{chiffres}", "0".repeat(-decpt as usize))
    } else if decpt >= n {
        format!("{chiffres}{}.0", "0".repeat((decpt - n) as usize))
    } else {
        format!("{}.{}", &chiffres[..decpt as usize], &chiffres[decpt as usize..])
    };
    if x.is_sign_negative() {
        format!("-{corps}")
    } else {
        corps
    }
}

/// Quand x tombe exactement à mi-chemin de deux écritures les plus courtes (0.69455718994140625 entre …062 et
/// …063), Python prend celle qui finit par un chiffre pair, Rust l'autre : on refait le choix de Python.
/// Cela n'arrive qu'à un flottant de peu de bits (une valeur venue d'un `array('f')`, une fraction de 2^k).
fn moitie_au_pair(x: f64, chiffres: String, decpt: i32) -> (String, i32) {
    let n = chiffres.len();
    if n < 15 {
        return (chiffres, decpt);
    }
    // x = m · 2^-f exactement, m impair : son écriture décimale exacte est m · 5^f, avec f décimales
    let bits = x.to_bits();
    let (e, frac) = (((bits >> 52) & 0x7ff) as i32, bits & ((1u64 << 52) - 1));
    if e == 0 {
        return (chiffres, decpt);
    }
    let (mut m, mut f) = (frac | (1u64 << 52), 1075 - e);
    while m & 1 == 0 {
        m >>= 1;
        f -= 1;
    }
    if !(1..=27).contains(&f) {
        return (chiffres, decpt);
    }
    let exact = m as u128 * 5u128.pow(f as u32);
    if exact.to_string().len() != n + 1 {
        return (chiffres, decpt); // pas à mi-chemin : l'écriture exacte n'a pas juste un chiffre de plus
    }
    let t = exact / 10;
    let t = if t & 1 == 1 { t + 1 } else { t };
    let mut c = t.to_string();
    let dp = decpt + (c.len() - n) as i32;
    while c.len() > 1 && c.ends_with('0') {
        c.pop();
    }
    // (sous une puissance de 2, l'écart d'en bas est moitié moindre : l'écriture paire peut ne pas relire x)
    if format!("0.{c}e{dp}").parse::<f64>() != Ok(x) {
        return (chiffres, decpt);
    }
    (c, dp)
}

/// `repr(s)` d'un texte : entre apostrophes (entre guillemets s'il contient une apostrophe et pas de guillemet).
pub fn repr_s(s: &str) -> String {
    let q = if s.contains('\'') && !s.contains('"') { '"' } else { '\'' };
    let mut r = String::with_capacity(s.len() + 2);
    r.push(q);
    for c in s.chars() {
        match c {
            '\\' => r.push_str("\\\\"),
            '\n' => r.push_str("\\n"),
            '\r' => r.push_str("\\r"),
            '\t' => r.push_str("\\t"),
            c if c == q => {
                r.push('\\');
                r.push(c)
            }
            // ce que Python tient pour non imprimable : contrôles, espaces autres que l'espace, marques invisibles
            c if c.is_control() || (c.is_whitespace() && c != ' ') || matches!(c as u32, 0xad | 0x200b..=0x200f | 0x202a..=0x202e | 0x2060..=0x2064 | 0xfeff) => {
                let u = c as u32;
                r.push_str(&if u < 0x100 { format!("\\x{u:02x}") } else if u < 0x10000 { format!("\\u{u:04x}") } else { format!("\\U{u:08x}") })
            }
            c => r.push(c),
        }
    }
    r.push(q);
    r
}

/// `f"{n:,}"` : un entier avec ses milliers séparés par des virgules.
pub fn milliers(n: i64) -> String {
    let c = n.unsigned_abs().to_string();
    let mut r = String::new();
    for (i, ch) in c.chars().enumerate() {
        if i > 0 && (c.len() - i) % 3 == 0 {
            r.push(',')
        }
        r.push(ch)
    }
    if n < 0 {
        format!("-{r}")
    } else {
        r
    }
}

/// `s.capitalize()` : première lettre en capitale, le reste en minuscules.
pub fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(p) => p.to_uppercase().chain(c.flat_map(|x| x.to_lowercase())).collect(),
        None => String::new(),
    }
}
