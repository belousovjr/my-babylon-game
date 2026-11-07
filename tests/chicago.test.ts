import '@babylonjs/core/Meshes/instancedMesh.js';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { createWorld, parseWorld } from '../src/world.ts';
import { buildArchitecture } from '../src/architecture.ts';
import { drawChicagoStreets } from '../src/streets.ts';
import { boxEntry } from '../src/followCamera.ts';
import data from '../src/generated/chicago.json' with { type: 'json' };

test('Chicago snapshot has measured scale, landmark heights, valid templates and independent LOD geometry', () => {
  const w=createWorld();assert.equal(w.environment,'chicago-loop');assert.equal(w.version,3);
  assert.equal(w.objects.length,data.report.buildings);assert.ok(w.objects.length>500);
  assert.ok(w.objects.some(o=>o.templateId==='bundled'&&o.size![1]===442));
  assert.equal(new Set(w.objects.map(o=>o.id)).size,w.objects.length);
  assert.ok(data.report.heights.estimated>0,'estimated heights explicitly reported');
  const engine=new NullEngine(),scene=new Scene(engine),mat=new StandardMaterial('shared',scene);
  for(const template of w.templates) {
    const levels=buildArchitecture(template,scene,mat);
    assert.equal(levels.length,(template.lodDistances?.length??0)+1);
    const counts=levels.map(m=>m.getTotalIndices()/3);
    assert.ok(counts.every(n=>n>0&&n<2000));
    assert.ok(counts.every((n,i)=>i===0||n<=counts[i-1]),`${template.id}: LOD reduces triangles`);
    assert.ok(levels.every(m=>m.getVerticesData('color')?.length===m.getTotalVertices()*4));
    const a=levels[0].createInstance('a'),b=levels[0].createInstance('b');
    a.position.x=20;assert.equal(b.position.x,0);a.dispose();b.dispose();levels.forEach(m=>m.dispose());
  }
  for(const bad of [[200,100],[-1],[20,NaN],[10,20,30]]) { const invalid=structuredClone(w);invalid.templates[0].lodDistances=bad;assert.throws(()=>parseWorld(invalid)); }
  const invalid=structuredClone(w);(invalid.templates[0] as any).profile='unsupported';assert.throws(()=>parseWorld(invalid));
  scene.dispose();engine.dispose();
});

test('procedural streets have upward floors and walkable spawn without one object per curb', () => {
  const engine=new NullEngine(),scene=new Scene(engine),mat=new StandardMaterial('surface',scene);
  const {meshes,props}=drawChicagoStreets(scene,()=>mat);
  assert.ok(meshes.length<1000,'cell batching keeps mesh count bounded');
  assert.ok(props.some(p=>p.templateId==='tree')&&props.some(p=>p.templateId==='lamp'));
  for(const m of meshes) {
    assert.ok(m.metadata.procedural);assert.ok(m.getTotalIndices()>0);
    const normals=m.getVerticesData('normal')!;assert.ok(normals.every(Number.isFinite));
  }
  const spawn=createWorld().spawn;
  const ray=new Ray(new Vector3(spawn[0],5,spawn[2]),Vector3.Down(),10);
  const hits=meshes.filter(m=>m.checkCollisions).map(m=>ray.intersectsMesh(m)).filter(h=>h.hit);
  assert.ok(hits.some(h=>h.pickedPoint!.y>=0&&h.pickedPoint!.y<0.3),'spawn is supported at street level');
  const [x,z]=data.environment.water[0][0];
  // Geometry-aware floor query must agree with actual triangle picking, not fill empty space in a batch's bounds.
  for(const mesh of meshes.slice(0,10)) {
    const origin=new Vector3(x,20,z),hit=new Ray(origin,Vector3.Down(),30).intersectsMesh(mesh);
    assert.equal(boxEntry(origin,Vector3.Down(),30,mesh,0)!==null,hit.hit&&hit.distance<=30);
  }
  scene.dispose();engine.dispose();
});
