import '@babylonjs/core/Meshes/instancedMesh.js';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { CityMaterials, buildingSurface, streetSurface } from '../src/cityMaterials.ts';
import { buildArchitecture } from '../src/architecture.ts';
import { createWorld } from '../src/world.ts';

test('city materials share textures, simplify distant shaders, and keep lights and trees untextured', () => {
  const engine = new NullEngine(), scene = new Scene(engine), materials = new CityMaterials(scene, '/');
  const world = createWorld();
  for (const template of world.templates) {
    const levels = buildArchitecture(template, scene, materials.get(template.color), materials.get(template.color), [0, Math.PI / 2],
      (lod, accent, luminous) => materials.get(luminous ? '#ffffff' : template.color, buildingSurface(template, accent, luminous), lod, accent || luminous ? 1 : 0));
    levels.forEach((mesh, lod) => {
      const uv = mesh.getVerticesData('uv');
      assert.equal(uv.length, mesh.getTotalVertices() * 2);
      assert.ok(uv.every(Number.isFinite));
      const parts = mesh.subMeshes.map(sub => sub.getMaterial());
      for (const material of parts) {
        if (template.profile === 'tree') assert.equal(material.getActiveTextures().length, 0);
        if (lod > 0) { assert.equal(material.bumpTexture, null); assert.equal(material.ambientTexture, null); assert.equal(material.specularTexture, null); }
      }
      if (['lamp', 'traffic_signal'].includes(template.profile) && lod === 0) {
        assert.ok(parts.some(material => material.diffuseTexture), 'pole/body remains textured');
        assert.ok(parts.some(material => !material.diffuseTexture && !material.reflectionTexture), 'light head/lenses use a separate untextured material');
      }
      if (template.kind === 'building') assert.ok(parts.every(material => material.diffuseTexture), 'all architectural surfaces are textured');
    });
    if (['glass', 'stone'].includes(template.profile)) {
      assert.ok(levels.every(mesh => mesh.subMeshes.length <= 2), 'facades and roofs add no draw calls');
      const mesh = levels[2], positions = mesh.getVerticesData('position'), normals = mesh.getVerticesData('normal'), uv = mesh.getVerticesData('uv');
      for (let i = 0; i < normals.length; i += 3) if (normals[i + 1] > .9 && positions[i + 1] > .49) {
        assert.ok(uv[i / 3 * 2] < .01 && uv[i / 3 * 2 + 1] < .01, 'roofs sample the quiet patch rather than windows');
      }
    }
    levels.forEach(mesh => mesh.dispose());
  }
  const near = materials.get('#ffffff', 'asphalt'), far = materials.get('#ffffff', 'asphalt', 2);
  assert.match(near.diffuseTexture.url, /asphalt-0.webp$/);
  assert.match(far.diffuseTexture.url, /asphalt-2.webp$/);
  assert.equal(materials.get('#aaaaaa', 'asphalt').diffuseTexture, near.diffuseTexture, 'colors share GPU textures');
  assert.equal(materials.get('#ffffff', 'asphalt'), near, 'materials are cached');
  const glass = materials.get('#ffffff', 'facade-glass'), metal = materials.get('#ffffff', 'metal'), water = materials.get('#ffffff', 'water');
  assert.equal(glass.reflectionTexture, metal.reflectionTexture);
  assert.equal(metal.reflectionTexture, water.reflectionTexture);
  assert.ok(glass.roughness < metal.roughness);
  assert.ok(glass.specularPower > near.specularPower);
  assert.equal(near.reflectionTexture, null);
  for (const color of ['#454e50', '#517d85', '#71896a', '#c3baa1', '#505b55', '#b6b2a4']) assert.notEqual(streetSurface(color), 'plain');
  scene.dispose(); engine.dispose();
});

test('every bundled city texture has maps and all LOD variants within a small download budget', () => {
  const folder = new URL('../public/textures/chicago/', import.meta.url), manifest = JSON.parse(readFileSync(new URL('manifest.json', folder), 'utf8'));
  assert.equal(manifest.license, 'CC0-1.0');
  assert.deepEqual(manifest.lodSizes, [512, 128, 32]);
  for (const name of ['asphalt', 'concrete', 'brick', 'metal', 'grass', ...manifest.derived]) for (const suffix of ['0', '1', '2', 'ao', 'normal', 'specular']) {
    const raw = readFileSync(new URL(`${name}-${suffix}.webp`, folder));
    assert.equal(raw.subarray(8, 12).toString(), 'WEBP');
  }
  assert.ok(readdirSync(folder).reduce((sum, name) => sum + statSync(new URL(name, folder)).size, 0) < 3 * 1024 * 1024);
});
