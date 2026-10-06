/**
 * The site's glyphs, for the feature cards and the two lanes: our own strokes on a 24 × 24 grid.
 * Each is the `d` of one path, so a component draws it with no markup of its own.
 */

/** The glyphs, by what they stand for. */
export const featureIcons = {
  chat: 'M4 5h16v11H10l-6 4z M8 9.5h8 M8 12.5h5',
  chart: 'M4 4v16h16 M7 15l4-5 3 3 5-7',
  library: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  alert: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 20.5a2 2 0 0 0 4 0',
  report: 'M6 3h9l3 3v15H6z M14.5 3v3.5H18 M9 17.5v-3 M12 17.5v-6 M15 17.5v-4.5',
  send: 'M3.5 11.5 20 4l-6.5 16.5-3-7z M10.5 13.5 20 4',
  ask: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.6 M12 16.8v.2',
  snapshot: 'M4 8h3.5l2-3h5l2 3H20v11H4z M12 16.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  plug: 'M9 3v5 M15 3v5 M6 8h12v3a6 6 0 0 1-12 0z M12 17v4',
  model: 'M7 7h10v10H7z M10 3v4 M14 3v4 M10 17v4 M14 17v4 M3 10h4 M3 14h4 M17 10h4 M17 14h4',
  people:
    'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3.5 20a5.5 5.5 0 0 1 11 0 M15.5 5.3a3 3 0 0 1 0 5.4 M17 14.5a5.5 5.5 0 0 1 3.5 5.5',
  person: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4.5 21a7.5 7.5 0 0 1 15 0',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M18.5 16v4 M16.5 18h4',
  shield: 'M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z M9 12l2 2 4-4',
  code: 'M8.5 8 4.5 12l4 4 M15.5 8l4 4-4 4 M13.5 6l-3 12',
  database:
    'M12 9c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
} as const;

/** The name of a glyph. */
export type FeatureIcon = keyof typeof featureIcons;
