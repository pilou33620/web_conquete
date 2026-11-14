//! `heapq` de Python : le même tas, les mêmes échanges. Entre deux éléments égaux, c'est l'ordre des échanges
//! qui décide lequel sort d'abord : un autre tas (BinaryHeap) donnerait d'autres chemins.

pub fn heappush<T: PartialOrd + Clone>(tas: &mut Vec<T>, x: T) {
    tas.push(x);
    let n = tas.len() - 1;
    siftdown(tas, 0, n)
}

pub fn heappop<T: PartialOrd + Clone>(tas: &mut Vec<T>) -> Option<T> {
    let dernier = tas.pop()?;
    if tas.is_empty() {
        return Some(dernier);
    }
    let tete = std::mem::replace(&mut tas[0], dernier);
    siftup(tas, 0);
    Some(tete)
}

pub fn heapify<T: PartialOrd + Clone>(tas: &mut Vec<T>) {
    for i in (0..tas.len() / 2).rev() {
        siftup(tas, i)
    }
}

fn siftdown<T: PartialOrd + Clone>(tas: &mut [T], debut: usize, mut pos: usize) {
    let neuf = tas[pos].clone();
    while pos > debut {
        let parent = (pos - 1) >> 1;
        if neuf < tas[parent] {
            tas[pos] = tas[parent].clone();
            pos = parent;
            continue;
        }
        break;
    }
    tas[pos] = neuf;
}

fn siftup<T: PartialOrd + Clone>(tas: &mut [T], mut pos: usize) {
    let (fin, debut) = (tas.len(), pos);
    let neuf = tas[pos].clone();
    let mut enfant = 2 * pos + 1;
    while enfant < fin {
        let droit = enfant + 1;
        if droit < fin && !(tas[enfant] < tas[droit]) {
            enfant = droit
        }
        tas[pos] = tas[enfant].clone();
        pos = enfant;
        enfant = 2 * pos + 1;
    }
    tas[pos] = neuf;
    siftdown(tas, debut, pos)
}
