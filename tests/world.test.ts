import { strict as assert } from 'node:assert';
import { cellAt, createWorld, parseWorld } from '../src/world.ts';
const world = createWorld();
assert.deepEqual(parseWorld(JSON.parse(JSON.stringify(world))), world);
assert.equal(new Set(world.objects.map(o => o.id)).size, world.objects.length);
assert.equal(cellAt(-0.1, 64), '-1,1');
assert.equal(cellAt(63.9, -64), '0,-1');
for (const mutate of [
  (w: any) => { w.version = 2; },
  (w: any) => { w.objects[0].position[0] = NaN; },
  (w: any) => { w.objects[0].size[1] = -1; },
  (w: any) => { w.objects[0].color = 'url(bad)'; },
  (w: any) => { w.objects.push(w.objects[0]); },
  (w: any) => { w.spawn = [0, -10, 0]; },
  (w: any) => { w.objects = Array(2001).fill(w.objects[0]); },
]) {
  const invalid = structuredClone(world); mutate(invalid);
  assert.throws(() => parseWorld(invalid));
}
console.log('World: round trip, cell boundaries, IDs and import validation passed.');
