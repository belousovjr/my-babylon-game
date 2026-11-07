export type Kind = 'building' | 'ground' | 'obstacle';
export type Triple = [number, number, number];
export interface ObjectTemplate {
  id: string;
  name: string;
  kind: Kind;
  size: Triple;
  color: string;
}
export interface WorldObject {
  id: string;
  templateId: string;
  position: Triple;
  yaw: number;
  size?: Triple;
  color?: string;
}
export interface WorldData {
  version: 2;
  spawn: Triple;
  templates: ObjectTemplate[];
  objects: WorldObject[];
}
export function defaultTemplates(): ObjectTemplate[] {
  return [
    { id: 'building', name: 'Здание', kind: 'building', size: [9, 10, 9], color: '#9caba9' },
    { id: 'ground', name: 'Земля', kind: 'ground', size: [64, 1, 64], color: '#39484e' },
    { id: 'obstacle', name: 'Препятствие', kind: 'obstacle', size: [3, 1, 3], color: '#d4a663' },
  ];
}
export function objectProperties(world: WorldData, object: WorldObject) {
  const template = world.templates.find(t => t.id === object.templateId)!;
  return { kind: template.kind, size: object.size ?? template.size, color: object.color ?? template.color };
}
export function setObjectSize(world: WorldData, object: WorldObject, size: Triple) {
  const template = world.templates.find(t => t.id === object.templateId)!;
  if (size.every((n, i) => Math.abs(n - template.size[i]!) < 1e-6)) delete object.size;
  else object.size = [...size];
}
export const CELL_SIZE = 64;
export const WORLD_LIMIT = 2048;
export function cellAt(x: number, z: number): string {
  return `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;
}

// Validate and copy the whole map before replacing the current scene. V1 maps migrate without losing IDs or transforms.
export function parseWorld(input: unknown): WorldData {
  const fail = (): never => { throw new Error('Некорректная карта: проверьте версию, шаблоны, ID, координаты и размеры.'); };
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const id = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,80}$/.test(v);
  const color = (v: unknown): v is string => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v);
  const kind = (v: unknown): v is Kind => v === 'building' || v === 'ground' || v === 'obstacle';
  const triple = (v: unknown, size = false): v is Triple => Array.isArray(v) && v.length === 3 &&
    v.every(n => typeof n === 'number' && Number.isFinite(n) && (size ? n >= 0.25 && n <= 128 : Math.abs(n) <= WORLD_LIMIT));
  if (!record(input) || (input.version !== 1 && input.version !== 2) || !triple(input.spawn) || input.spawn[1] < 0 ||
    !Array.isArray(input.objects) || input.objects.length > 2000) return fail();
  const sourceTemplates = input.version === 1 ? defaultTemplates() : input.templates;
  if (!Array.isArray(sourceTemplates) || sourceTemplates.length === 0 || sourceTemplates.length > 256) return fail();
  const templateIds = new Set<string>();
  const templates: ObjectTemplate[] = sourceTemplates.map(t => {
    if (!record(t) || !id(t.id) || templateIds.has(t.id) || typeof t.name !== 'string' || !t.name.trim() || t.name.length > 80 ||
      !kind(t.kind) || !triple(t.size, true) || !color(t.color)) return fail();
    templateIds.add(t.id);
    return { id: t.id, name: t.name.trim(), kind: t.kind, size: [...t.size], color: t.color };
  });
  const ids = new Set<string>();
  const objects: WorldObject[] = input.objects.map(o => {
    if (!record(o) || !id(o.id) || ids.has(o.id) || !triple(o.position) || typeof o.yaw !== 'number' || !Number.isFinite(o.yaw) || Math.abs(o.yaw) > Math.PI * 2) return fail();
    const legacy = input.version === 1;
    if (legacy && (!kind(o.kind) || !triple(o.size, true) || !color(o.color))) return fail();
    const templateId = legacy ? o.kind : o.templateId;
    if (!id(templateId) || !templateIds.has(templateId) || (o.size !== undefined && !triple(o.size, true)) || (o.color !== undefined && !color(o.color))) return fail();
    ids.add(o.id);
    const result: WorldObject = { id: o.id, templateId, position: [...o.position], yaw: o.yaw };
    if (triple(o.size, true)) result.size = [...o.size];
    if (color(o.color)) result.color = o.color;
    return result;
  });
  return { version: 2, spawn: [...input.spawn], templates, objects };
}

export function createWorld(): WorldData {
  const objects: WorldObject[] = [];
  const templates = defaultTemplates();
  const colors = ['#9caba9', '#bcc4b8', '#84999b', '#b7ad98', '#74868b'];
  for (let i = 0; i < colors.length; i++) templates.push({ id: `building-${i}`, name: `Здание · вариант ${i + 1}`, kind: 'building', size: [9, 5 + i * 3, 9], color: colors[i]! });
  for (let i = 0; i < 3; i++) templates.push({ id: `step-${i}`, name: `Ступень ${(i + 1) * 60} см`, kind: 'obstacle', size: [3, (i + 1) * 0.6, 3], color: '#d4a663' });
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const x = cx * CELL_SIZE, z = cz * CELL_SIZE;
    objects.push({ id: `ground-${cx}-${cz}`, templateId: 'ground', position: [x + 32, -0.5, z + 32], yaw: 0 });
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      if ((i === 1 || i === 2) && (j === 1 || j === 2)) continue;
      const h = 5 + ((i + j + 3) % colors.length) * 3;
      objects.push({ id: `building-${cx}-${cz}-${i}-${j}`, templateId: `building-${(i + j + 3) % colors.length}`, position: [x + 9 + i * 15, h / 2, z + 9 + j * 15], yaw: 0 });
    }
    for (let i = 0; i < 3; i++) objects.push({ id: `step-${cx}-${cz}-${i}`, templateId: `step-${i}`, position: [x + 24 + i * 4, (i + 1) * 0.3, z + 35], yaw: 0 });
  }
  return { version: 2, spawn: [32, 1, 22], templates, objects };
}
