//! `random.Random` de Python, au bit près : Mersenne Twister (MT19937), la graine d'un entier ou d'un texte
//! (SHA-512, comme `random.seed(str)`), et les tirages que le jeu emploie. La même graine rend la même carte,
//! la même bataille, le même tour qu'avant le portage. Vérifié contre Python : tests/references/py.json.

use sha2::{Digest, Sha512};

thread_local! {
    /// La trace des tirages (CONQUETE_TRACE_HASARD=fichier) : une ligne par tirage élémentaire, « r valeur lieu »
    /// ou « b valeur lieu », à comparer à celle du jumeau Python (outils/jumeau/commun.py) pour trouver le
    /// premier tirage qui diffère quand une référence ne tombe pas juste.
    static TRACE: std::cell::RefCell<Option<std::io::BufWriter<std::fs::File>>> = std::cell::RefCell::new(
        std::env::var_os("CONQUETE_TRACE_HASARD").and_then(|f| std::fs::File::create(f).ok()).map(std::io::BufWriter::new));
}
fn tracer(sorte: char, valeur: &dyn std::fmt::Display, lieu: &std::panic::Location) {
    TRACE.with(|t| {
        if let Some(f) = t.borrow_mut().as_mut() {
            use std::io::Write;
            let _ = writeln!(f, "{sorte} {valeur} {}:{}", lieu.file(), lieu.line());
        }
    })
}
/// Vide la trace sur le disque (à appeler avant de sortir quand on la relève).
pub fn vider_trace() {
    TRACE.with(|t| {
        if let Some(f) = t.borrow_mut().as_mut() {
            let _ = std::io::Write::flush(f);
        }
    })
}

/// Recommence la trace (le fichier est vidé) : pour ne relever que les tirages d'un moment (un mois de campagne).
pub fn recommencer_trace() {
    TRACE.with(|t| {
        if t.borrow_mut().take().is_some() {
            // (l'ancienne trace vidée et fermée d'abord : sinon elle écrirait sa fin dans le fichier recommencé)
            *t.borrow_mut() = std::env::var_os("CONQUETE_TRACE_HASARD")
                .and_then(|f| std::fs::File::create(f).ok())
                .map(std::io::BufWriter::new);
        }
    })
}

const N: usize = 624;
const M: usize = 397;

#[derive(Clone)]
pub struct Random {
    mt: [u32; N],
    idx: usize,
    gauss_next: Option<f64>,
}

impl Random {
    /// `random.Random(graine)` d'un entier (son signe ne compte pas).
    pub fn new(graine: i64) -> Random {
        let a = graine.unsigned_abs();
        let cle: Vec<u32> = if a >> 32 != 0 { vec![a as u32, (a >> 32) as u32] } else { vec![a as u32] };
        Random::par_tableau(&cle)
    }
    /// `random.Random("texte")` : l'entier fait du texte suivi de son SHA-512.
    pub fn new_str(graine: &str) -> Random {
        let mut octets = graine.as_bytes().to_vec();
        octets.extend_from_slice(&Sha512::digest(graine.as_bytes()));
        // grand entier gros-boutiste → mots de 32 bits, du poids faible au poids fort
        let mut cle: Vec<u32> = octets.rchunks(4).map(|m| m.iter().fold(0u32, |a, &o| (a << 8) | o as u32)).collect();
        while cle.len() > 1 && *cle.last().unwrap() == 0 {
            cle.pop();
        }
        Random::par_tableau(&cle)
    }
    /// `random.Random()` : graine prise à l'horloge et à l'adresse d'une variable (pas de dé rejouable).
    pub fn new_hasard() -> Random {
        Random::new(graine_hasard())
    }

    fn init(s: u32) -> [u32; N] {
        let mut mt = [0u32; N];
        mt[0] = s;
        for i in 1..N {
            mt[i] = 1812433253u32.wrapping_mul(mt[i - 1] ^ (mt[i - 1] >> 30)).wrapping_add(i as u32);
        }
        mt
    }
    fn par_tableau(cle: &[u32]) -> Random {
        let mut mt = Random::init(19650218);
        let (mut i, mut j) = (1usize, 0usize);
        for _ in 0..N.max(cle.len()) {
            mt[i] = (mt[i] ^ (mt[i - 1] ^ (mt[i - 1] >> 30)).wrapping_mul(1664525)).wrapping_add(cle[j]).wrapping_add(j as u32);
            i += 1;
            j += 1;
            if i >= N {
                mt[0] = mt[N - 1];
                i = 1;
            }
            if j >= cle.len() {
                j = 0;
            }
        }
        for _ in 0..N - 1 {
            mt[i] = (mt[i] ^ (mt[i - 1] ^ (mt[i - 1] >> 30)).wrapping_mul(1566083941)).wrapping_sub(i as u32);
            i += 1;
            if i >= N {
                mt[0] = mt[N - 1];
                i = 1;
            }
        }
        mt[0] = 0x80000000;
        Random { mt, idx: N, gauss_next: None }
    }
    fn u32(&mut self) -> u32 {
        if self.idx >= N {
            let mt = &mut self.mt;
            for k in 0..N {
                let y = (mt[k] & 0x80000000) | (mt[(k + 1) % N] & 0x7fffffff);
                mt[k] = mt[(k + M) % N] ^ (y >> 1) ^ if y & 1 != 0 { 0x9908b0df } else { 0 };
            }
            self.idx = 0;
        }
        let mut y = self.mt[self.idx];
        self.idx += 1;
        y ^= y >> 11;
        y ^= (y << 7) & 0x9d2c5680;
        y ^= (y << 15) & 0xefc60000;
        y ^ (y >> 18)
    }

    /// `rng.random()` : dans [0, 1[.
    #[track_caller]
    pub fn random(&mut self) -> f64 {
        let (a, b) = ((self.u32() >> 5) as f64, (self.u32() >> 6) as f64);
        let v = (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
        tracer('r', &super::repr_f(v), std::panic::Location::caller());
        v
    }
    /// `rng.uniform(a, b)`.
    #[track_caller]
    pub fn uniform(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.random()
    }
    /// `rng.getrandbits(k)`, k de 1 à 64.
    #[track_caller]
    fn getrandbits(&mut self, k: u32) -> u64 {
        let v = if k <= 32 {
            (self.u32() >> (32 - k)) as u64
        } else {
            let bas = self.u32() as u64;
            bas | (((self.u32() >> (64 - k)) as u64) << 32)
        };
        tracer('b', &v, std::panic::Location::caller());
        v
    }
    /// `rng._randbelow(n)` : un entier de [0, n[.
    #[track_caller]
    fn sous(&mut self, n: i64) -> i64 {
        assert!(n > 0, "ValueError: empty range for randrange()");
        let k = 64 - (n as u64).leading_zeros();
        loop {
            let r = self.getrandbits(k);
            if r < n as u64 {
                return r as i64;
            }
        }
    }
    /// `rng.randrange(n)`.
    #[track_caller]
    pub fn randrange(&mut self, n: i64) -> i64 {
        self.sous(n)
    }
    /// `rng.randrange(a, b)` : dans [a, b[.
    #[track_caller]
    pub fn randrange2(&mut self, a: i64, b: i64) -> i64 {
        a + self.sous(b - a)
    }
    /// `rng.randint(a, b)` : dans [a, b].
    #[track_caller]
    pub fn randint(&mut self, a: i64, b: i64) -> i64 {
        a + self.sous(b - a + 1)
    }
    /// `rng.choice(seq)` : le rang tiré dans une suite de n éléments (`seq[rng.choice_i(n)]`).
    #[track_caller]
    pub fn choice_i(&mut self, n: usize) -> usize {
        assert!(n > 0, "IndexError: Cannot choose from an empty sequence");
        self.sous(n as i64) as usize
    }
    /// `rng.choice(seq)`.
    #[track_caller]
    pub fn choice<T: Clone>(&mut self, seq: &[T]) -> T {
        seq[self.choice_i(seq.len())].clone()
    }
    /// `rng.shuffle(v)`.
    #[track_caller]
    pub fn shuffle<T>(&mut self, v: &mut [T]) {
        for i in (1..v.len()).rev() {
            let j = self.sous(i as i64 + 1) as usize;
            v.swap(i, j);
        }
    }
    /// `rng.gauss(mu, sigma)` (garde le second tirage de la paire pour l'appel suivant, comme Python).
    #[track_caller]
    pub fn gauss(&mut self, mu: f64, sigma: f64) -> f64 {
        let z = match self.gauss_next.take() {
            Some(z) => z,
            None => {
                let x2pi = self.random() * std::f64::consts::TAU;
                let g2rad = (-2.0 * (1.0 - self.random()).ln()).sqrt();
                self.gauss_next = Some(x2pi.sin() * g2rad);
                x2pi.cos() * g2rad
            }
        };
        mu + z * sigma
    }
    /// `rng.choices(population, k=k)` sans poids : les rangs tirés.
    #[track_caller]
    pub fn choices_i(&mut self, n: usize, k: usize) -> Vec<usize> {
        let nf = n as f64 + 0.0;
        (0..k).map(|_| (self.random() * nf).floor() as usize).collect()
    }
    /// `rng.choices(population, weights=poids, k=k)` : les rangs tirés.
    #[track_caller]
    pub fn choices_w(&mut self, poids: &[f64], k: usize) -> Vec<usize> {
        let mut cumul = Vec::with_capacity(poids.len());
        let mut s = 0.0;
        for (i, p) in poids.iter().enumerate() {
            s = if i == 0 { *p } else { s + p };
            cumul.push(s);
        }
        let total = *cumul.last().expect("IndexError: choices sans population") + 0.0;
        assert!(total > 0.0, "ValueError: Total of weights must be greater than zero");
        let hi = poids.len() - 1;
        (0..k)
            .map(|_| {
                let x = self.random() * total;
                // bisect_right(cumul, x, 0, hi)
                let (mut lo, mut h) = (0usize, hi);
                while lo < h {
                    let mid = (lo + h) / 2;
                    if x < cumul[mid] {
                        h = mid
                    } else {
                        lo = mid + 1
                    }
                }
                lo
            })
            .collect()
    }
    /// `rng.choices(population, weights=poids)[0]` : un élément tiré selon les poids.
    #[track_caller]
    pub fn choix_pondere<T: Clone>(&mut self, population: &[T], poids: &[f64]) -> T {
        population[self.choices_w(poids, 1)[0]].clone()
    }
}

/// `random.randrange(1 << 30)` du module (dé non rejouable) : une graine neuve.
pub fn graine_hasard() -> i64 {
    use std::hash::{BuildHasher, Hasher};
    // RandomState tire ses clés du système à chaque processus : c'est le hasard de la bibliothèque standard
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos()));
    (h.finish() >> 34) as i64
}
