// Petites icônes vectorielles (traits, couleur = currentColor)
const S = (body, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  livres: S('<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="5.6" stroke-width="1"/><path d="M10.3 8.6v6.6h4"/><path d="M9 12.2h3.6"/>'),
  vivres: S('<path d="M12 21V9"/><path d="M12 9c-2.2-.4-3.4-2-3.4-4.4 2.3.3 3.4 1.8 3.4 4.4zM12 9c2.2-.4 3.4-2 3.4-4.4-2.3.3-3.4 1.8-3.4 4.4z"/><path d="M12 13.5c-2.3-.3-3.6-1.9-3.7-4.3 2.4.3 3.7 1.8 3.7 4.3zM12 13.5c2.3-.3 3.6-1.9 3.7-4.3-2.4.3-3.7 1.8-3.7 4.3z"/><path d="M12 18c-2.3-.3-3.6-1.9-3.7-4.3 2.4.3 3.7 1.8 3.7 4.3zM12 18c2.3-.3 3.6-1.9 3.7-4.3-2.4.3-3.7 1.8-3.7 4.3z"/>'),
  fer: S('<path d="M4 16.5h16l-2.6-6H6.6z"/><path d="M6.6 10.5 8.4 7h7.2l1.8 3.5"/>'),
  bois: S('<rect x="3.5" y="12.5" width="14" height="5.5" rx="2.7"/><ellipse cx="17.6" cy="15.25" rx="2.4" ry="2.75"/><rect x="6.5" y="6.5" width="12" height="5.5" rx="2.7"/><ellipse cx="18.6" cy="9.25" rx="2.2" ry="2.75"/>'),
  armes: S('<path d="M3.5 20.5 15 9"/><path d="M15 9l5.5-5.5"/><path d="M5.5 22 3 19.5l3-1 2 2z" fill="currentColor"/><path d="M13 11.2l1.8 1.8"/>'),
  outils: S('<path d="M14.5 4.5l5 5-3 3-5-5z"/><path d="M13 9 4.5 17.5a1.8 1.8 0 0 0 2.5 2.5L15.5 11.5"/>'),
  recrues: S('<circle cx="12" cy="6.5" r="2.8"/><path d="M7 21v-6.5a5 5 0 0 1 10 0V21"/><path d="M5.5 10.5 8 9"/><path d="M16 4.5h3"/>'),
  industrie: S('<path d="M3 20h18"/><path d="M4 20V11l5 3V11l5 3V7h5v13"/>'),

  tech: S('<path d="M12 3v4"/><circle cx="12" cy="8.5" r="1.6"/><path d="M11 10 6 21"/><path d="M13 10l5 11"/><path d="M7.8 17h8.4"/>'),
  diplo: S('<path d="M5 4h11l3 3v13H5z"/><path d="M8 9h8M8 12.5h8M8 16h4"/><circle cx="16.5" cy="17" r="2.6" fill="currentColor" stroke="none"/>'),
  commerce: S('<path d="M12 3v17"/><path d="M7 20h10"/><path d="M4.5 7h15"/><path d="M6.5 7 3.5 14a3 3 0 0 0 6 0z"/><path d="M17.5 7l-3 7a3 3 0 0 0 6 0z"/>'),
  production: S('<path d="M4 9h12a4 4 0 0 0 4-4H4z"/><path d="M8 9v3a3 3 0 0 0 2 2.8V18h4v-3.2A3 3 0 0 0 16 12V9"/><path d="M7 20.5h10"/>'),
  journal: S('<path d="M5 4.5a2 2 0 0 1 2-2h12v17H7a2 2 0 0 0-2 2z"/><path d="M5 19.5v2h14"/><path d="M9 7h6M9 10.5h6"/>'),
  menu: S('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: S('<path d="M6 6l12 12M18 6 6 18"/>'),
  swords: S('<path d="M4 4l10 10"/><path d="M20 4 10 14"/><path d="M13 17l4 4M11 17l-4 4"/><path d="M14.5 14.5 17 17M9.5 14.5 7 17" stroke-width="2.4"/>'),
  flag: S('<path d="M5 21V4"/><path d="M5 4h11l-2.5 4L16 12H5"/>'),
  seal: S('<circle cx="12" cy="11" r="6"/><path d="M9 16.5 7.5 21l4.5-2 4.5 2-1.5-4.5"/>'),
  coin: S('<circle cx="12" cy="12" r="8"/>'),
  eye_off: S('<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.5"/><path d="M4 20 20 4"/>'),
  target: S('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),
  eye: S('<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.5"/>'),
  anchor: S('<circle cx="12" cy="4.5" r="1.8"/><path d="M12 6.3V20"/><path d="M8 9.5h8"/><path d="M4.5 13.5c.5 4 3.5 6.5 7.5 6.5s7-2.5 7.5-6.5"/>'),
  boat: S('<path d="M3 15h18l-2.5 4.5h-13z"/><path d="M12 15V3"/><path d="M12 4c3 2 4.5 5 4.5 9H12"/><path d="M11 6c-2.5 1.5-3.5 4-3.5 7H11"/>'),
  spy: S('<path d="M3 10.5h18"/><path d="M6 10.5 7.5 5h9l1.5 5.5"/><circle cx="8.5" cy="15.5" r="2.6"/><circle cx="15.5" cy="15.5" r="2.6"/><path d="M11.1 15.5h1.8"/>'),
  bicorne: S('<path d="M2.5 17h19c-1.2-5.5-5.2-9-9.5-9s-8.3 3.5-9.5 9z"/><path d="M5 14.5h14" stroke-width="1.2"/><circle cx="12" cy="11.6" r="1.7" fill="currentColor"/><path d="M12 8V5.5"/>'),
  scale: S('<path d="M12 3v17"/><path d="M7 20h10"/><path d="M5 7h14"/><path d="M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/>'),

  ligne: S('<path d="M6 21v-7M12 21v-7M18 21v-7"/><circle cx="6" cy="10" r="1.8"/><circle cx="12" cy="10" r="1.8"/><circle cx="18" cy="10" r="1.8"/><path d="M7.5 13 9 3M13.5 13 15 3M19.5 13 21 3"/>'),
  legere: S('<circle cx="10" cy="6" r="2.2"/><path d="M10 9v6l-3 6M10 15l3 6"/><path d="M5 13 18 5"/><path d="M8.5 4.2 13 2.5"/>'),
  cavalerie: S('<path d="M5 20l1.5-6.5L5 9.5l3-3.5 2.5 1.5H15l3.5 3-1 3 .5 6.5"/><path d="M8.5 6V3.5"/><path d="M11 13h5"/>'),
  artillerie: S('<path d="M3.5 10.5 17 6.5l1 3.5L5 14.5z"/><circle cx="9" cy="17" r="3.4"/><path d="M9 13.6V20.4M5.6 17h6.8"/><path d="M12 17h8"/>'),
  grenadiers: S('<circle cx="12" cy="15.5" r="5.5"/><path d="M10.4 10.3V8.6h3.2v1.7"/><path d="M12 8.6c-2-1-2.6-3-1-5.6.5 1.5 2.6 2 2.4 3.8-.1.8-.6 1.4-1.4 1.8z"/><path d="M9.3 14.2a3 3 0 0 1 2-1.9" stroke-width="1.1"/>'),
  chasseurs: S('<path d="M7 8c0-2.4 2.3-3.7 5-3.7s5 1.3 5 3.7c-2 .7-8 .7-10 0z"/><path d="M12 4.3V2.8"/><path d="M2.5 21l5.5-8.5 3.5 4.5 2.8-3.5L21.5 21z"/><path d="M19.5 11 17 21" stroke-width="1.3"/>'),
  sapeurs: S('<path d="M4.5 4.5 19.5 19.5"/><path d="M6.3 3.2C4.4 3.5 3.1 5 2.8 7L6 9.5 9 6.5z"/><path d="M19.5 4.5 10.5 13.5"/><path d="M17.8 2.8l3.4 3.4"/><path d="M10.5 13.5 7 13l-3.2 3.2.9 4.1 4.1.9L12 18z"/>'),
  garde: S('<circle cx="9" cy="12.5" r="5.3"/><circle cx="9" cy="12.5" r="2.9" stroke-width="1"/><circle cx="9" cy="12.5" r="1.1" fill="currentColor"/><path d="M18.5 21V6.5"/><path d="M18.5 2.5l1.7 4h-3.4z"/><path d="M16.8 9.5h3.4" stroke-width="1.2"/>'),
  depot: S('<ellipse cx="12" cy="5.5" rx="6" ry="2"/><path d="M6 5.5c-1 4.3-1 8.7 0 13 .5 1.2 3 2 6 2s5.5-.8 6-2c1-4.3 1-8.7 0-13"/><path d="M5.4 9.5c2 1 11.2 1 13.2 0M5.4 14.5c2 1 11.2 1 13.2 0" stroke-width="1.2"/>'),
  milice: S('<path d="M12 3 6 6v5c0 4.5 2.6 7.5 6 10 3.4-2.5 6-5.5 6-10V6z"/>'),
  fort: S('<path d="M12 2.5l3 4.5 5-1-1.5 5L22 13l-5 1.5.5 5-5-2-5 2 .5-5L2 13l3.5-3L4 5l5 1z"/>'),
  ville: S('<path d="M4 20V10l3-2 3 2v10M10 20v-7h4v7M14 20V9l3-2.5L20 9v11M3 20h18"/>'),
  village: S('<path d="M3 20v-7l4-4 4 4v7M11 20v-5l5-4.5 5 4.5v5M2 20h20"/>'),
  capitale: S('<path d="M12 2l2.4 4.6L20 6l-1.6 5L22 15l-5.2.4L15 21l-3-3.8L9 21l-1.8-5.6L2 15l3.6-4L4 6l5.6.6z"/><circle cx="12" cy="12" r="2.4"/>'),
};

export function speedIcon(i) {
  if (i >= 5) return `<svg viewBox="0 0 24 20"><text x="12" y="14.5" text-anchor="middle" font-size="${i === 5 ? 10 : 10}" font-weight="700" fill="currentColor" font-family="Georgia, serif">×${i === 5 ? 10 : 30}</text></svg>`;
  if (i === 0) return '<svg viewBox="0 0 24 20"><rect x="7" y="3" width="3.6" height="14" rx="1" fill="currentColor"/><rect x="13.4" y="3" width="3.6" height="14" rx="1" fill="currentColor"/></svg>';
  let p = '';
  const w = 7, gap = 0.5, total = i * w - (i - 1) * 1.5;
  let x = (24 - total) / 2;
  for (let k = 0; k < i; k++) { p += `<path d="M${x} 3 L${x + w} 10 L${x} 17z" fill="currentColor"/>`; x += w - 1.5 + gap; }
  return `<svg viewBox="0 0 24 20">${p}</svg>`;
}

export function coat(color, code, size = 1) {
  return `<svg class="coat" viewBox="0 0 40 48" aria-hidden="true">
    <path d="M3 3h34v19c0 12-8 19.5-17 23C11 41.5 3 34 3 22z" fill="${color}" stroke="#e6c97f" stroke-width="2"/>
    <path d="M3 3h34v8H3z" fill="rgba(0,0,0,.22)"/>
    <path d="M8.5 7h3M18.5 7h3M28.5 7h3" stroke="#e6c97f" stroke-width="2" stroke-linecap="round"/>
    <text x="20" y="33" text-anchor="middle" font-family="IM Fell English, Georgia, serif" font-size="15" fill="#fff8e6">${code}</text>
  </svg>`;
}
