import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { WATER_LEVEL, riverbedElevation } from '../src/water.ts';
import { drawChicagoStreets } from '../src/streets.ts';
import chicago from '../src/generated/chicago.json' with { type: 'json' };

const area = ([a,b,c]) => Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;

test('riverbed covers all water, has bounded relief and supports collisions', () => {
  const data = chicago.environment;
  assert.ok(Math.abs(data.waterbed.reduce((sum,t)=>sum+area(t),0)-data.water.reduce((sum,t)=>sum+area(t),0))<1e-5);
  const engine = new NullEngine(), scene = new Scene(engine), material = new StandardMaterial('ground',scene);
  const beds = drawChicagoStreets(scene,()=>material).meshes.filter(mesh=>mesh.name.includes('#6a644e'));
  assert.ok(beds.length>0 && beds.length<50);
  const heights = [];
  for (const bed of beds) {
    assert.equal(bed.checkCollisions,true);
    const positions=bed.getVerticesData('position');
    for(let i=0;i<positions.length;i+=3) {
      heights.push(positions[i+1]);
      assert.ok(Math.abs(positions[i+1]-riverbedElevation(positions[i],positions[i+2]))<1e-5);
    }
  }
  assert.ok(Math.max(...heights)-Math.min(...heights)>4);
  assert.ok(Math.max(...heights)<=WATER_LEVEL-1.49 && Math.min(...heights)>WATER_LEVEL-8);
  for (const ring of data.shorelines) for (const [x,z] of ring) {
    assert.ok(Math.abs(riverbedElevation(x,z)-(WATER_LEVEL-1.5))<1e-6, 'every bank stays shallow');
  }
  assert.ok(Math.min(...heights)<WATER_LEVEL-6, 'the channel interior is substantially deeper than its banks');
  const tri=[...data.water].sort((a,b)=>area(b)-area(a))[0];
  const x=tri.reduce((sum,p)=>sum+p[0],0)/3,z=tri.reduce((sum,p)=>sum+p[1],0)/3;
  const ray=new Ray(new Vector3(x,WATER_LEVEL-.1,z),Vector3.Down(),10);
  assert.ok(beds.some(bed=>ray.intersectsMesh(bed).hit));
  scene.dispose();engine.dispose();
});
