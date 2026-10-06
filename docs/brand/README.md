# Brand

The quanthea logo files, as delivered. `quanthea-logo-preview.png` shows every variant on light and
dark grounds.

![The quanthea logo variants on light and dark grounds](quanthea-logo-preview.png)

## Files

| File                     | What it is                                                      |
| ------------------------ | --------------------------------------------------------------- |
| `quanthea-logo.svg`      | Icon and "quanthea" wordmark, ink lettering. For light grounds. |
| `quanthea-logo-dark.svg` | Icon and wordmark, white lettering. For dark grounds.           |
| `quanthea-icon.svg`      | The blue tile. The app icon at every size.                      |
| `quanthea-icon-dark.svg` | The ink tile. Large sizes on dark grounds only.                 |
| `quanthea-mark.svg`      | The mark alone. Lens and handle in the current text colour.     |

The wordmark is IBM Plex Sans SemiBold at 40 px, on a baseline at y=45, with tracking of
-0.01 em, converted to paths. The logo's viewBox is 258 by 64; the icon takes its first 64 units.

## Colours

The tokens live in `@quanthea/tokens` (`packages/tokens/tokens.css`), for the light and the dark
scheme. The web app and the website both import them.

| Token                  | Value     | Use                                         |
| ---------------------- | --------- | ------------------------------------------- |
| `--color-accent`       | `#2A55C9` | The icon tile. Also the UI accent.          |
| `--color-ink`          | `#17181C` | Wordmark lettering, the dark tile.          |
| `--color-brand-signal` | `#F29A4A` | The signal dot of the mark. Brand use only. |

The icon tiles take `--color-brand-accent` and `--color-brand-ink`, which keep these values in the
dark scheme, where the UI accent and ink change.

The signal orange is not a chart colour. The second chart series stays `#D0691C`
(`--color-series-2`), so data never reads as the brand.

## Where each variant is used

| Place                         | Variant                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Nav rail, home link           | Blue icon, 32 px (`BrandIcon`).                                                                          |
| Browser tab                   | `apps/web/public/favicon.svg` (blue icon), `favicon-32.png` fallback.                                    |
| Home screen and installed app | `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, via `site.webmanifest`. |
| Sign-in page                  | Logo for the scheme shown (`Logo`): ink lettering in light, white lettering in dark.                     |
| Loading screen                | The mark in secondary ink (`BrandMark`).                                                                 |
| `/ui` kit                     | Every variant on the ground it is meant for.                                                             |
| The repository README         | Logo, with the dark variant in GitHub's dark mode.                                                       |

In the app, `apps/web/src/ui/brand.tsx` draws the mark and the icons inline from the same
geometry, so their colours come from the theme tokens. The two wordmark files are used unchanged.

## Rules

- Keep the icon tile blue at small sizes, also on dark grounds. The ink tile is for large sizes.
- Do not recolour the signal dot, and do not stretch or re-letter the wordmark.
- Give the mark clear space of at least a quarter of its height.

## Generated icons

The PNG icons in `apps/web/public/` are rendered from `quanthea-icon.svg` with headless Chromium:
the tile as delivered for `favicon-32`, `icon-192` and `icon-512`, a full-bleed square for
`apple-touch-icon` (iOS applies its own mask), and a full-bleed square with the mark scaled to 78%
for `icon-maskable-512`, so the mark stays inside the maskable safe zone. Render them again when
the icon changes.
