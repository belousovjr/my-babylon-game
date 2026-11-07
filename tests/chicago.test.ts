import '@babylonjs/core/Meshes/instancedMesh.js';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { createWorld, parseWorld } from '../src/world.ts';
import { buildArchitecture, createCollisionPrototype } from '../src/architecture.ts';
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
  const accent=new StandardMaterial('accent',scene);accent.zOffset=-1;accent.zOffsetUnits=-1;
  const collisionBounds=createCollisionPrototype(scene).getBoundingInfo().boundingBox;
  for(const template of w.templates) {
    const levels=buildArchitecture(template,scene,mat,accent);
    assert.equal(levels.length,(template.lodDistances?.length??0)+1);
    const counts=levels.map(m=>m.getTotalIndices()/3);
    assert.ok(counts.every(n=>n>0&&n<2000));
    assert.ok(counts.every((n,i)=>i===0||n<=counts[i-1]),`${template.id}: LOD reduces triangles`);
    for(const level of levels) {
      const bounds=level.getBoundingInfo().boundingBox;
      if(template.kind==='building') assert.ok(bounds.minimum.x>=collisionBounds.minimum.x-1e-6 && bounds.maximum.x<=collisionBounds.maximum.x+1e-6);
      if(template.kind==='building') assert.ok(bounds.minimum.z>=collisionBounds.minimum.z-1e-6 && bounds.maximum.z<=collisionBounds.maximum.z+1e-6);
      assert.ok(level.subMeshes.length<=2,'body and decoration stay batched');
      if(['glass','stone'].includes(template.profile!) && level!==levels.at(-1)) {
        assert.equal(level.subMeshes.length,2);
        const materials=level.subMeshes.map(s=>s.getMaterial()!);
        assert.ok(materials.some(m=>m.zOffset===0));
        assert.ok(materials.some(m=>m.zOffset===-1&&m.zOffsetUnits===-1),'decorative planes have depth priority');
      }
    }
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

test('generated buildings follow editor grid and remain grounded', () => {
  for(const o of createWorld().objects) {
    assert.equal(o.position[0],Math.round(o.position[0]),`${o.id}: X`);
    assert.equal(o.position[2],Math.round(o.position[2]),`${o.id}: Z`);
    for(const n of o.size!) assert.ok(Math.abs(n*4-Math.round(n*4))<1e-8,`${o.id}: size`);
    const angle=o.yaw/(Math.PI/12);
    assert.ok(Math.abs(angle-Math.round(angle))<1e-8,`${o.id}: rotation`);
    assert.equal(o.position[1]-o.size![1]/2,0,`${o.id}: base stays on ground`);
  }
});

test('bridges have a collision underside visible from below', () => {
  const engine=new NullEngine(),scene=new Scene(engine),mat=new StandardMaterial('surface',scene);
  const {meshes}=drawChicagoStreets(scene,()=>mat);
  for(const mesh of meshes.filter(m=>m.name.includes('#505b55'))) {
    const positions=mesh.getVerticesData('position')!,indices=mesh.getIndices()!;
    for(let i=0;i<indices.length;i+=3) {
      const heights=[0,1,2].map(k=>positions[indices[i+k]*3+1]);
      if(heights.some(y=>Math.abs(y+0.85)<1e-6)) {
        assert.ok(heights.every(y=>y<=1e-6),'structural deck edges must not protrude through road or ground');
      }
    }
  }
  const triangle=data.environment.bridgeDeck.find(t=>Math.abs((t[1][0]-t[0][0])*(t[2][1]-t[0][1])-(t[1][1]-t[0][1])*(t[2][0]-t[0][0]))>1)!;
  const x=triangle.reduce((sum,p)=>sum+p[0],0)/3,z=triangle.reduce((sum,p)=>sum+p[1],0)/3;
  const ray=new Ray(new Vector3(x,-2,z),Vector3.Up(),2);
  assert.ok(meshes.some(m=>m.checkCollisions&&Math.abs((ray.intersectsMesh(m).pickedPoint?.y??99)+0.85)<0.001));
  scene.dispose();engine.dispose();
});

test('all generated trees and lamps stand on a collision surface', () => {
  const engine=new NullEngine(),scene=new Scene(engine),mat=new StandardMaterial('surface',scene);
  const {meshes,props}=drawChicagoStreets(scene,()=>mat);
  const failures=[];
  for(const prop of props) {
    const [x,base,z]=prop.position;
    const ray=new Ray(new Vector3(x,base+.5,z),Vector3.Down(),1);
    const hits=meshes.filter(m=>m.checkCollisions).map(m=>ray.intersectsMesh(m)).filter(h=>h.hit);
    if(!hits.some(h=>Math.abs(h.pickedPoint!.y-base)<1e-5)) failures.push({type:prop.templateId,x,z,base,floor:hits.map(h=>h.pickedPoint!.y)});
  }
  scene.dispose();engine.dispose();
  assert.deepEqual(failures,[]);
});

test('railway pillars reach slightly above the deck in rendered collision geometry', () => {
  const engine=new NullEngine(),scene=new Scene(engine),mat=new StandardMaterial('surface',scene);
  const {meshes}=drawChicagoStreets(scene,()=>mat);
  for(const support of data.environment.railway.supports) {
    const [x,,z]=support.position;
    const ray=new Ray(new Vector3(x-.6,6.025,z),Vector3.Right(),1.2);
    assert.ok(meshes.some(m=>m.checkCollisions&&ray.intersectsMesh(m).hit),`pillar at ${x}, ${z} must reach its cap`);
  }
  scene.dispose();engine.dispose();
});

test('paired railway columns have a continuous transverse bearing beam', () => {
  const engine=new NullEngine(),scene=new Scene(engine),mat=new StandardMaterial('surface',scene);
  const {meshes}=drawChicagoStreets(scene,()=>mat),supports=data.environment.railway.supports;
  assert.equal(supports.length%2,0);
  for(let i=0;i<supports.length;i+=2) {
    const a=supports[i].position,b=supports[i+1].position;
    const ray=new Ray(new Vector3((a[0]+b[0])/2,5.1,(a[2]+b[2])/2),Vector3.Up(),.3);
    assert.ok(meshes.some(m=>m.checkCollisions&&ray.intersectsMesh(m).hit),'frame beam must bridge the two columns');
  }
  scene.dispose();engine.dispose();
});

test('rail bridge truss uprights are present between the lower and upper chords', () => {
  const engine=new NullEngine(),scene=new Scene(engine),mat=new StandardMaterial('surface',scene);
  const {meshes}=drawChicagoStreets(scene,()=>mat);
  const trussMeshes=meshes.filter(m=>m.name.includes('#655044'));
  assert.ok(trussMeshes.length>0);
  for(const truss of data.environment.railway.bridgeTrusses) for(const side of truss.sides) {
    const [a,b]=side;
    if(truss.bankSupported) for(const point of side) {
      const ray=new Ray(new Vector3(point[0],-.01,point[1]),Vector3.Up(),.02);
      assert.ok(trussMeshes.some(m=>ray.intersectsMesh(m).hit),'standalone lower chord must touch bank elevation');
    }
    for(let j=0;j<=truss.panels;j++) {
      const t=j/truss.panels,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
      const ray=new Ray(new Vector3(x-.5,3,z),Vector3.Right(),1);
      assert.ok(trussMeshes.some(m=>ray.intersectsMesh(m).hit),'every truss upright connects the chords');
    }
  }
  scene.dispose();engine.dispose();
});


test('Marina tower LOD preserves every balcony ring while reducing radial detail', () => {
  const engine=new NullEngine(),scene=new Scene(engine),mat=new StandardMaterial('tower',scene);
  const template=createWorld().templates.find(t=>t.profile==='marina')!;
  const levels=buildArchitecture(template,scene,mat,mat);
  const ringHeights=levels.map(level=>{
    const positions=level.getVerticesData('position')!;
    const heights=new Set<number>();
    for(let i=0;i<positions.length;i+=3) {
      if(Math.hypot(positions[i]!,positions[i+2]!)>.49) heights.add(Math.round(positions[i+1]!*1e6));
    }
    return [...heights].sort((a,b)=>a-b);
  });
  assert.equal(ringHeights[0].length,36,'all eighteen rings have top and bottom faces');
  for(const heights of ringHeights) assert.deepEqual(heights,ringHeights[0]);
  const triangles=levels.map(level=>level.getTotalIndices()/3);
  assert.ok(triangles.every((count,i)=>i===0||count<triangles[i-1]!));
  scene.dispose();engine.dispose();
});
