//! Le portage de game/tactics/jsmath.py.
//!
//! L'arithmétique de JavaScript (V8), pour refaire à l'identique ce que calcule le navigateur
//! (plan_ville.rs : le plan des villes de web/js/carte/villes.js).
//!
//! - entiers sur 32 bits (Math.imul, |0, >>>), hachages hash2 et hashS (FNV-1a), tirage alea (mulberry32) ;
//! - Math.hypot (somme de Kahan, comme V8), Math.round (moitiés vers +∞) ;
//! - Math.sin, Math.cos, Math.atan2 : fdlibm, que V8 emploie (la libm du système diffère au dernier bit une fois sur
//!   vingt à une fois sur six, et un plan peut basculer sur une égalité).
//!
//! Vérifié bit à bit contre Node sur 200 000 tirages (tests/test_plan_ville.py vérifie les plans eux-mêmes) ; le Rust
//! l'est contre le Python (tests/plans.rs, références de outils/jumeau/plans_ref.py).

use crate::py;

/// Les 32 bits bas d'un entier de Python, lus en entier signé.
fn _i32(x: i64) -> i32 {
    x as i32
}

/// Math.imul.
fn _imul(a: i32, b: i32) -> i32 {
    a.wrapping_mul(b)
}

/// v | 0 de JavaScript (troncature vers zéro, puis modulo 2^32). Un flottant passe d'abord par `py::int`.
fn _toi32(v: i64) -> i32 {
    _i32(v)
}

pub fn hashS(s: &str) -> i64 {
    let mut h: u32 = 2166136261;
    for ch in s.chars() {
        h = _imul((h ^ ch as u32) as i32, 16777619) as u32;
    }
    h as i64
}

/// hash2(i, j, k) ; le k de Python vaut 0 par défaut.
pub fn hash2(i: i64, j: i64, k: i64) -> f64 {
    let n = _imul(_toi32(i), 374761393).wrapping_add(_imul(_toi32(j), 668265263)).wrapping_add(_imul(_toi32(k), 1442695041));
    let n = _imul(n ^ ((n as u32) >> 13) as i32, 1274126177);
    ((n ^ ((n as u32) >> 16) as i32) as u32) as f64 / 4294967296.0
}

/// mulberry32, comme lib.js : alea(graine).R() rend un flottant dans [0, 1).
pub struct Alea {
    st: i32,
}

pub fn alea(a: i64) -> Alea {
    Alea { st: _toi32(a) }
}

impl Alea {
    pub fn R(&mut self) -> f64 {
        let a = self.st.wrapping_add(0x6D2B79F5);
        self.st = a;
        let t = _imul(a ^ ((a as u32) >> 15) as i32, 1 | a);
        let t = t.wrapping_add(_imul(t ^ ((t as u32) >> 7) as i32, 61 | t)) ^ t;
        ((t ^ ((t as u32) >> 14) as i32) as u32) as f64 / 4294967296.0
    }
}

/// Math.hypot de V8 (somme de Kahan des carrés rapportés au plus grand), pour tomber sur les mêmes bits.
/// (à deux termes, la compensation de Kahan est nulle : un carré vaut exactement 1)
pub fn hypot(x: f64, y: f64) -> f64 {
    let (mut x, mut y) = (x.abs(), y.abs());
    if x < y {
        (x, y) = (y, x);
    }
    if x == 0.0 {
        return 0.0;
    }
    let r = y / x;
    (1.0 + r * r).sqrt() * x
}

/// Math.hypot à trois termes et plus (le `hypot(x, y, *more)` de Python quand more n'est pas vide).
pub fn hypot_n(v: &[f64]) -> f64 {
    let ab: Vec<f64> = v.iter().map(|v| v.abs()).collect();
    let mx = py::max_f(ab.iter().copied()).unwrap();
    if mx == 0.0 {
        return 0.0;
    }
    let (mut s, mut comp) = (0.0f64, 0.0f64);
    for v in ab {
        let n = v / mx;
        let summand = n * n - comp;
        let pre = s + summand;
        comp = (pre - s) - summand;
        s = pre;
    }
    s.sqrt() * mx
}

/// Math.round : au plus proche, les moitiés vers +∞.
pub fn jround(x: f64) -> i64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f as i64 + 1
    } else {
        f as i64
    }
}

// ---------------------------------------------------------------------- fdlibm (V8 : src/base/ieee754.cc)
/// Le mot haut (signé) d'un flottant.
fn _hi(x: f64) -> i64 {
    (x.to_bits() as i64) >> 32
}

const fn _from_hi(h: i64) -> f64 {
    f64::from_bits((h << 32) as u64)
}

/// |x| < _lim(h) ⟺ mot haut de |x| ≤ h (les comparaisons de fdlibm sur les mots, faites sur les flottants).
const fn _lim(h: i64) -> f64 {
    _from_hi(h + 1)
}

pub const S1: f64 = -1.66666666666666324348e-01;
pub const S2: f64 = 8.33333333332248946124e-03;
pub const S3: f64 = -1.98412698298579493134e-04;
pub const S4: f64 = 2.75573137070700676789e-06;
pub const S5: f64 = -2.50507602534068634195e-08;
pub const S6: f64 = 1.58969099521155010221e-10;
pub const C1: f64 = 4.16666666666666019037e-02;
pub const C2: f64 = -1.38888888888741095749e-03;
pub const C3: f64 = 2.48015872894767294178e-05;
pub const C4: f64 = -2.75573143513906633035e-07;
pub const C5: f64 = 2.08757232129817482790e-09;
pub const C6: f64 = -1.13596475577881948265e-11;
const _T27: f64 = 1.0 / 134217728.0; // 2.0 ** -27 : mot haut < 0x3e400000
const _PIO4: f64 = _lim(0x3fe921fb);
const _3PIO4: f64 = _from_hi(0x4002d97c);
const _MED: f64 = _lim(0x413921fb);
const _KC1: f64 = _from_hi(0x3FD33333);
const _KC2: f64 = _lim(0x3fe90000);

fn _ksin(x: f64, y: f64, iy: i64) -> f64 {
    if -_T27 < x && x < _T27 {
        return x;
    }
    let z = x * x;
    let v = z * x;
    let r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
    if iy == 0 {
        return x + v * (S1 + z * r);
    }
    x - ((z * (0.5 * y - v * r) - y) - v * S1)
}

fn _kcos(x: f64, y: f64) -> f64 {
    let ax = if x < 0.0 { -x } else { x };
    if ax < _T27 {
        return 1.0;
    }
    let z = x * x;
    let r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    if ax < _KC1 {
        return 1.0 - (0.5 * z - (z * r - x * y));
    }
    let qx = if ax >= _KC2 { 0.28125 } else { _from_hi(_hi(ax) - 0x00200000) };
    let hz = 0.5 * z - qx;
    let a = 1.0 - qx;
    a - (hz - (z * r - x * y))
}

pub const invpio2: f64 = 6.36619772367581382433e-01;
pub const pio2_1: f64 = 1.57079632673412561417e+00;
pub const pio2_1t: f64 = 6.07710050650619224932e-11;
pub const pio2_2: f64 = 6.07710050630396597660e-11;
pub const pio2_2t: f64 = 2.02226624879595063154e-21;
pub const pio2_3: f64 = 2.02226624871116645580e-21;
pub const pio2_3t: f64 = 8.47842766036889956997e-32;
const _NPIO2: [i64; 32] = [
    0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A,
    0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
    0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC,
    0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB,
];
/// _NPIO2F[n] du Python : les bornes des |x| dont le mot haut vaut npio2_hw[n].
fn _NPIO2F(n: usize) -> (f64, f64) {
    (_from_hi(_NPIO2[n]), _from_hi(_NPIO2[n] + 1))
}
const _PIO2W: (f64, f64) = (_from_hi(0x3ff921fb), _from_hi(0x3ff921fc));

/// __ieee754_rem_pio2 pour π/4 < |x| ≤ 2^19·π/2 : (n, y0, y1), x = n·π/2 + y0 + y1.
fn _rem_pio2(x: f64) -> (i64, f64, f64) {
    let mut t = if x < 0.0 { -x } else { x };
    if t < _3PIO4 {
        let pres = _PIO2W.0 <= t && t < _PIO2W.1;
        if x > 0.0 {
            let mut z = x - pio2_1;
            if !pres {
                let y0 = z - pio2_1t;
                return (1, y0, (z - y0) - pio2_1t);
            }
            z -= pio2_2;
            let y0 = z - pio2_2t;
            return (1, y0, (z - y0) - pio2_2t);
        }
        let mut z = x + pio2_1;
        if !pres {
            let y0 = z + pio2_1t;
            return (-1, y0, (z - y0) + pio2_1t);
        }
        z += pio2_2;
        let y0 = z + pio2_2t;
        return (-1, y0, (z - y0) + pio2_2t);
    }
    let n = py::int(t * invpio2 + 0.5);
    let fn_ = n as f64;
    let mut r = t - fn_ * pio2_1;
    let mut w = fn_ * pio2_1t;
    let mut y0;
    if n < 32 && !(_NPIO2F(n as usize - 1).0 <= t && t < _NPIO2F(n as usize - 1).1) {
        y0 = r - w;
    } else {
        let j = py::frexp(t).1;
        y0 = r - w;
        if j - py::frexp(y0).1 > 16 {
            t = r;
            w = fn_ * pio2_2;
            r = t - w;
            w = fn_ * pio2_2t - ((t - r) - w);
            y0 = r - w;
            if j - py::frexp(y0).1 > 49 {
                t = r;
                w = fn_ * pio2_3;
                r = t - w;
                w = fn_ * pio2_3t - ((t - r) - w);
                y0 = r - w;
            }
        }
    }
    let y1 = (r - y0) - w;
    if x < 0.0 {
        return (-n, -y0, -y1);
    }
    (n, y0, y1)
}

/// Math.sin de V8 (fdlibm).
pub fn sin(x: f64) -> f64 {
    let ax = if x < 0.0 { -x } else { x };
    if ax < _PIO4 {
        return _ksin(x, 0.0, 0);
    }
    if !(ax < _MED) {
        return x.sin(); // (jamais si loin dans un plan)
    }
    let (n, y0, y1) = _rem_pio2(x);
    match n & 3 {
        0 => _ksin(y0, y1, 1),
        1 => _kcos(y0, y1),
        2 => -_ksin(y0, y1, 1),
        _ => -_kcos(y0, y1),
    }
}

/// Math.cos de V8 (fdlibm).
pub fn cos(x: f64) -> f64 {
    let ax = if x < 0.0 { -x } else { x };
    if ax < _PIO4 {
        return _kcos(x, 0.0);
    }
    if !(ax < _MED) {
        return x.cos();
    }
    let (n, y0, y1) = _rem_pio2(x);
    match n & 3 {
        0 => _kcos(y0, y1),
        1 => -_ksin(y0, y1, 1),
        2 => -_kcos(y0, y1),
        _ => _ksin(y0, y1, 1),
    }
}

pub const ATANHI: [f64; 4] = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
pub const ATANLO: [f64; 4] = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
pub const AT: [f64; 11] = [
    3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
    9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
    4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02,
];
const _A66: f64 = _from_hi(0x44100000);
const _A04: f64 = _from_hi(0x3fdc0000);
const _A07: f64 = _from_hi(0x3fe60000);
const _A11: f64 = _from_hi(0x3ff30000);
const _A24: f64 = _from_hi(0x40038000);

pub fn atan(x: f64) -> f64 {
    let neg = x < 0.0;
    let ax = if neg { -x } else { x };
    if !(ax < _A66) {
        if x != x {
            return x + x;
        }
        return if neg { -ATANHI[3] - ATANLO[3] } else { ATANHI[3] + ATANLO[3] };
    }
    let mut x = x;
    let idx: i64;
    if ax < _A04 {
        if ax < _T27 {
            return x;
        }
        idx = -1;
    } else {
        x = ax;
        if ax < _A11 {
            if ax < _A07 {
                (idx, x) = (0, (2.0 * x - 1.0) / (2.0 + x));
            } else {
                (idx, x) = (1, (x - 1.0) / (x + 1.0));
            }
        } else if ax < _A24 {
            (idx, x) = (2, (x - 1.5) / (1.0 + 1.5 * x));
        } else {
            (idx, x) = (3, -1.0 / x);
        }
    }
    let z = x * x;
    let w = z * z;
    let s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
    let s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
    if idx < 0 {
        return x - x * (s1 + s2);
    }
    let z = ATANHI[idx as usize] - ((x * (s1 + s2) - ATANLO[idx as usize]) - x);
    if neg {
        -z
    } else {
        z
    }
}

pub const PI: f64 = 3.1415926535897931160E+00;
pub const PI_O_2: f64 = 1.5707963267948965580E+00;
pub const PI_LO: f64 = 1.2246467991473531772E-16;

/// Math.atan2 de V8 (fdlibm).
pub fn atan2(y: f64, x: f64) -> f64 {
    if x != x || y != y {
        return x + y;
    }
    if x == 1.0 {
        return atan(y);
    }
    if x.is_infinite() || y.is_infinite() {
        return y.atan2(x);
    }
    let mut m = (if y.is_sign_negative() { 1 } else { 0 }) | (if x.is_sign_negative() { 2 } else { 0 });
    if y == 0.0 {
        return if m < 2 { y } else if m == 2 { PI } else { -PI };
    }
    if x == 0.0 {
        return if m & 1 != 0 { -PI_O_2 } else { PI_O_2 };
    }
    let k = py::frexp(y).1 - py::frexp(x).1; // ((iy - ix) >> 20, à une unité près : seuils de ±60, sans effet ici)
    let z;
    if k > 60 {
        z = PI_O_2 + 0.5 * PI_LO;
        m &= 1;
    } else if m & 2 != 0 && k < -60 {
        z = 0.0;
    } else {
        z = atan((y / x).abs());
    }
    match m {
        0 => z,
        1 => -z,
        2 => PI - (z - PI_LO),
        _ => (z - PI_LO) - PI,
    }
}
