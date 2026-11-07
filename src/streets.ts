import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import chicago from './generated/chicago.json' with { type: 'json' };

export type StreetFurniture = { templateId: 'tree' | 'lamp'; position: [number, number, number]; yaw: number };
export function elevationAt(_x: number, _z: number, surface: 'street' | 'sidewalk' | 'water' | 'riverwalk' = 'street') {
  // shortcut: flat Loop datum plus stylized river terraces; replace with surveyed terrain when available.
  return { street: 0, sidewalk: 0.16, water: -5.5, riverwalk: -3.8 }[surface];
}

// Procedural surfaces are batched by 256 m cell and material, not editable world-object records.
export function drawChicagoStreets(scene: Scene, material: (color: string) => Material) {
  const batches = new Map<string, { positions: number[]; indices: number[]; color: string; collision: boolean }>();
  const props: StreetFurniture[] = [];
  const cube = VertexData.CreateBox({ size: 1 });
  function batch(x: number, z: number, color: string, collision: boolean) {
    const key = `${Math.floor(x / 256)},${Math.floor(z / 256)},${color},${collision}`;
    if (!batches.has(key)) batches.set(key, { positions: [], indices: [], color, collision });
    return batches.get(key)!;
  }
  function box(x: number, y: number, z: number, w: number, h: number, d: number, yaw: number, color: string, collision = true) {
    const b = batch(x, z, color, collision), offset = b.positions.length / 3;
    const cos = Math.cos(yaw), sin = Math.sin(yaw), p = cube.positions!;
    for (let i = 0; i < p.length; i += 3) {
      const px = p[i]! * w, pz = p[i + 2]! * d;
      b.positions.push(x + px * cos + pz * sin, y + p[i + 1]! * h, z - px * sin + pz * cos);
    }
    for (const i of cube.indices!) b.indices.push(offset + i);
  }
  function surface(triangles: number[][][], y: number, color: string, collision: boolean, downward = false) {
    for (const tri of triangles) {
      const x = tri.reduce((s, p) => s + p[0]!, 0) / 3, z = tri.reduce((s, p) => s + p[1]!, 0) / 3;
      const b = batch(x, z, color, collision), offset = b.positions.length / 3;
      // Upward faces, regardless of GIS polygon winding.
      const [a, c, d] = tri;
      const points = (c![0]! - a![0]!) * (d![1]! - a![1]!) - (c![1]! - a![1]!) * (d![0]! - a![0]!) < 0 ? [a!, d!, c!] : [a!, c!, d!];
      if (downward) points.reverse();
      for (const p of points) b.positions.push(p[0]!, y, p[1]!);
      b.indices.push(offset, offset + 1, offset + 2);
    }
  }
  function walls(lines: number[][][], bottom: number, top: number, color: string) {
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, c = line[i]!;
      const b = batch((a[0]! + c[0]!) / 2, (a[1]! + c[1]!) / 2, color, true);
      // Independent vertices keep normals valid on both sides of the continuous wall.
      for (const reverse of [false, true]) {
        const offset = b.positions.length / 3;
        b.positions.push(a[0]!, bottom, a[1]!, c[0]!, bottom, c[1]!, a[0]!, top, a[1]!, c[0]!, top, c[1]!);
        b.indices.push(...(reverse ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2]).map(n => n + offset));
      }
    }
  }
  const data = chicago.environment;
  function drawTerrain() {
  for (const cell of data.terrain) surface(cell.triangles, elevationAt(0, 0), '#85877d', true);
  surface(data.water, elevationAt(0, 0, 'water'), '#517d85', false);
  surface(data.riverwalk, elevationAt(0, 0, 'riverwalk'), '#b1a993', true);
  surface(data.parks, 0.015, '#71896a', false);
  }
  drawTerrain();
  surface(data.roadSurface, 0.03, '#454e50', true);
  surface(data.sidewalks, elevationAt(0, 0, 'sidewalk'), '#b6b2a4', true);
  surface(data.curbs, 0.18, '#c0bba9', true);
  for (const edge of data.pavingEdges) walls(edge.lines, 0, edge.top, edge.color);
  for (const road of data.roads) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!;
      const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!, length = Math.hypot(dx, dz);
      if (length < 1) continue;
      const yaw = -Math.atan2(dz, dx);
      const nx = -dz / length, nz = dx / length;
      for (let distance = 9; distance < length - 10; distance += 16) {
        const t = distance / length;
        box(a[0]! + dx * t, 0.055, a[1]! + dz * t, 4, 0.01, 0.16, yaw, '#c3baa1', false);
      }
      if (!road.bridge && length > 45) for (let distance = 25; distance < length - 20; distance += 85) {
        const side = road.width / 2 + 2.2, t = distance / length;
        props.push({ templateId: 'lamp', position: [a[0]! + dx * t + nx * side, 4.16, a[1]! + dz * t + nz * side], yaw });
        props.push({ templateId: 'tree', position: [a[0]! + dx * t - nx * side, 4.16, a[1]! + dz * t - nz * side], yaw: 0 });
      }
    }
  }
  function drawElevatedRailway() {
    const railway = data.railway;
    surface(railway.deck, 6, '#505b55', true);
    surface(railway.deck, 5.65, '#505b55', true, true);
    walls(railway.edges, 5.65, 6, '#505b55');
    surface(railway.rails, 6.16, '#959b92', false);
    walls(railway.railEdges, 6, 6.16, '#959b92');
    for (const [x, z] of railway.supports) box(x!, 2.825, z!, 0.35, 5.65, 0.35, 0, '#505b55');
  }
  drawElevatedRailway();
  walls(data.shorelines, -5.5, -3.8, '#868b83');
  walls(data.terraceWalls, -3.8, 0, '#868b83');
  surface(data.bridgeDeck, -0.85, '#505b55', true, true);
  walls(data.bridgeEdges, -0.85, 0, '#505b55');
  walls(data.bridgeAbutments, -5.8, -0.85, '#868b83');
  for (const line of data.bridgeRails) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!, dx = b[0]! - a[0]!, dz = b[1]! - a[1]!;
    box((a[0]! + b[0]!) / 2, 0.66, (a[1]! + b[1]!) / 2, Math.hypot(dx, dz), 1, 0.18, -Math.atan2(dz, dx), '#868b83');
  }
  for (const ramp of data.ramps) {
    const a = ramp.top, c = ramp.bottom, dx = c[0]! - a[0]!, dz = c[2]! - a[2]!, length = Math.hypot(dx, dz);
    const nx = -dz / length * 1.4, nz = dx / length * 1.4;
    const b = batch(a[0]!, a[2]!, '#b1a993', true), offset = b.positions.length / 3;
    b.positions.push(a[0]! + nx, a[1]!, a[2]! + nz, a[0]! - nx, a[1]!, a[2]! - nz, c[0]! + nx, c[1]!, c[2]! + nz, c[0]! - nx, c[1]!, c[2]! - nz);
    b.indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
  }
  const meshes: Mesh[] = [];
  for (const [key, b] of batches) {
    const mesh = new Mesh(`street-${key}`, scene), vertexData = new VertexData();
    vertexData.positions = b.positions; vertexData.indices = b.indices;
    const normals: number[] = []; VertexData.ComputeNormals(b.positions, b.indices, normals); vertexData.normals = normals;
    vertexData.applyToMesh(mesh); mesh.material = material(b.color); mesh.checkCollisions = b.collision;
    mesh.isPickable = b.collision; mesh.metadata = { worldId: mesh.name, kind: 'ground', procedural: true };
    mesh.freezeWorldMatrix(); meshes.push(mesh);
  }
  return { meshes, props };
}
