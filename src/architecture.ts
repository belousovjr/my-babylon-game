import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { ObjectTemplate } from './world';
import facadeLayout from './facadeLayout.json' with { type: 'json' };

import type { Profile } from './profiles.ts';
export { PROFILES } from './profiles.ts';
export type { Profile } from './profiles.ts';

export function spireTips(profile?: Profile): [number, number, number][] {
  if (profile === 'bundled') return [[0, 0.5, 0], [0.2, 0.5, 0]];
  if (profile === 'rounded' || profile === 'deco') return [[0.08, 0.5, 0]];
  if (profile === 'clock' || profile === 'gothic') return [[0, 0.5, 0]];
  return [];
}

export function setArchitectureStatic(root: Mesh, frozen: boolean) {
  for (const mesh of [root, ...root.getChildMeshes()]) {
    if (frozen) mesh.freezeWorldMatrix();
    else mesh.unfreezeWorldMatrix();
  }
}

export function createCollisionPrototype(scene: Scene): Mesh {
  // Match the 1.03-wide architectural plinths without changing instance/editor dimensions.
  const mesh = MeshBuilder.CreateBox('collision-prototype', { width: 1.03, height: 1, depth: 1.03 }, scene);
  mesh.setEnabled(false);
  return mesh;
}

export function attachCollisionGeometry(root: Mesh, source: Mesh): Mesh {
  // Keep the editor/camera bounds separate from the player's stable, shared collision geometry.
  root.checkCollisions = true;
  root.collisionGroup = 2;
  const collider = source.clone(`${root.name}-collision`, root, true)!;
  collider.isVisible = false;
  collider.isPickable = false;
  collider.checkCollisions = true;
  collider.collisionGroup = 1;
  collider.metadata = { ...root.metadata, worldId: root.name, collisionOnly: true };
  collider.setEnabled(true);
  collider.computeWorldMatrix(true);
  return collider;
}

// Local geometry is normalized to the editable collision box. Materials and geometry are shared by instances.
export function buildArchitecture(template: ObjectTemplate, scene: Scene, material: Material, detailMaterial: Material, signalHeadings: number[] = [0], surfaceMaterial?: (lod: number, accent: boolean, luminous: boolean, role?: 'roof' | 'base') => Material): Mesh[] {
  const profile = template.profile ?? 'box';
  const panelled = ['glass', 'stone', 'deco'].includes(profile);
  const grid = profile === 'glass' ? facadeLayout.glass : facadeLayout.masonry;
  const { bodyBottom, bodyTop } = facadeLayout;
  const bodyHeight = bodyTop - bodyBottom;
  return Array.from({ length: (template.lodDistances?.length ?? 0) + 1 }, (_, detail) => {
    const pieces: Mesh[] = [];
    const part = (x: number, y: number, z: number, w: number, h: number, d: number, shade = 1, round: boolean | 'sphere' = false, luminous = false, role?: 'roof' | 'base') => {
      const mesh = round === 'sphere' ? MeshBuilder.CreateSphere('part', { diameter: 1, segments: 4 }, scene) : round
        ? MeshBuilder.CreateCylinder('part', { diameter: 1, height: 1, tessellation: detail === 0 ? 12 : profile === 'marina' && detail >= 2 ? 6 : 8 }, scene)
        : MeshBuilder.CreateBox('part', { size: 1 }, scene);
      mesh.scaling.set(w, h, d); mesh.position.set(x, y, z);
      mesh.setVerticesData('color', Array.from({ length: mesh.getTotalVertices() }, () => [shade, shade, shade, 1]).flat());
      const accent = profile === 'marina' ? shade !== 0.75 : shade !== 1;
      mesh.material = surfaceMaterial?.(detail, accent, luminous, role) ?? (shade === 1 ? material : detailMaterial);
      if (surfaceMaterial && profile !== 'tree' && !luminous) {
        const positions = mesh.getVerticesData('position')!, normals = mesh.getVerticesData('normal')!, sourceUVs = mesh.getVerticesData('uv')!, uvs: number[] = [];
        const facade = template.kind === 'building' && !accent && !role;
        for (let i = 0; i < positions.length; i += 3) {
          const px = positions[i]! * w + x, py = positions[i + 1]! * h + y, pz = positions[i + 2]! * d + z;
          const nx = Math.abs(normals[i]!), ny = Math.abs(normals[i + 1]!), nz = Math.abs(normals[i + 2]!);
          if (facade && ny > 0.5) uvs.push(0.004 + positions[i]! * 0.004, 0.004 + positions[i + 2]! * 0.004);
          else if (facade) {
            const u = round ? sourceUVs[i / 3 * 2]! : (nx > nz ? pz : px) + 0.5;
            uvs.push(u, panelled ? (py - bodyBottom) / bodyHeight : py + 0.5);
          } else {
            uvs.push((ny > 0.5 || nz >= nx ? px * template.size[0] : pz * template.size[2]) / 4,
              (ny > 0.5 ? pz * template.size[2] : py * template.size[1]) / 4);
          }
        }
        mesh.setVerticesData('uv', uvs);
      }
      pieces.push(mesh);
      if (surfaceMaterial && template.kind === 'building' && !accent && !role && !['glass', 'stone', 'deco'].includes(profile)) {
        // Keep a matte roof over every stepped volume without changing its silhouette.
        part(x, y + h / 2 - 0.001, z, w, 0.002, d, 1, round, false, 'roof');
      }
      return mesh;
    };
    if (profile === 'bundled') {
      const heights = [0.52, 0.72, 0.92, 0.72, 1, 0.92, 0.52, 0.72, 0.52];
      part(0, -0.49, 0, 1, 0.02, 1, 1, false, false, 'base');
      heights.forEach((h, i) => {
        const x = (i % 3 - 1) * 0.2;
        const z = (Math.floor(i / 3) - 1) * 0.22;
        part(x, -0.5 + h * 0.47, z, 0.2, h * 0.94, 0.22);
      });
      for (const i of [4, 5]) {
        const roof = -0.5 + heights[i]! * 0.94;
        part((i % 3 - 1) * 0.2, (roof + 0.5) / 2, 0, 0.012, 0.5 - roof, 0.012, 1.4);
      }
    } else if (profile === 'rounded' || profile === 'deco') {
      for (let i = 0; i < 3; i++) {
        const width = 1 - i * 0.23;
        part(i * 0.04, -0.5 + i * 0.28 + 0.14, 0, width, 0.28, width, 1, profile === 'rounded');
      }
      part(0.08, 0.39, 0, 0.23, 0.1, 0.23, 1, profile === 'rounded');
      part(0.08, 0.47, 0, 0.015, 0.06, 0.015, 1.3);
    } else if (profile === 'marina') {
      part(0, -0.03, 0, 0.78, 0.94, 0.78, 0.75, true);
      const rings = 18;
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
    } else if (profile === 'traffic_signal') {
      part(0, -0.12, 0, 0.14, 0.76, 0.14, 0.2);
      for (const angle of signalHeadings) {
        const housing = part(Math.sin(angle) * 0.2, 0.20, Math.cos(angle) * 0.2, 0.58, 0.25, 0.28, 0.12);
        housing.rotation.y = angle;
        for (const [i, color] of [[1, 0.04, 0.02], [0.12, 0.09, 0.01], [0.01, 0.09, 0.03]].entries()) {
          if (detail > 0 && i > 0) continue;
          const lens = part(Math.sin(angle) * 0.355, 0.275 - i * 0.075, Math.cos(angle) * 0.355, 0.32, 0.045, 0.035, 1, false, true);
          lens.rotation.y = angle;
          lens.setVerticesData('color', Array.from({ length: lens.getTotalVertices() }, () => [...color, 1]).flat());
        }
      }
    } else if (profile === 'lamp') {
      part(0, -0.03, 0, 0.13, 0.94, 0.13, 0.8, detail === 0);
      part(0.23, 0.43, 0, 0.55, 0.04, 0.08, 1.2);
      part(0.45, 0.4, 0, 0.25, 0.05, 0.25, 2, false, true);
    } else {
      part(0, 0, 0, 1, 1, 1);
    }
    if (panelled) {
      part(0, (-0.5 + bodyBottom) / 2, 0, 1.03, bodyBottom + 0.5, 1.03, 0.72, false, false, 'base');
      part(0, (bodyTop + 0.5) / 2, 0, 1.02, 0.5 - bodyTop, 1.02, 1.25, false, false, 'roof');
      if (detail === 0) {
        // Place structural details on window-cell boundaries and keep them inside the opaque gaps.
        const beltHeight = Math.min(0.008, 1.6 * Math.min(grid.insetTop, grid.insetBottom) / facadeLayout.size * bodyHeight);
        const ribWidth = Math.min(0.012, 1.6 * grid.insetX / facadeLayout.size);
        for (let i = 1; i < 8; i++) {
          const row = Math.round(grid.rows * i / 8);
          part(0, bodyBottom + row / grid.rows * bodyHeight, 0, 1.005, beltHeight, 1.005, profile === 'glass' ? 0.7 : 0.87);
        }
        for (const fraction of [1 / 6, 1 / 2, 5 / 6]) {
          const x = Math.round(grid.columns * fraction) / grid.columns - 0.5;
          for (const z of [-0.502, 0.502]) part(x, (bodyTop + bodyBottom) / 2, z, ribWidth, bodyHeight, 0.012, 1.25);
        }
      }
    }
    // Group by material so repeated details share a single submesh.
    const result = Mesh.MergeMeshes(pieces.sort((a, b) => a.material!.uniqueId - b.material!.uniqueId), true, true, undefined, false, true)!;
    result.name = `template-${template.id}-lod${detail}`;
    result.isPickable = false; result.checkCollisions = false; result.setEnabled(false);
    return result;
  });
}
