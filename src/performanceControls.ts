export const PERFORMANCE_OPTIONS = [
  ['shadows', 'Динамические тени'],
  ['materials', 'Детали материалов · normal / AO / блеск'],
  ['city', 'Город · здания и уличная геометрия'],
  ['trees', 'Деревья'],
  ['physics', 'Физика героя · движение'],
  ['film', 'Сепия и зерно'],
  ['animation', 'Анимация героя'],
  ['reflections', 'Отражения'],
  ['water', 'Вода и дно'],
  ['atmosphere', 'Небо и дымка'],
  ['localLights', 'Ночные локальные огни'],
  ['camera', 'Коллизии камеры'],
  ['lod', 'Обновления и переходы LOD'],
  ['beacons', 'Маяки на шпилях'],
] as const;
export type PerformanceFlags = Record<typeof PERFORMANCE_OPTIONS[number][0], boolean>;
export function createPerformanceFlags(): PerformanceFlags {
  return Object.fromEntries(PERFORMANCE_OPTIONS.map(([key]) => [key, true])) as PerformanceFlags;
}
export function bindPerformanceControls(flags: PerformanceFlags, apply: () => void) {
  for (const [key] of PERFORMANCE_OPTIONS) {
    const input = document.getElementById(`perf-${key}`) as HTMLInputElement;
    input.onchange = () => { flags[key] = input.checked; apply(); };
  }
  document.getElementById('perf-reset')!.onclick = () => {
    for (const [key] of PERFORMANCE_OPTIONS) {
      flags[key] = true;
      (document.getElementById(`perf-${key}`) as HTMLInputElement).checked = true;
    }
    apply();
  };
}
