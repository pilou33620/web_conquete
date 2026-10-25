"""L'arithmétique de JavaScript (V8) en Python, pour refaire à l'identique ce que calcule le navigateur
(plan_ville.py : le plan des villes de web/js/carte/villes.js).

- entiers sur 32 bits (Math.imul, |0, >>>), hachages hash2 et hashS (FNV-1a), tirage alea (mulberry32) ;
- Math.hypot (somme de Kahan, comme V8), Math.round (moitiés vers +∞) ;
- Math.sin, Math.cos, Math.atan2 : fdlibm, que V8 emploie (la libm du système diffère au dernier bit une fois sur
  vingt à une fois sur six, et un plan peut basculer sur une égalité).
Vérifié bit à bit contre Node sur 200 000 tirages (tests/test_plan_ville.py vérifie les plans eux-mêmes).
"""
import math
import struct

def _i32(x):
    x &= 0xFFFFFFFF
    return x - 0x100000000 if x & 0x80000000 else x


def _imul(a, b):
    return _i32((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF))


def _toi32(v):
    """v | 0 de JavaScript (troncature vers zéro, puis modulo 2^32)."""
    return _i32(int(v))


def hashS(s):
    h = 2166136261
    for ch in s:
        h = _imul(h ^ ord(ch), 16777619)
    return h & 0xFFFFFFFF


def hash2(i, j, k=0):
    n = _i32(_imul(_toi32(i), 374761393) + _imul(_toi32(j), 668265263) + _imul(_toi32(k), 1442695041))
    n = _imul(n ^ ((n & 0xFFFFFFFF) >> 13), 1274126177)
    return ((n ^ ((n & 0xFFFFFFFF) >> 16)) & 0xFFFFFFFF) / 4294967296


def alea(a):
    """mulberry32, comme lib.js : alea(graine)() rend un flottant dans [0, 1)."""
    st = [_toi32(a)]

    def R():
        a = _i32(st[0] + 0x6D2B79F5)
        st[0] = a
        t = _imul(a ^ ((a & 0xFFFFFFFF) >> 15), 1 | a)
        t = _i32(t + _imul(t ^ ((t & 0xFFFFFFFF) >> 7), 61 | t)) ^ t
        return ((t ^ ((t & 0xFFFFFFFF) >> 14)) & 0xFFFFFFFF) / 4294967296
    return R


def hypot(x, y, *more):
    """Math.hypot de V8 (somme de Kahan des carrés rapportés au plus grand), pour tomber sur les mêmes bits."""
    if not more:   # (à deux termes, la compensation de Kahan est nulle : un carré vaut exactement 1)
        x, y = abs(x), abs(y)
        if x < y:
            x, y = y, x
        if x == 0:
            return 0.0
        r = y / x
        return math.sqrt(1.0 + r * r) * x
    ab = [abs(v) for v in (x, y) + more]
    mx = max(ab)
    if mx == 0:
        return 0.0
    s = comp = 0.0
    for v in ab:
        n = v / mx
        summand = n * n - comp
        pre = s + summand
        comp = (pre - s) - summand
        s = pre
    return math.sqrt(s) * mx


def jround(x):
    """Math.round : au plus proche, les moitiés vers +∞."""
    f = math.floor(x)
    return f + 1 if x - f >= 0.5 else f


# ---------------------------------------------------------------------- fdlibm (V8 : src/base/ieee754.cc)
_pk, _up = struct.Struct('<d').pack, struct.Struct('<q').unpack
_pq, _ud = struct.Struct('<q').pack, struct.Struct('<d').unpack
_frexp = math.frexp


def _hi(x):
    return _up(_pk(x))[0] >> 32


def _from_hi(h):
    return _ud(_pq(h << 32))[0]


def _lim(h):
    """|x| < _lim(h) ⟺ mot haut de |x| ≤ h (les comparaisons de fdlibm sur les mots, faites sur les flottants)."""
    return _from_hi(h + 1)


S1, S2, S3, S4, S5, S6 = (-1.66666666666666324348e-01, 8.33333333332248946124e-03, -1.98412698298579493134e-04,
                          2.75573137070700676789e-06, -2.50507602534068634195e-08, 1.58969099521155010221e-10)
C1, C2, C3, C4, C5, C6 = (4.16666666666666019037e-02, -1.38888888888741095749e-03, 2.48015872894767294178e-05,
                          -2.75573143513906633035e-07, 2.08757232129817482790e-09, -1.13596475577881948265e-11)
_T27 = 2.0 ** -27                                     # mot haut < 0x3e400000
_PIO4, _3PIO4, _MED = _lim(0x3fe921fb), _from_hi(0x4002d97c), _lim(0x413921fb)
_KC1, _KC2 = _from_hi(0x3FD33333), _lim(0x3fe90000)


def _ksin(x, y, iy):
    if -_T27 < x < _T27:
        return x
    z = x * x
    v = z * x
    r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))
    if iy == 0:
        return x + v * (S1 + z * r)
    return x - ((z * (0.5 * y - v * r) - y) - v * S1)


def _kcos(x, y):
    ax = -x if x < 0 else x
    if ax < _T27:
        return 1.0
    z = x * x
    r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
    if ax < _KC1:
        return 1.0 - (0.5 * z - (z * r - x * y))
    qx = 0.28125 if ax >= _KC2 else _from_hi((_hi(ax)) - 0x00200000)
    hz = 0.5 * z - qx
    a = 1.0 - qx
    return a - (hz - (z * r - x * y))


invpio2, pio2_1, pio2_1t = 6.36619772367581382433e-01, 1.57079632673412561417e+00, 6.07710050650619224932e-11
pio2_2, pio2_2t = 6.07710050630396597660e-11, 2.02226624879595063154e-21
pio2_3, pio2_3t = 2.02226624871116645580e-21, 8.47842766036889956997e-32
_NPIO2 = (0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A,
          0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
          0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC,
          0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB)
_NPIO2F = tuple((_from_hi(h), _from_hi(h + 1)) for h in _NPIO2)   # |x| dont le mot haut vaut npio2_hw[n - 1]
_PIO2W = _from_hi(0x3ff921fb), _from_hi(0x3ff921fc)


def _rem_pio2(x):
    """__ieee754_rem_pio2 pour π/4 < |x| ≤ 2^19·π/2 : (n, y0, y1), x = n·π/2 + y0 + y1."""
    t = -x if x < 0 else x
    if t < _3PIO4:
        pres = _PIO2W[0] <= t < _PIO2W[1]
        if x > 0:
            z = x - pio2_1
            if not pres:
                y0 = z - pio2_1t
                return 1, y0, (z - y0) - pio2_1t
            z -= pio2_2
            y0 = z - pio2_2t
            return 1, y0, (z - y0) - pio2_2t
        z = x + pio2_1
        if not pres:
            y0 = z + pio2_1t
            return -1, y0, (z - y0) + pio2_1t
        z += pio2_2
        y0 = z + pio2_2t
        return -1, y0, (z - y0) + pio2_2t
    n = int(t * invpio2 + 0.5)
    fn = float(n)
    r = t - fn * pio2_1
    w = fn * pio2_1t
    if n < 32 and not (_NPIO2F[n - 1][0] <= t < _NPIO2F[n - 1][1]):
        y0 = r - w
    else:
        j = _frexp(t)[1]
        y0 = r - w
        if j - _frexp(y0)[1] > 16:
            t = r
            w = fn * pio2_2
            r = t - w
            w = fn * pio2_2t - ((t - r) - w)
            y0 = r - w
            if j - _frexp(y0)[1] > 49:
                t = r
                w = fn * pio2_3
                r = t - w
                w = fn * pio2_3t - ((t - r) - w)
                y0 = r - w
    y1 = (r - y0) - w
    if x < 0:
        return -n, -y0, -y1
    return n, y0, y1


def sin(x):
    """Math.sin de V8 (fdlibm)."""
    ax = -x if x < 0 else x
    if ax < _PIO4:
        return _ksin(x, 0.0, 0)
    if not ax < _MED:
        return math.sin(x)   # (jamais si loin dans un plan)
    n, y0, y1 = _rem_pio2(x)
    n &= 3
    if n == 0:
        return _ksin(y0, y1, 1)
    if n == 1:
        return _kcos(y0, y1)
    if n == 2:
        return -_ksin(y0, y1, 1)
    return -_kcos(y0, y1)


def cos(x):
    """Math.cos de V8 (fdlibm)."""
    ax = -x if x < 0 else x
    if ax < _PIO4:
        return _kcos(x, 0.0)
    if not ax < _MED:
        return math.cos(x)
    n, y0, y1 = _rem_pio2(x)
    n &= 3
    if n == 0:
        return _kcos(y0, y1)
    if n == 1:
        return -_ksin(y0, y1, 1)
    if n == 2:
        return -_kcos(y0, y1)
    return _ksin(y0, y1, 1)


ATANHI = (4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00)
ATANLO = (2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17)
AT = (3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
      9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
      4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02)
_A66, _A04, _A07, _A11, _A24 = (_from_hi(0x44100000), _from_hi(0x3fdc0000), _from_hi(0x3fe60000), _from_hi(0x3ff30000),
                                _from_hi(0x40038000))


def atan(x):
    neg = x < 0
    ax = -x if neg else x
    if not ax < _A66:
        if x != x:
            return x + x
        return -ATANHI[3] - ATANLO[3] if neg else ATANHI[3] + ATANLO[3]
    if ax < _A04:
        if ax < _T27:
            return x
        idx = -1
    else:
        x = ax
        if ax < _A11:
            if ax < _A07:
                idx, x = 0, (2.0 * x - 1.0) / (2.0 + x)
            else:
                idx, x = 1, (x - 1.0) / (x + 1.0)
        elif ax < _A24:
            idx, x = 2, (x - 1.5) / (1.0 + 1.5 * x)
        else:
            idx, x = 3, -1.0 / x
    z = x * x
    w = z * z
    s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))))
    s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))))
    if idx < 0:
        return x - x * (s1 + s2)
    z = ATANHI[idx] - ((x * (s1 + s2) - ATANLO[idx]) - x)
    return -z if neg else z


PI, PI_O_2, PI_LO = 3.1415926535897931160E+00, 1.5707963267948965580E+00, 1.2246467991473531772E-16


def atan2(y, x):
    """Math.atan2 de V8 (fdlibm)."""
    if x != x or y != y:
        return x + y
    if x == 1.0:
        return atan(y)
    if math.isinf(x) or math.isinf(y):
        return math.atan2(y, x)
    m = (1 if math.copysign(1.0, y) < 0 else 0) | (2 if math.copysign(1.0, x) < 0 else 0)
    if y == 0:
        return y if m < 2 else (PI if m == 2 else -PI)
    if x == 0:
        return -PI_O_2 if m & 1 else PI_O_2
    k = _frexp(y)[1] - _frexp(x)[1]   # ((iy - ix) >> 20, à une unité près : seuils de ±60, sans effet ici)
    if k > 60:
        z = PI_O_2 + 0.5 * PI_LO
        m &= 1
    elif m & 2 and k < -60:
        z = 0.0
    else:
        z = atan(abs(y / x))
    if m == 0:
        return z
    if m == 1:
        return -z
    if m == 2:
        return PI - (z - PI_LO)
    return (z - PI_LO) - PI
