import { strict as assert } from 'node:assert';
import { test, mock } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { buildArchitecture } from '../src/architecture.ts';
import layout from '../src/facadeLayout.json' with { type: 'json' };

test('facade ribs and belts fit opaque texture gaps, including bases and roofs at every LOD', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const body = new StandardMaterial('body', scene), detail = new StandardMaterial('detail', scene);
  const base = new StandardMaterial('base', scene), roof = new StandardMaterial('roof', scene);
  const original = Mesh.MergeMeshes;
  let captures = [];
  const spy = mock.method(Mesh, 'MergeMeshes', (...args: Parameters<typeof Mesh.MergeMeshes>) => {
    captures.push(args[0].map(mesh => {
      const matrix = mesh.computeWorldMatrix(true), positions = mesh.getVerticesData('position'), uv = mesh.getVerticesData('uv'), normals = mesh.getVerticesData('normal');
      const face = [];
      for (let i = 0; i < positions.length; i += 3) if (normals[i + 2] > .9) {
        face.push({ point: Vector3.TransformCoordinates(Vector3.FromArray(positions, i), matrix), u: uv[i / 3 * 2], v: uv[i / 3 * 2 + 1] });
      }
      return { material: mesh.material, face, bounds: mesh.getBoundingInfo().boundingBox };
    }));
    return original(...args);
  });
  try {
    for (const profile of ['glass', 'stone', 'deco'] as const) {
      captures = [];
      const levels = buildArchitecture({ id: profile, name: profile, profile, kind: 'building', size: [36, 100, 30], color: '#ffffff', lodDistances: [100, 200] }, scene, body, detail, [0],
        (_lod, accent, _light, role) => role === 'base' ? base : role === 'roof' ? roof : accent ? detail : body);
      const grid = profile === 'glass' ? layout.glass : layout.masonry;
      for (const [lod, parts] of captures.entries()) {
        const face = parts.find(part => part.material === body).face;
        // Recover UV projection from actual generated vertices, rather than assuming its formula.
        const a = face[0], x = face.find(p => Math.abs(p.point.x - a.point.x) > .1), y = face.find(p => Math.abs(p.point.y - a.point.y) > .1);
        const u = value => a.u + (value - a.point.x) * (x.u - a.u) / (x.point.x - a.point.x);
        const v = value => a.v + (value - a.point.y) * (y.v - a.v) / (y.point.y - a.point.y);
        assert.ok(Math.abs(v(parts.find(part => part.material === base).bounds.maximumWorld.y)) < 1e-6);
        assert.ok(Math.abs(v(parts.find(part => part.material === roof).bounds.minimumWorld.y) - 1) < 1e-6);
        let checked = 0;
        for (const part of parts.filter(part => part.material === detail)) {
          const { minimumWorld: min, maximumWorld: max } = part.bounds;
          const belt = max.x - min.x > 1 && max.y - min.y < .02;
          const rib = max.x - min.x < .03 && max.y - min.y > .8;
          if (!belt && !rib) continue;
          const lo = belt ? v(min.y) : u(min.x), hi = belt ? v(max.y) : u(max.x);
          const count = belt ? grid.rows : grid.columns;
          for (let cell = 0; cell < count; cell++) {
            const start = (Math.round(cell * layout.size / count) + (belt ? grid.insetTop : grid.insetX)) / layout.size;
            const end = (Math.round((cell + 1) * layout.size / count) - (belt ? grid.insetBottom : grid.insetX + 1)) / layout.size;
            assert.ok(hi <= start + 1e-6 || lo >= end - 1e-6, `${profile}: ${belt ? 'belt' : 'rib'} overlaps window ${cell}`);
          }
          checked++;
        }
        assert.equal(checked, lod === 0 ? 13 : 0);
      }
      levels.forEach(level => level.dispose());
    }
  } finally { spy.mock.restore(); scene.dispose(); engine.dispose(); }
});
