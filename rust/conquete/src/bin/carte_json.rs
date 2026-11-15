//! La carte telle que le navigateur la reçoit (GeoMap.client_payload), pour les bancs de l'interface (tests/*.test.mjs).
//!     carte_json <géographie> [--cut]
//! --cut ajoute les routes que la crue coupe : "cut": [[arête, début, fin], …] (crue.spans).
use conquete::{crue, geo::GeoMap, py::{json, Val}};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let v = args.first().and_then(|a| a.parse().ok()).unwrap_or(conquete::geo::VERSION);
    let g = GeoMap::new(v);
    let m = g.client_payload();
    if args.iter().any(|a| a == "--cut") {
        let cut = Val::list(vec![]);
        for (k, l) in crue::spans(&g).items() {
            for s in l.iter() {
                let ligne = Val::list(vec![k.clone()]);
                ligne.extend(&s);
                cut.push(ligne);
            }
        }
        m.set("cut", cut);
    }
    print!("{}", json::dumps(&m));
}
