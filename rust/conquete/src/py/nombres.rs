//! Les nombres comme Python les calcule : round (moitiés au pair), // et % (vers −∞), sum (compensée depuis
//! Python 3.12), math.hypot et math.dist, min et max (le premier gagne), sorted. Vérifié contre Python :
//! tests/references/py.json (essais.rs).

use super::Val;
use std::cmp::Ordering;

/// `round(x)` : l'entier le plus proche, les moitiés vers le pair.
pub fn round(x: f64) -> i64 {
    x.round_ties_even() as i64
}
/// `round(x, n)` : x arrondi à n décimales, sur sa valeur exacte (comme Python : round(2.675, 2) = 2.67).
pub fn round_n(x: f64, n: i32) -> f64 {
    if !x.is_finite() {
        return x;
    }
    if n >= 0 {
        return format!("{:.*}", n as usize, x).parse().unwrap();
    }
    // n < 0 : arrondi à la dizaine, à la centaine… sur l'écriture exacte de l'entier
    let p = 10f64.powi(-n);
    let q = (x / p).round_ties_even() * p;
    if q == 0.0 {
        0.0f64.copysign(x)
    } else {
        q
    }
}
/// `x ** y` entre flottants : le `pow` de la libm, appelé tel quel. `x * x` ou `sqrt` ne rendent PAS toujours
/// le même dernier bit que `x ** 2` ou `x ** 0.5` de Python (un écart sur mille environ) : l'exposant est caché
/// au compilateur pour qu'il ne remplace pas l'appel.
pub fn pow(x: f64, y: f64) -> f64 {
    x.powf(std::hint::black_box(y))
}
/// `pow(dx, 2.0) + pow(dy, 2.0) > r2` à coup sûr (et donc aussi `hypot(dx, dy) > sqrt(r2)`), vu sur les carrés faits
/// à la main, bien plus vite que pow : avec une marge relative de 1e-9, bien au-delà de l'écart d'un ulp entre `x * x` et
/// `pow(x, 2)`. Faux ne dit rien : refaire alors le calcul exact. Pour écarter vite les points lointains d'une boucle.
#[inline]
pub fn loin(dx: f64, dy: f64, r2: f64) -> bool {
    dx * dx + dy * dy > r2 * (1.0 + 1e-9) + 1e-300
}
/// `a ** n` entre entiers (n >= 0), exact.
#[track_caller]
pub fn pow_i(a: i64, n: u32) -> i64 {
    a.checked_pow(n).expect("OverflowError: puissance entière au-delà de 64 bits")
}
/// `int(x)` : vers zéro.
pub fn int(x: f64) -> i64 {
    x.trunc() as i64
}
/// `int(v)` d'une valeur : un float est tronqué, un texte est lu.
#[track_caller]
pub fn int_v(v: &Val) -> i64 {
    match v {
        Val::Float(f) => int(*f),
        Val::Str(s) => s.trim().parse().unwrap_or_else(|_| panic!("ValueError: invalid literal for int(): {}", v.repr())),
        _ => v.i(),
    }
}
/// `float(v)` : un texte est lu.
#[track_caller]
pub fn float_v(v: &Val) -> f64 {
    match v {
        Val::Str(s) => s.trim().parse().unwrap_or_else(|_| panic!("ValueError: could not convert string to float: {}", v.repr())),
        _ => v.f(),
    }
}

/// `a // b` entre entiers.
#[track_caller]
pub fn floordiv_i(a: i64, b: i64) -> i64 {
    if b == 0 {
        panic!("ZeroDivisionError: {a} // 0")
    }
    a.div_euclid(b) - ((b < 0 && a.rem_euclid(b) != 0) as i64)
}
/// `a % b` entre entiers : du signe de b.
#[track_caller]
pub fn mod_i(a: i64, b: i64) -> i64 {
    if b == 0 {
        panic!("ZeroDivisionError: {a} % 0")
    }
    let r = a % b;
    if r != 0 && (r < 0) != (b < 0) {
        r + b
    } else {
        r
    }
}
/// `divmod(a, b)` entre flottants (float_divmod de CPython).
#[track_caller]
fn divmod_f(a: f64, b: f64) -> (f64, f64) {
    if b == 0.0 {
        panic!("ZeroDivisionError: float modulo ({a} % 0.0)")
    }
    let mut m = a % b; // fmod
    let mut div = (a - m) / b;
    if m != 0.0 {
        if (b < 0.0) != (m < 0.0) {
            m += b;
            div -= 1.0;
        }
    } else {
        m = 0.0f64.copysign(b);
    }
    let fl = if div != 0.0 {
        let f = div.floor();
        if div - f > 0.5 {
            f + 1.0
        } else {
            f
        }
    } else {
        0.0f64.copysign(a / b)
    };
    (fl, m)
}
/// `a // b` entre flottants.
#[track_caller]
pub fn floordiv_f(a: f64, b: f64) -> f64 {
    divmod_f(a, b).0
}
/// `a % b` entre flottants : du signe de b.
#[track_caller]
pub fn mod_f(a: f64, b: f64) -> f64 {
    divmod_f(a, b).1
}

/// `sum(…)` de flottants. Depuis Python 3.12, la somme est compensée (Neumaier) à partir du deuxième terme :
/// le premier est ajouté au 0 de départ sans compensation.
pub fn sum(it: impl IntoIterator<Item = f64>) -> f64 {
    let mut it = it.into_iter();
    let Some(x0) = it.next() else { return 0.0 };
    let (mut s, mut c) = (0.0 + x0, 0.0f64);
    for x in it {
        let t = s + x;
        if s.abs() >= x.abs() {
            c += (s - t) + x
        } else {
            c += (x - t) + s
        }
        s = t;
    }
    if c != 0.0 && c.is_finite() {
        s += c
    }
    s
}
/// `sum(…)` de valeurs : entiers exacts tant qu'il n'y a que des entiers, puis flottants comme `sum`
/// (un entier qui arrive après un flottant s'ajoute sans compensation, comme dans CPython).
#[track_caller]
pub fn sum_v(it: impl IntoIterator<Item = Val>) -> Val {
    let mut it = it.into_iter();
    let mut i: i64 = 0;
    let premier = loop {
        match it.next() {
            None => return Val::Int(i),
            Some(Val::Int(x)) => i = i.checked_add(x).expect("OverflowError: sum d'entiers au-delà de 64 bits"),
            Some(Val::Bool(b)) => i += b as i64,
            Some(v) => break v,
        }
    };
    let (mut s, mut c) = (i as f64 + premier.f(), 0.0f64);
    for v in it {
        match v {
            Val::Float(x) => {
                let t = s + x;
                if s.abs() >= x.abs() {
                    c += (s - t) + x
                } else {
                    c += (x - t) + s
                }
                s = t;
            }
            autre => s += autre.f(),
        }
    }
    if c != 0.0 && c.is_finite() {
        s += c
    }
    Val::Float(s)
}

/// `math.hypot(x, y)` (vector_norm de CPython : mise à l'échelle sans perte, carrés en double précision étendue,
/// correction de la racine). La libm rend parfois le flottant voisin.
pub fn hypot(x: f64, y: f64) -> f64 {
    norme(&mut [x.abs(), y.abs()])
}
/// `min(math.hypot(x - px, y - py) for px, py in pts)`, le même flottant, sans calculer hypot (lent : celui de CPython)
/// pour chaque point : les carrés des distances écartent d'abord les points plus loin que le plus proche (avec une marge
/// relative de 1e-9, bien au-delà des arrondis : hypot se trompe de moins d'un ulp). None si pts est vide.
pub fn min_hypot(x: f64, y: f64, pts: &[(f64, f64)]) -> Option<f64> {
    let d2 = |&(px, py): &(f64, f64)| (x - px) * (x - px) + (y - py) * (y - py);
    let m = pts.iter().map(d2).fold(f64::INFINITY, f64::min);
    if !m.is_finite() {
        return min_f(pts.iter().map(|&(px, py)| hypot(x - px, y - py))); // (vide, ou des NaN, des infinis : sans détour)
    }
    let seuil = m * (1.0 + 1e-9);
    min_f(pts.iter().filter(|p| d2(p) <= seuil).map(|&(px, py)| hypot(x - px, y - py)))
}

/// `math.hypot(x, y, z)`.
pub fn hypot3(x: f64, y: f64, z: f64) -> f64 {
    norme(&mut [x.abs(), y.abs(), z.abs()])
}
/// `math.dist(p, q)` en deux dimensions.
pub fn dist(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    norme(&mut [(ax - bx).abs(), (ay - by).abs()])
}

/// x + y exactement : (somme arrondie, erreur). Demande |x| >= |y|.
fn dl_fast_sum(a: f64, b: f64) -> (f64, f64) {
    let hi = a + b;
    (hi, b - (hi - a))
}
/// x * y exactement (FMA) : (produit arrondi, erreur).
fn dl_mul(x: f64, y: f64) -> (f64, f64) {
    let z = x * y;
    (z, x.mul_add(y, -z))
}

/// vector_norm (Modules/mathmodule.c, Python 3.12+) : v tient des valeurs absolues.
fn norme(v: &mut [f64]) -> f64 {
    let mut max = 0.0f64;
    let mut nan = false;
    for &x in v.iter() {
        nan |= x.is_nan();
        if x > max {
            max = x
        }
    }
    if max.is_infinite() {
        return max;
    }
    if nan {
        return f64::NAN;
    }
    if max == 0.0 || v.len() <= 1 {
        return max;
    }
    let (_, max_e) = frexp(max);
    if max_e < -1023 {
        // sous-normaux : on remonte tout, on calcule, on redescend
        for x in v.iter_mut() {
            *x /= f64::MIN_POSITIVE
        }
        return f64::MIN_POSITIVE * norme(v);
    }
    let scale = ldexp(1.0, -max_e);
    let (mut csum, mut frac1, mut frac2) = (1.0f64, 0.0f64, 0.0f64);
    for &x in v.iter() {
        let x = x * scale;
        let (hi, lo) = dl_mul(x, x);
        let (s, e) = dl_fast_sum(csum, hi);
        csum = s;
        frac1 += e;
        frac2 += lo;
    }
    let mut h = (csum - 1.0 + (frac1 + frac2)).sqrt();
    let (hi, lo) = dl_mul(-h, h);
    let (s, e) = dl_fast_sum(csum, hi);
    csum = s;
    frac1 += e;
    frac2 += lo;
    let x = csum - 1.0 + (frac1 + frac2);
    h += x / (2.0 * h);
    h / scale
}

/// `math.frexp(x)` : (mantisse dans [0,5 ; 1[, exposant).
pub fn frexp(x: f64) -> (f64, i32) {
    if x == 0.0 || !x.is_finite() {
        return (x, 0);
    }
    let bits = x.to_bits();
    let e = ((bits >> 52) & 0x7ff) as i32;
    if e == 0 {
        // sous-normal : on le normalise d'abord
        let (m, e2) = frexp(x * (1u64 << 54) as f64);
        return (m, e2 - 54);
    }
    (f64::from_bits((bits & !(0x7ffu64 << 52)) | (1022u64 << 52)), e - 1022)
}
/// `math.ldexp(x, e)` pour les exposants ordinaires.
pub fn ldexp(x: f64, e: i32) -> f64 {
    if (-1000..=1000).contains(&e) {
        x * f64::from_bits(((1023 + e) as u64) << 52)
    } else {
        x * 2f64.powi(e)
    }
}

/// `min(it, key=f)` : le premier des plus petits (None si la suite est vide).
pub fn min_by_key<T, K: PartialOrd>(it: impl IntoIterator<Item = T>, mut f: impl FnMut(&T) -> K) -> Option<T> {
    let mut it = it.into_iter();
    let mut meilleur = it.next()?;
    let mut k = f(&meilleur);
    for x in it {
        let kx = f(&x);
        if kx < k {
            meilleur = x;
            k = kx;
        }
    }
    Some(meilleur)
}
/// `max(it, key=f)` : le premier des plus grands (Rust rendrait le dernier).
pub fn max_by_key<T, K: PartialOrd>(it: impl IntoIterator<Item = T>, mut f: impl FnMut(&T) -> K) -> Option<T> {
    let mut it = it.into_iter();
    let mut meilleur = it.next()?;
    let mut k = f(&meilleur);
    for x in it {
        let kx = f(&x);
        if kx > k {
            meilleur = x;
            k = kx;
        }
    }
    Some(meilleur)
}
/// `min(it)` de flottants (le premier des plus petits ; None si vide).
pub fn min_f(it: impl IntoIterator<Item = f64>) -> Option<f64> {
    min_by_key(it, |x| *x)
}
/// `max(it)` de flottants.
pub fn max_f(it: impl IntoIterator<Item = f64>) -> Option<f64> {
    max_by_key(it, |x| *x)
}

/// `sorted(v, key=f)` : tri stable, la clé calculée une fois par élément. Des clés qui ne se comparent pas
/// (NaN, None contre un nombre) : TypeError en Python, arrêt ici.
#[track_caller]
pub fn sorted_by_key<T, K: PartialOrd>(v: Vec<T>, mut f: impl FnMut(&T) -> K) -> Vec<T> {
    let mut paires: Vec<(K, T)> = v.into_iter().map(|x| (f(&x), x)).collect();
    let mut mauvais = false;
    paires.sort_by(|a, b| {
        a.0.partial_cmp(&b.0).unwrap_or_else(|| {
            mauvais = true;
            Ordering::Equal
        })
    });
    if mauvais {
        panic!("TypeError: sorted : des clés ne se comparent pas")
    }
    paires.into_iter().map(|p| p.1).collect()
}
/// `sorted(v, key=f, reverse=True)` : stable aussi (les égaux gardent leur ordre, comme en Python).
#[track_caller]
pub fn sorted_by_key_rev<T, K: PartialOrd>(v: Vec<T>, mut f: impl FnMut(&T) -> K) -> Vec<T> {
    let mut paires: Vec<(K, T)> = v.into_iter().map(|x| (f(&x), x)).collect();
    paires.sort_by(|a, b| b.0.partial_cmp(&a.0).expect("TypeError: sorted : des clés ne se comparent pas"));
    paires.into_iter().map(|p| p.1).collect()
}
