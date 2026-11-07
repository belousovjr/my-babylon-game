import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { ObjectTemplate } from './world';

export const PROFILES = ['box', 'glass', 'stone', 'deco', 'bundled', 'rounded', 'marina', 'gothic', 'clock', 'tree', 'lamp'] as const;
export type Profile = typeof PROFILES[number];

// Local geometry is normalized to the editable collision box. Materials and geometry are shared by instances.
export function buildArchitecture(template: ObjectTemplate, scene: Scene, material: Material): Mesh[] {
  const profile = template.profile ?? 'box';
  return Array.from({ length: (template.lodDistances?.length ?? 0) + 1 }, (_, detail) => {
    const pieces: Mesh[] = [];
    const part = (x: number, y: number, z: number, w: number, h: number, d: number, shade = 1, round: boolean | 'sphere' = false) => {
      const mesh = round === 'sphere' ? MeshBuilder.CreateSphere('part', { diameter: 1, segments: 4 }, scene) : round
        ? MeshBuilder.CreateCylinder('part', { diameter: 1, height: 1, tessellation: detail === 0 ? 12 : 8 }, scene)
        : MeshBuilder.CreateBox('part', { size: 1 }, scene);
      mesh.scaling.set(w, h, d); mesh.position.set(x, y, z);
      mesh.setVerticesData('color', Array.from({ length: mesh.getTotalVertices() }, () => [shade, shade, shade, 1]).flat());
      pieces.push(mesh);
    };
    if (profile === 'bundled') {
      const heights = detail === 2 ? [0.75, 1, 0.52] : [0.52, 0.72, 0.92, 0.72, 1, 0.92, 0.52, 0.72, 0.52];
      part(0, -0.49, 0, 1, 0.02, 1);
      heights.forEach((h, i) => {
        const x = detail === 2 ? (i - 1) * 0.2 : (i % 3 - 1) * 0.2;
        const z = detail === 2 ? 0 : (Math.floor(i / 3) - 1) * 0.22;
        part(x, -0.5 + h * 0.47, z, 0.2, h * 0.94, detail === 2 ? 0.65 : 0.22);
      });
      if (detail === 0) for (const x of [-0.15, 0.15]) part(x, 0.45, 0, 0.012, 0.1, 0.012, 1.4);
    } else if (profile === 'rounded' || profile === 'deco') {
      for (let i = 0; i < 3; i++) {
        const width = 1 - i * 0.23;
        part(i * 0.04, -0.5 + i * 0.28 + 0.14, 0, width, 0.28, width, 1, profile === 'rounded');
      }
      part(0.08, 0.39, 0, 0.23, 0.1, 0.23, 1, profile === 'rounded');
      part(0.08, 0.47, 0, 0.015, 0.06, 0.015, 1.3);
    } else if (profile === 'marina') {
      part(0, -0.03, 0, 0.78, 0.94, 0.78, 0.75, true);
      const rings = detail === 0 ? 18 : detail === 1 ? 8 : 2;
      for (let i = 0; i < rings; i++) part(0, -0.46 + i * 0.9 / rings, 0, 1, 0.015, 1, 1.15, true);
      part(0, 0.46, 0, 0.8, 0.08, 0.8, 1, true);
    } else if (profile === 'clock' || profile === 'gothic') {
      part(0, -0.21, 0, 1, 0.58, 1);
      part(0, 0.17, 0, 0.52, 0.3, 0.58, 1.08);
      part(0, 0.37, 0, 0.34, 0.1, 0.4, 1.18);
      part(0, 0.46, 0, 0.1, 0.08, 0.1, 0.75);
      if (detail < 2) for (const x of [-0.27, 0.27]) for (const z of [-0.28, 0.28]) part(x, 0.33, z, 0.07, 0.18, 0.07, 1.1);
      if (profile === 'gothic' && detail === 0) for (const x of [-0.45, 0.45]) for (const z of [-0.45, 0.45]) part(x, -0.13, z, 0.055, 0.74, 0.055, 1.1);
      if (profile === 'clock' && detail === 0) for (const z of [-0.296, 0.296]) part(0, 0.22, z, 0.15, 0.05, 0.015, 0.45);
    } else if (profile === 'tree') {
      part(0, -0.25, 0, 0.12, 0.5, 0.12, 0.5, true);
      part(0, 0.15, 0, 0.9, 0.7, 0.9, 1, 'sphere');
      if (detail === 0) part(0.2, 0.34, 0, 0.5, 0.3, 0.55, 1.12, 'sphere');
    } else if (profile === 'lamp') {
      part(0, -0.03, 0, 0.13, 0.94, 0.13, 0.8, true);
      part(0.23, 0.43, 0, 0.55, 0.04, 0.08, 1.2);
      if (detail === 0) part(0.45, 0.4, 0, 0.25, 0.05, 0.25, 2);
    } else {
      part(0, 0, 0, 1, 1, 1);
    }
    if (detail < 2 && ['glass', 'stone', 'deco'].includes(profile)) {
      part(0, -0.46, 0, 1.03, 0.08, 1.03, 0.72);
      part(0, 0.48, 0, 1.02, 0.04, 1.02, 1.25);
      if (detail === 0) {
        for (let i = 1; i < 8; i++) part(0, -0.5 + i / 8, 0, 1.005, 0.008, 1.005, profile === 'glass' ? 0.7 : 0.87);
        for (const x of [-0.33, 0, 0.33]) for (const z of [-0.502, 0.502]) part(x, 0, z, 0.012, 0.96, 0.012, 1.25);
      }
    }
    const result = Mesh.MergeMeshes(pieces, true, true)!;
    result.name = `template-${template.id}-lod${detail}`; result.material = material;
    result.isPickable = false; result.checkCollisions = false; result.setEnabled(false);
    return result;
  });
}
