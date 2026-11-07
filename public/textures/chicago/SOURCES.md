# Chicago Loop texture palette

Runtime textures are local WebP files. No CDN or runtime texture generation.
Sources and ZIP SHA-256 hashes are in `manifest.json`. All source assets are
CC0 1.0 Universal: https://docs.ambientcg.com/license/ . The derived facade,
paint, water and environment images are also dedicated to CC0 1.0.

## Chicago references (visual reference only; photographs are not redistributed)

- Willis Tower: black aluminum and bronze-tinted glass.
  https://www.architecture.org/online-resources/buildings-of-chicago/willis-tower
- Marina City: reinforced concrete, repeated circular balconies.
  https://www.architecture.org/online-resources/buildings-of-chicago/marina-city
  https://www.wttw.com/ten/homes/marina-city
- Rookery: brick masonry, terra cotta, stone and cast iron.
  https://www.therookerybuilding.com/specifications
- Historic Chicago terra cotta cladding (Reliance Building):
  https://webapps1.chicago.gov/landmarksweb/web/landmarkdetails.htm?lanId=1359

These establish a small stylized palette, not photogrammetric replicas of
individual buildings. Low-rise stone-profile blocks use buff brick; taller
masonry blocks use a light stone/terra-cotta facade. Existing object colors tint
neutral texture detail, so editor color controls and skyline colors still work.

## Source textures

Lennart Demes / ambientCG, CC0:

- Asphalt031: https://ambientcg.com/view?id=Asphalt031
- Concrete031: https://ambientcg.com/view?id=Concrete031
- Bricks090: https://ambientcg.com/view?id=Bricks090
- Metal046A: https://ambientcg.com/view?id=Metal046A
- Grass004: https://ambientcg.com/view?id=Grass004

Original 1K ZIPs are cached outside the repository. Rebuild with:

```
python3 -m pip install -r scripts/requirements.txt
npm run textures:build -- --cache /tmp/chicago-texture-sources
```

The script downloads missing sources, normalizes colors for tinting, creates
facades and generates all lower-resolution variants. `palette.webp` previews
the set. It does not run during game startup.

## Maps and rendering cost

- LOD 0: 512² albedo, AO and OpenGL normal; 256² specular/glossiness.
- LOD 1: 128² albedo with AO baked in; no normal/AO/specular texture samples.
- LOD 2: 32² albedo with AO baked in and eight retained facade belts.
- All textures have mipmaps and bounded 4× anisotropic filtering.
- Terrain has no duplicate LOD geometry: automatic mip selection reduces its
  texture sampling resolution with distance. Existing detail meshes use their
  own near/far materials. No extra geometry is added for texture LOD.
- Reflective surfaces use one shared 128² cubemap, generated offline. Glass,
  metal and water use different specular power, reflection roughness and
  Fresnel response; other surfaces have only a faint, broad highlight.
- Original cavity/AO is preserved; Metal046A has generated cavity AO from
  source height. Facades have generated recess AO and normals. These are
  contact/recess shading maps, not directional dynamic shadow maps.
- No parallax, displacement, real-time reflection probe or alpha-blended glass.
- Hero, trees, lamp light heads and traffic-signal lenses remain untextured.

Facade roofs sample a small quiet patch in the same texture. This avoids
windows on roofs without creating additional draw calls. UVs on procedural
surfaces are projected in world units, including walls and bridge undersides.
