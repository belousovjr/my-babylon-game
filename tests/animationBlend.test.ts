import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { AnimationBlend } from '../src/animationBlend.ts';

test('crossfade preserves normalized weights through interruptions and stops unused clips', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const target = { angle: 0 };
  const groups = ['idle', 'walk', 'run', 'jump'].map((name, index) => {
    const animation = new Animation(name, 'angle', 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
    animation.setKeys([{ frame: 0, value: index }, { frame: 30, value: index + 1 }]);
    const group = new AnimationGroup(name, scene); group.addTargetedAnimation(animation, target); return group;
  });
  const blend = new AnimationBlend(groups);
  const total = () => groups.filter(g => g.isPlaying).reduce((sum, g) => sum + g.weight, 0);
  blend.update('idle', 1/60); assert.equal(groups[0].weight, 1);
  blend.update('walk', 0.075);
  assert.ok(Math.abs(groups[0].weight - 0.5) < 1e-8);
  assert.ok(Math.abs(groups[1].weight - 0.5) < 1e-8);
  const before = groups.map(g => g.weight);
  blend.update('run', 0);
  assert.equal(groups[0].weight, before[0]); assert.equal(groups[1].weight, before[1]);
  assert.equal(groups[2].weight, 0); assert.ok(Math.abs(total() - 1) < 1e-8);
  for (const name of ['jump', 'walk', 'run', 'idle']) {
    blend.update(name, 0.02);
    assert.ok(Math.abs(total() - 1) < 1e-8);
    assert.ok(groups.filter(g => g.isPlaying).every(g => g.weight >= 0 && g.weight <= 1));
  }
  blend.update('idle', 0.15);
  assert.equal(groups[0].weight, 1);
  assert.ok(groups.slice(1).every(g => !g.isPlaying));
  for (const g of groups.filter(g => g.isPlaying)) assert.ok(g.animatables.every(a => a.weight === g.weight));
  blend.update('missing', 0.1); assert.equal(groups[0].weight, 1);
  for (const dt of [1/30, 1/60, 1/144]) {
    blend.update('walk', 0);
    for (let i=0; i<Math.ceil(0.15/dt)+1; i++) blend.update('walk', dt);
    assert.equal(groups[1].weight, 1); assert.equal(groups[0].isPlaying, false);
    blend.update('idle', 0.2);
  }
  scene.dispose(); engine.dispose();
});

test('landing does not interpolate a horizontal flight pose through the floor', () => {
  const engine=new NullEngine(),scene=new Scene(engine),target={angle:0};
  const groups=['Fly_Loop','Jump_Land'].map((name,i)=>{
    const animation=new Animation(name,'angle',30,Animation.ANIMATIONTYPE_FLOAT,Animation.ANIMATIONLOOPMODE_CYCLE);
    animation.setKeys([{frame:0,value:i},{frame:30,value:i}]);
    const group=new AnimationGroup(name,scene);group.addTargetedAnimation(animation,target);return group;
  });
  const blend=new AnimationBlend(groups);
  blend.update('Fly_Loop',.1);blend.update('Jump_Land',0);
  assert.equal(groups[0].isPlaying,false);assert.equal(groups[1].weight,1);
  assert.equal(groups[1].loopAnimation,false);
  scene.dispose();engine.dispose();
});
