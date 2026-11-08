import chicago from './generated/chicago.json' with { type: 'json' };

export const WATER_LEVEL = -5.5;

// Stylized concave channel: shallow banks, deeper centre, with small sediment ripples.
export function riverbedElevation(x: number, z: number) {
  let distanceSquared = Infinity;
  for (const ring of chicago.environment.shorelines) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!, b = ring[i]!;
    const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((x - a[0]!) * dx + (z - a[1]!) * dz) / lengthSquared)) : 0;
    distanceSquared = Math.min(distanceSquared, (x - a[0]! - dx * t) ** 2 + (z - a[1]! - dz * t) ** 2);
  }
  const depth = 1 - Math.exp(-distanceSquared / (30 * 30));
  const relief = (.15 * Math.sin(x / 42) + .1 * Math.cos(z / 37)) * depth;
  return WATER_LEVEL - 1.5 - 6 * depth + relief;
}

