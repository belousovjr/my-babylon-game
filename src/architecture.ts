import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { ObjectTemplate } from './world';

export const PROFILES = ['box', 'glass', 'stone', 'deco', 'bundled', 'rounded', 'marina', 'gothic', 'clock', 'tree', 'lamp', 'traffic_signal'] as const;
export type Profile = typeof PROFILES[number];

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
export function buildArchitecture(template: ObjectTemplate, scene: Scene, material: Material, detailMaterial: Material, signalHeadings: number[] = [0], surfaceMaterial?: (lod: number, accent: boolean, luminous: boolean) => Material): Mesh[] {
  const profile = template.profile ?? 'box';
  return Array.from({ length: (template.lodDistances?.length ?? 0) + 1 }, (_, detail) => {
    const pieces: Mesh[] = [], accents: Mesh[] = [];
    const part = (x: number, y: number, z: number, w: number, h: number, d: number, shade = 1, round: boolean | 'sphere' = false, luminous = false) => {
      const mesh = round === 'sphere' ? MeshBuilder.CreateSphere('part', { diameter: 1, segments: 4 }, scene) : round
        ? MeshBuilder.CreateCylinder('part', { diameter: 1, height: 1, tessellation: detail === 0 ? 12 : profile === 'marina' && detail >= 2 ? 6 : 8 }, scene)
        : MeshBuilder.CreateBox('part', { size: 1 }, scene);
      mesh.scaling.set(w, h, d); mesh.position.set(x, y, z);
      mesh.setVerticesData('color', Array.from({ length: mesh.getTotalVertices() }, () => [shade, shade, shade, 1]).flat());
      mesh.material = surfaceMaterial?.(detail, shade !== 1, luminous) ?? (shade === 1 ? material : detailMaterial);
      if (surfaceMaterial && profile !== 'tree' && !luminous) {
        const positions = mesh.getVerticesData('position')!, normals = mesh.getVerticesData('normal')!, sourceUVs = mesh.getVerticesData('uv')!, uvs: number[] = [];
        const facade = template.kind === 'building' && shade === 1 && profile !== 'marina';
        for (let i = 0; i < positions.length; i += 3) {
          const px = positions[i]! * w + x, py = positions[i + 1]! * h + y, pz = positions[i + 2]! * d + z;
          const nx = Math.abs(normals[i]!), ny = Math.abs(normals[i + 1]!), nz = Math.abs(normals[i + 2]!);
          if (facade && ny > 0.5) uvs.push(0.004 + positions[i]! * 0.004, 0.004 + positions[i + 2]! * 0.004);
          else if (facade) {
            const u = round ? sourceUVs[i / 3 * 2]! * Math.PI * template.size[0] / 16
              : nx > nz ? pz * template.size[2] / 16 : px * template.size[0] / 16;
            uvs.push(u, py + 0.5);
          } else {
            uvs.push((ny > 0.5 || nz >= nx ? px * template.size[0] : pz * template.size[2]) / 4,
              (ny > 0.5 ? pz * template.size[2] : py * template.size[1]) / 4);
          }
        }
        mesh.setVerticesData('uv', uvs);
      }
      (shade === 1 ? pieces : accents).push(mesh);
      return mesh;
    };
    if (profile === 'bundled') {
      const heights = detail === 2 ? [0.75, 1, 0.52] : [0.52, 0.72, 0.92, 0.72, 1, 0.92, 0.52, 0.72, 0.52];
      part(0, -0.49, 0, 1, 0.02, 1);
      heights.forEach((h, i) => {
        const x = detail === 2 ? (i - 1) * 0.2 : (i % 3 - 1) * 0.2;
        const z = detail === 2 ? 0 : (Math.floor(i / 3) - 1) * 0.22;
        part(x, -0.5 + h * 0.47, z, 0.2, h * 0.94, detail === 2 ? 0.65 : 0.22);
      });
      if (detail === 0) for (const i of [4, 5]) {
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
      if (detail === 0) part(0.45, 0.4, 0, 0.25, 0.05, 0.25, 2, false, true);
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
    // Group before merging so the body and accents each remain a single submesh.
    const result = Mesh.MergeMeshes([...pieces, ...accents], true, true, undefined, false, true)!;
    result.name = `template-${template.id}-lod${detail}`;
    result.isPickable = false; result.checkCollisions = false; result.setEnabled(false);
    return result;
  });
}
