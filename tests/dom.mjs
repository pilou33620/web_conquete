// Faux navigateur minimal pour les tests d'interface sous Node (à la manière de commun/test/dom-stub.js de WEB_CAO).
// Ce n'est pas un navigateur : juste assez d'éléments (innerHTML en texte brut, classList, dataset, hidden) pour que les
// fonctions d'affichage de l'interface s'exécutent, et qu'on vérifie le HTML qu'elles produisent.
//
//   import { installer, element } from './dom.mjs';
//   const dom = installer();          // document et window globaux
//   dom.ids['tb-turn'] = element();   // un élément que le code ira chercher par son id

export function element() {
  const classes = new Set();
  return {
    hidden: false, innerHTML: '', textContent: '', dataset: {}, style: {}, children: [], disabled: false,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: c => classes.has(c), toggle: (c, on = !classes.has(c)) => { if (on) classes.add(c); else classes.delete(c); return on; },
    },
    querySelector: () => null, querySelectorAll: () => [], appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getContext: () => null,
  };
}

export function installer() {
  const ids = {};
  const body = element();
  globalThis.document = {
    body, documentElement: element(),
    getElementById: id => ids[id] || null, createElement: () => element(), querySelector: () => null,
    addEventListener() {},
  };
  globalThis.window = globalThis.window || { addEventListener() {}, innerWidth: 1280, innerHeight: 800 };
  const mem = new Map();
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  return { ids, body };
}
