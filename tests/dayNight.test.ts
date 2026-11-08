import '@babylonjs/core/Meshes/instancedMesh.js';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { DayNight, daylightAt, nearestLamps } from '../src/dayNight.ts';
import { CityMaterials } from '../src/cityMaterials.ts';

test('daylight wraps smoothly through midnight, dawn and dusk', () => {
  assert.equal(daylightAt(12).day, 1); assert.equal(daylightAt(0).night, 1);
  assert.deepEqual(daylightAt(24), daylightAt(0));
  assert.ok(daylightAt(5).day < daylightAt(6).day && daylightAt(6).day < daylightAt(7).day);
  assert.ok(daylightAt(17).night < daylightAt(18).night && daylightAt(18).night < daylightAt(19).night);
  assert.throws(() => daylightAt(NaN), RangeError);
});

test('lighting uses a fixed light budget, local receivers, and bounded dynamic shadows', () => {
  const engine = new NullEngine(), scene = new Scene(engine), lighting = new DayNight(scene);
  const road = MeshBuilder.CreateBox('road', { width: 40, depth: 40 }, scene);
  road.metadata = { procedural: true };
  const actor = MeshBuilder.CreateBox('actor', {}, scene);
  const distant = MeshBuilder.CreateBox('far', {}, scene); distant.position.x = 1000;
  const source = MeshBuilder.CreateBox('building-source', {}, scene); source.setEnabled(false); source.receiveShadows = true;
  const buildings = Array.from({ length: 120 }, (_, i) => { const instance = source.createInstance(`building${i}`);instance.position.x = i * .4; return instance; });
  const lamps = Array.from({ length: 20 }, (_, i) => { const mesh = MeshBuilder.CreateBox(`lamp${i}`, {}, scene); mesh.position.set(i * 2, 4, 0); mesh.scaling.set(1, 8, 1); return mesh; });
  lighting.setWorld(lamps, [road, actor, distant, ...buildings]); lighting.update(Vector3.Zero(), 1);
  assert.equal(scene.lights.length, 6); assert.equal(lighting.shadows.getShadowMap().renderList.length, 96);
  lighting.setTime(0); lighting.update(Vector3.Zero(), 1);
  assert.equal(lighting.streetLights.filter(light => light.intensity > 0).length, 4);
  assert.ok(lighting.streetLights.every(light => !light.includedOnlyMeshes.includes(road) && light.includedOnlyMeshes.includes(actor) && !light.includedOnlyMeshes.includes(distant) && !light.includedOnlyMeshes.some(mesh => mesh.isAnInstance)));
  assert.equal(lighting.sun.shadowEnabled, false); assert.equal(lighting.shadows.getShadowMap().renderList.length, 0);
  lighting.update(new Vector3(1000, 0, 0), 1);
  assert.ok(lighting.streetLights.every(light => light.intensity === 0));
  assert.equal(scene.lights.length, 6, 'travel and time changes never allocate more lights');
  const chosen = nearestLamps(lamps, Vector3.Zero());assert.equal(chosen.length, 4);assert.equal(chosen[0], lamps[0]);
  scene.dispose(); engine.dispose();
});

test('window and lamp emission updates at every LOD without adding textures to light heads', () => {
  const engine = new NullEngine(), scene = new Scene(engine), materials = new CityMaterials(scene, '/');
  const facades = [0, 1, 2].map(lod => materials.get('#ffffff', 'facade-glass', lod));
  const lamp = materials.get('#ffffff', 'light');
  materials.setNight(1);
  for (const facade of facades) {
    assert.equal(facade.emissiveTexture.level, .42);
    assert.equal(facade.useEmissiveAsIllumination, true);
    assert.equal(facade.isFrozen, false, 'native dynamic uniforms and per-mesh light lists stay live');
  }
  assert.equal(lamp.getActiveTextures().length, 0);assert.ok(lamp.emissiveColor.r > .9);
  materials.setNight(0);assert.equal(lamp.emissiveColor.r, 0);
  assert.ok(facades.every(material => material.emissiveTexture.level === 0));
  assert.equal(materials.get('#ffffff', 'facade-stone').emissiveTexture.level, 0, 'new/editor materials inherit current time');
  scene.dispose(); engine.dispose();
});
