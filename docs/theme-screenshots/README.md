# Theme screenshots (P32)

Desktop Chromium, 1280 x 800, the real Appearance test page (`/e2e/theme-check`). `before/` was taken on the P31 code, `after/` on the P32 code. Light and dark for every gradient theme; pride themes have one fixed look. Regenerate with:

```
THEME_SHOTS=after npx playwright test e2e/theme-shots.e2e.ts --project=chromium-desktop
```

(`THEME_ONLY=pride-pansexual,pride-intersex` limits it to some ids.)

| Theme | Before (dark) | After (dark) | Before (light) | After (light) |
|---|---|---|---|---|
| Nebula | [before](before/nebula-dark.jpg) | [after](after/nebula-dark.jpg) | [before](before/nebula-light.jpg) | [after](after/nebula-light.jpg) |
| Lagoon | [before](before/lagoon-dark.jpg) | [after](after/lagoon-dark.jpg) | [before](before/lagoon-light.jpg) | [after](after/lagoon-light.jpg) |
| Ember | [before](before/ember-dark.jpg) | [after](after/ember-dark.jpg) | [before](before/ember-light.jpg) | [after](after/ember-light.jpg) |
| Sunset | [before](before/sunset-dark.jpg) | [after](after/sunset-dark.jpg) | [before](before/sunset-light.jpg) | [after](after/sunset-light.jpg) |
| Aurora | [before](before/aurora-dark.jpg) | [after](after/aurora-dark.jpg) | [before](before/aurora-light.jpg) | [after](after/aurora-light.jpg) |
| Cotton Candy | [before](before/cotton-candy-dark.jpg) | [after](after/cotton-candy-dark.jpg) | [before](before/cotton-candy-light.jpg) | [after](after/cotton-candy-light.jpg) |
| Midnight | [before](before/midnight-dark.jpg) | [after](after/midnight-dark.jpg) | [before](before/midnight-light.jpg) | [after](after/midnight-light.jpg) |
| Twilight | [before](before/twilight-dark.jpg) | [after](after/twilight-dark.jpg) | [before](before/twilight-light.jpg) | [after](after/twilight-light.jpg) |
| Glacier | [before](before/glacier-dark.jpg) | [after](after/glacier-dark.jpg) | [before](before/glacier-light.jpg) | [after](after/glacier-light.jpg) |
| Citrus | [before](before/citrus-dark.jpg) | [after](after/citrus-dark.jpg) | [before](before/citrus-light.jpg) | [after](after/citrus-light.jpg) |
| Tropical | [before](before/tropical-dark.jpg) | [after](after/tropical-dark.jpg) | [before](before/tropical-light.jpg) | [after](after/tropical-light.jpg) |
| Rose Gold | [before](before/rose-gold-dark.jpg) | [after](after/rose-gold-dark.jpg) | [before](before/rose-gold-light.jpg) | [after](after/rose-gold-light.jpg) |

Pride themes (fixed look): `before/pride-<name>-dark.jpg` and `after/pride-<name>-dark.jpg`. New in P32: `after/pride-berri-laurian-dark.jpg` and `after/pride-almond-verian-dark.jpg` (no "before").

## Pansexual and Intersex: the candidates

`candidates/` holds the renderings the style choice was made from (P32 section 3; the reasoning is in `docs/ASSUMPTIONS.md`, P32-3):

- `pansexual-smooth.jpg`, `pansexual-banded.jpg` (chosen: banded)
- `intersex-smooth.jpg`, `intersex-banded.jpg`, `intersex-radial.jpg` (chosen: radial)
