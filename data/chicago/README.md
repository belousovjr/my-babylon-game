# Chicago Loop source data

Snapshot date: 2026-11-07. Bounding box: west -87.642, south 41.877,
east -87.6195, north 41.8915. Approximate extent: 1.86 km east–west × 1.61 km north–south.
Origin: longitude -87.63075, latitude 41.88425. Projection is a local equirectangular
approximation; one game unit is one metre, X east, Z north. This is a bounded district,
not all downtown Chicago.

## Source and licence

© OpenStreetMap contributors, Open Database Licence (ODbL) 1.0.
Original data: https://www.openstreetmap.org/#map=15/41.88425/-87.63075
Attribution and licence: https://www.openstreetmap.org/copyright
Licence text: https://opendatacommons.org/licenses/odbl/1-0/

The compressed source snapshot, extracted footprints, SVG map and generated map database
are OSM-derived data distributed under ODbL. Application code and procedural architecture
are separate from this data. Visible attribution is included in the game and SVG map.

- `osm-snapshot.xml.gz`: deduplicated source geometry/tags; contributor metadata and unrelated POIs removed.
- `buildings.json`: original clipped footprints, architectural classification, height and height provenance.
- `report.json`: counts and provenance summary.
- `../../src/generated/chicago.json`: generated runtime scene and procedural street data.
- `../../public/maps/chicago.svg`: north-up schematic map, named landmarks, metric scale and spawn marker.
- `osm-*.xml` and `river-*.xml`: ignored HTTP download cache.

## Pipeline

From the repository root, with Python 3.10+ and Shapely 2.1+ installed:

```sh
python3 -m pip install -r scripts/requirements.txt
npm run city:build
```

This rebuilds entirely offline from the tracked snapshot. The application itself needs
neither Python nor Shapely. To fetch raw source again, clear the ignored XML cache, then run:

```sh
npm run city:fetch
npm run city:build
```

The fetcher uses nine small official OSM API map requests, at most two at once,
and three full river relations. It reuses existing cache files. The packer deduplicates
and strips source metadata. The builder clips geometry, projects to metres, fits oriented
building rectangles, classifies templates and generates terrain/road polygons. Triangulation
and road/sidewalk unions run offline, never in the browser. Assertions and application tests
check IDs, dimensions, heights, triangle orientation, spawn support and LOD reduction.

## Accuracy and deliberate simplification

- Building positions and footprint dimensions come from OSM. Rendered shapes/colliders fit
  oriented rectangles; courtyards, concave footprints and overhangs are not reproduced.
- Heights: explicit OSM heights (including overlapping building parts), then `building:levels × 3.6 m`.
  Buildings without either use a deterministic 24/55 m estimate based on footprint area.
  Provenance is stored per building; current counts are in `report.json`.
- Landmark overrides use approximate overall heights to preserve the skyline: Willis 442 m,
  Trump 423 m including spire, Marina City 179 m, Tribune 141 m, Wrigley up to 134 m;
  a lower Wrigley component retains its OSM-part height when available.
- Style classification uses names, height and construction year where present. It is a visual
  approximation, not an architectural inventory. Materials are flat vertex colors, without textures.
- Street widths use tagged width, otherwise lane count × 3.2 m, with a 9–26 m fallback envelope.
  Buildings and road geometry can disagree where OSM is incomplete or the rectangle approximation expands a footprint.
- The Loop street datum is flat at 0 m. Sidewalks +0.16 m, river water -5.5 m and Riverwalk -3.8 m
  are schematic local elevations, not DEM/LiDAR measurements. Quay walls and four ramps show
  the level difference. Only OSM `water=river` receives this treatment; small pools and fountains are omitted.
  Full Lower Wacker/tunnel interiors are excluded.
- Street bridges share the street datum, with a 0.85 m structural underside and simple solid parapets.
  Structural decks extend across the lowered terraces and 2 m into land; simple bank abutments
  support the spans. Parapets continue across the terraces and stop before the land junctions. Bridge mechanics and exact slopes are omitted.
- Elevated L uses above-ground CTA `railway=subway` ways; mainline rail, yards and tunnels are excluded.
  Shared nodes and short fragments are merged before clipping. Adjacent tracks share a continuous
  closed deck with a top at 6 m and underside at 5.65 m; rails and supports are generated offline.
  Building rectangles are fitted outside the track corridor on the editor grid; rectangles with
  less than 25% usable area are omitted. Detailed station buildings/platforms are not modeled.
- Trees and lamps are procedurally spaced along eligible streets. They are not individually surveyed
  positions; lamps are geometry, without hundreds of real light sources. No trains, traffic or interiors.

Architectural reference sources:

- Willis Tower (SOM): https://www.som.com/projects/willis-tower-formerly-sears-tower/
- Marina City (Chicago Architecture Center): https://www.architecture.org/online-resources/buildings-of-chicago/marina-city/
- Wrigley Building (Chicago Architecture Center): https://www.architecture.org/online-resources/buildings-of-chicago/wrigley-building/
- Tribune Tower (Chicago Architecture Center): https://www.architecture.org/online-resources/buildings-of-chicago/tribune-tower/
- Riverwalk vertical arrangement: https://www.rudybruneraward.org/wp-content/uploads/2017/06/Chicago_Riverwalk_FULL.pdf

Generated building anchors snap to 1 m in X/Z, dimensions to 0.25 m and yaw to 15°.
The Y centre is half the snapped height, keeping the base at street level. Procedural street contours retain their own geometric precision.

Untyped, unnamed elevated `building=yes` structures without height or levels are omitted rather than turned into estimated ground-level towers. OSM `layer` is not a metric elevation.

Surface boundaries are snapped only before polygon operations; intersections retain shared coordinates.
Ground is triangulated before cell batching, and raised paving gets closed side faces down to ground level.
Generation checks complete map coverage; geometry tests also verify that every paving boundary has a side face.

Architectural trim uses a shared material with `zOffset = zOffsetUnits = -1` to win depth ties
against the body. Each LOD keeps at most two material submeshes; geometry and colliders are unchanged.
