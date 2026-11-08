import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { drawChicagoStreets } from '../src/streets.ts';
import { streetSurface } from '../src/cityMaterials.ts';

test('shared concrete batches reduce mesh count without losing geometry, UVs, collision or shadow boundaries', () => {
  const engine = new NullEngine();
  const scenes = [new Scene(engine), new Scene(engine)];
  const build = (scene: Scene, shared: boolean) => {
    const materials = new Map<string, StandardMaterial>();
    return drawChicagoStreets(scene, (color, lod) => {
      const key = `${shared ? streetSurface(color) : color}:${lod}`;
      if (!materials.has(key)) materials.set(key, new StandardMaterial(key, scene));
      return materials.get(key)!;
    }).meshes;
  };
  try {
    const original = build(scenes[0], false), merged = build(scenes[1], true);
    assert.ok(merged.length < original.length - 50);
    const totals = meshes => ({
      vertices: meshes.reduce((n,m)=>n+m.getTotalVertices(),0),
      indices: meshes.reduce((n,m)=>n+m.getTotalIndices(),0),
      collision: meshes.filter(m=>m.checkCollisions).reduce((n,m)=>n+m.getTotalIndices(),0),
      shadows: meshes.filter(m=>m.metadata.shadowCaster).reduce((n,m)=>n+m.getTotalIndices(),0),
      uv: meshes.reduce((n,m)=>n+m.getVerticesData('uv').length,0),
      uv2: meshes.reduce((n,m)=>n+m.getVerticesData('uv2').length,0),
    });
    assert.deepEqual(totals(merged), totals(original));
    for (const layer of ['marking','rail-structure']) {
      assert.equal(merged.filter(m=>m.metadata.detailLayer===layer).length,original.filter(m=>m.metadata.detailLayer===layer).length);
    }
    for (const surface of ['#517d85','#6a644e','#71896a']) {
      assert.equal(merged.filter(m=>m.metadata.surface===surface).length,original.filter(m=>m.metadata.surface===surface).length);
    }
  } finally { scenes.forEach(scene=>scene.dispose()); engine.dispose(); }
});
