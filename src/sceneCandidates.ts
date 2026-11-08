import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';

// Rebuild after scene edits/imports; colliders stay in scene.meshes for physics, never in the draw traversal.
export function visualCandidates(meshes: AbstractMesh[]) {
  const data = meshes.filter(mesh => !mesh.metadata?.collisionOnly && !(mesh.checkCollisions && mesh.collisionGroup === 2));
  return { data, length: data.length };
}
