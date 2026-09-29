# Maps

`world.geojson` holds the countries of the world, without Antarctica, for the map chart recipes.
Each feature has one property, `name`, which map data must match, such as
`United States of America`.

- Source: Natural Earth 1:110m countries, public domain, through `world-atlas` 2.0.2 (ISC).
- Converted once from TopoJSON with `topojson-client`, coordinates rounded to two decimals.
- Rings that wrap around the 180° meridian, such as the far east of Russia and parts of Fiji,
  are left out: they would draw as lines across the map.
- It is loaded only when a chart draws a map, and registered as the map `world`.
