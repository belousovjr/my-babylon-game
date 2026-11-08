import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { visualCandidates } from '../src/sceneCandidates.ts';

test('draw candidates omit collision-only geometry but retain hidden LODs and collidable ground',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  const collider=MeshBuilder.CreateBox('collider',{},scene);collider.metadata={collisionOnly:true};collider.checkCollisions=true;
  const root=MeshBuilder.CreateBox('editor-root',{},scene);root.checkCollisions=true;root.collisionGroup=2;
  const lod=MeshBuilder.CreateBox('hidden-lod',{},scene);lod.isVisible=false;
  const ground=MeshBuilder.CreateBox('ground',{},scene);ground.checkCollisions=true;
  const candidates=visualCandidates(scene.meshes);
  assert.deepEqual(candidates.data,[lod,ground]);assert.equal(candidates.length,2);
  assert.ok(scene.meshes.includes(collider) && scene.meshes.includes(root),'physics sources remain available');
  lod.isVisible=true;assert.ok(candidates.data.includes(lod),'LOD activation needs no candidate rebuild');
  const added=MeshBuilder.CreateBox('new-model',{},scene);assert.ok(visualCandidates(scene.meshes).data.includes(added));
  scene.dispose();engine.dispose();
});
