export type Kind = 'building' | 'ground' | 'obstacle';
export type Triple = [number, number, number];
export interface WorldObject {
  id: string;
  kind: Kind;
  position: Triple;
  size: Triple;
  yaw: number;
  color: string;
}
export interface WorldData {
  version: 1;
  spawn: Triple;
  objects: WorldObject[];
}
export const CELL_SIZE = 64;
export const WORLD_LIMIT = 2048;
export function cellAt(x: number, z: number): string {
  return `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;
}

// Imported maps are untrusted; reject the entire file before touching the current scene.
export function parseWorld(input: unknown): WorldData {
  const fail = (): never => { throw new Error('Некорректная карта: проверьте версию, ID, координаты и размеры объектов.'); };
  const triple = (v: unknown, size = false): v is Triple => Array.isArray(v) && v.length === 3 &&
    v.every(n => typeof n === 'number' && Number.isFinite(n) && (size ? n >= 0.25 && n <= 128 : Math.abs(n) <= WORLD_LIMIT));
  if (!input || typeof input !== 'object') return fail();
  const w = input as WorldData;
  if (w.version !== 1 || !triple(w.spawn) || w.spawn[1] < 0 || !Array.isArray(w.objects) || w.objects.length > 2000) return fail();
  const ids = new Set<string>();
  const objects = w.objects.map(o => {
    if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !/^[\w-]{1,80}$/.test(o.id) || ids.has(o.id) ||
      !['building', 'ground', 'obstacle'].includes(o.kind) || !triple(o.position) || !triple(o.size, true) ||
      typeof o.yaw !== 'number' || !Number.isFinite(o.yaw) || Math.abs(o.yaw) > Math.PI * 2 ||
      typeof o.color !== 'string' || !/^#[\da-f]{6}$/i.test(o.color)) return fail();
    ids.add(o.id);
    return { id: o.id, kind: o.kind, position: [...o.position] as Triple, size: [...o.size] as Triple, yaw: o.yaw, color: o.color };
  });
  return { version: 1, spawn: [...w.spawn], objects };
}

export function createWorld(): WorldData {
  const objects: WorldObject[] = [];
  const colors = ['#9caba9', '#bcc4b8', '#84999b', '#b7ad98', '#74868b'];
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const x = cx * CELL_SIZE, z = cz * CELL_SIZE;
    objects.push({ id: `ground-${cx}-${cz}`, kind: 'ground', position: [x + 32, -0.5, z + 32], size: [64, 1, 64], yaw: 0, color: '#39484e' });
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      if ((i === 1 || i === 2) && (j === 1 || j === 2)) continue;
      const h = 5 + ((i * 7 + j * 11 + cx * cx + cz * cz) % 5) * 3;
      objects.push({ id: `building-${cx}-${cz}-${i}-${j}`, kind: 'building', position: [x + 9 + i * 15, h / 2, z + 9 + j * 15], size: [9, h, 9], yaw: 0, color: colors[(i + j + 3) % colors.length]! });
    }
    for (let i = 0; i < 3; i++) objects.push({ id: `step-${cx}-${cz}-${i}`, kind: 'obstacle', position: [x + 24 + i * 4, (i + 1) * 0.3, z + 35], size: [3, (i + 1) * 0.6, 3], yaw: 0, color: '#d4a663' });
  }
  return { version: 1, spawn: [32, 1, 22], objects };
}
