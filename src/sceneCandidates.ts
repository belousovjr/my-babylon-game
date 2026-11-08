import type { PerformanceFlags } from './performanceControls.ts';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';

// Rebuild after scene edits/imports; colliders stay in scene.meshes for physics, never in the draw traversal.
export function visualCandidates(meshes: AbstractMesh[], flags?: PerformanceFlags) {
  const data = meshes.filter(mesh => !mesh.metadata?.collisionOnly && !(mesh.checkCollisions && mesh.collisionGroup === 2));
  const visible = flags ? data.filter(mesh => {
    if (mesh.metadata?.beacon) return flags.beacons;
    if (mesh.metadata?.profile === 'tree') return flags.trees;
    if (['#517d85', '#6a644e'].includes(mesh.metadata?.surface)) return flags.water;
    return flags.city || !(mesh.metadata?.worldId || mesh.metadata?.procedural);
  }) : data;
  return { data: visible, length: visible.length };
}
