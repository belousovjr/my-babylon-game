import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { GizmoManager } from '@babylonjs/core/Gizmos/gizmoManager.js';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import '@babylonjs/core/Collisions/collisionCoordinator.js';
import '@babylonjs/core/Culling/ray.js';
import '@babylonjs/loaders/glTF/2.0/glTFLoader.js';
import { CELL_SIZE, cellAt, createWorld, parseWorld, WORLD_LIMIT } from './world';
import type { Kind, Triple, WorldData, WorldObject } from './world';
import { initialPlayerState, stepPlayer } from './player';
import { FollowCamera, MIN_CAMERA_DISTANCE } from './followCamera';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <canvas id="renderCanvas" tabindex="0" aria-label="Игровой мир. WASD — движение, Shift — бег, Space — прыжок, Tab — редактор."></canvas>
  <header><div class="brand"><span class="mark">B/</span><div>BLOCK DISTRICT<small>ЛОКАЛЬНЫЙ ПРОТОТИП · 01</small></div></div><button id="mode">Редактор <kbd>Tab</kbd></button></header>
  <div id="intro"><span class="eyebrow">ПЕСОЧНИЦА / ОФЛАЙН</span><h1>Город начинается<br>с одного квартала.</h1><p>Исследуй пространство. Меняй его под себя.</p></div>
  <aside id="editor" hidden aria-label="Редактор карты">
    <div class="panel-heading"><span class="eyebrow">МАСТЕРСКАЯ</span><h2>Редактор локации</h2></div>
    <p class="muted">Клик по объекту — выбор. ПКМ + WASD — полёт. Q / E — вниз / вверх.</p>
    <div class="tools"><button data-tool="position" class="active">Перенос</button><button data-tool="rotation">Поворот</button><button data-tool="scale">Размер</button></div>
    <label class="check"><input id="snap" type="checkbox" checked> Привязка к сетке · 1 м / 15°</label>
    <label>Новый объект<select id="kind"><option value="building">Здание</option><option value="obstacle">Препятствие</option><option value="ground">Земля</option></select></label>
    <div class="tools"><button id="add">+ Добавить</button><button id="duplicate">Копия</button><button id="delete" class="danger">Удалить</button></div>
    <div id="selection">Выберите объект в сцене</div>
    <div class="tools"><button id="save">Сохранить</button><button id="export">Экспорт JSON</button></div>
    <label class="file-button">Импорт JSON<input id="import" type="file" accept=".json,application/json"></label>
    <button id="spawn">Точка старта ← позиция игрока</button>
    <p class="muted">Сохранение — в этом браузере. Экспортируйте JSON для резервной копии и Git.</p>
    <button id="reset" class="danger quiet">Восстановить исходный квартал</button>
  </aside>
  <div id="notice" role="status" aria-live="polite">Загрузка персонажа…</div>
  <footer><div id="help"><span><kbd>W A S D</kbd> движение</span><span><kbd>Shift</kbd> бег</span><span><kbd>Space</kbd> прыжок</span><span>мышь + ЛКМ · камера</span><span><kbd>R</kbd> на старт</span></div><div id="stats">—</div></footer>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('renderCanvas');
const engine = new Engine(canvas, true, { stencil: true });
engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.5));
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString('#bacbccff');
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogColor = Color3.FromHexString('#bacbcc');
scene.fogStart = 80; scene.fogEnd = 190;
scene.collisionsEnabled = true;
const light = new HemisphericLight('sky', new Vector3(0.4, 1, 0.3), scene);
light.intensity = 1.05;
light.groundColor = Color3.FromHexString('#56616b');
const camera = new ArcRotateCamera('follow', -Math.PI / 2, 1.22, 9, new Vector3(32, 1, 22), scene);
camera.lowerRadiusLimit = MIN_CAMERA_DISTANCE; camera.upperRadiusLimit = 16;
camera.lowerBetaLimit = 0.25; camera.upperBetaLimit = 1.48;
camera.wheelPrecision = 35; camera.panningSensibility = 0;
camera.checkCollisions = false;
camera.minZ = 0.1; camera.maxZ = 240;
camera.attachControl(canvas, true);
camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
const editorCamera = new UniversalCamera('editor', new Vector3(32, 26, -5), scene);
editorCamera.setTarget(new Vector3(32, 0, 30));
editorCamera.minZ = 0.1; editorCamera.maxZ = 500; editorCamera.speed = 0.8;
editorCamera.keysUp = [87]; editorCamera.keysDown = [83];
editorCamera.keysLeft = [65]; editorCamera.keysRight = [68];
editorCamera.keysUpward = [69]; editorCamera.keysDownward = [81];
editorCamera.inputs.removeByType('FreeCameraTouchInput');
const followCamera = new UniversalCamera('follow-view', camera.position.clone(), scene);
followCamera.minZ = 0.05; followCamera.maxZ = camera.maxZ;
const cameraBoom = new FollowCamera();
scene.activeCamera = followCamera;

const materials = new Map<string, StandardMaterial>();
function material(hex: string) {
  let mat = materials.get(hex);
  if (!mat) {
    mat = new StandardMaterial(hex, scene); mat.diffuseColor = Color3.FromHexString(hex);
    mat.specularColor = Color3.Black(); mat.freeze(); materials.set(hex, mat);
  }
  return mat;
}
const meshes = new Map<string, Mesh>();
let activeCell = "";
let world: WorldData = createWorld();
let startupMessage = '';
try {
  const saved = localStorage.getItem('block-district-world-v1');
  if (saved) world = parseWorld(JSON.parse(saved));
} catch { startupMessage = 'Сохранённая карта недоступна. Открыт исходный квартал.'; }
function updateCellCoverage(mesh: Mesh) {
  mesh.computeWorldMatrix(true);
  const bounds = mesh.getBoundingInfo().boundingBox;
  mesh.metadata.minCellX = Math.floor(bounds.minimumWorld.x / CELL_SIZE);
  mesh.metadata.maxCellX = Math.floor(bounds.maximumWorld.x / CELL_SIZE);
  mesh.metadata.minCellZ = Math.floor(bounds.minimumWorld.z / CELL_SIZE);
  mesh.metadata.maxCellZ = Math.floor(bounds.maximumWorld.z / CELL_SIZE);
}
function addMesh(o: WorldObject) {
  const mesh = MeshBuilder.CreateBox(o.id, { size: 1 }, scene);
  mesh.position.copyFromFloats(...o.position); mesh.scaling.copyFromFloats(...o.size);
  mesh.rotation.y = o.yaw; mesh.material = material(o.color);
  mesh.checkCollisions = true; mesh.metadata = { worldId: o.id, kind: o.kind };
  updateCellCoverage(mesh);
  meshes.set(o.id, mesh); return mesh;
}
function rebuild() {
  activeCell = '';
  select(null);
  for (const m of meshes.values()) m.dispose();
  meshes.clear();
  for (const o of world.objects) addMesh(o);
}
const player = MeshBuilder.CreateBox('player-collider', { size: 1 }, scene);
player.isVisible = false; player.isPickable = false;
player.ellipsoid.set(0.35, 0.9, 0.35); player.ellipsoidOffset.set(0, 0.9, 0);
const visual = new TransformNode('player-visual', scene);
visual.parent = player;
const fallback = MeshBuilder.CreateCapsule('loading-avatar', { height: 1.8, radius: 0.3 }, scene);
fallback.position.y = 0.9; fallback.parent = visual; fallback.isPickable = false; fallback.material = material('#d4a663');
let animations: AnimationGroup[] = [];
let activeAnimation: AnimationGroup | undefined;
let animationState = '';
async function loadCharacter() {
  try {
    const result = await ImportMeshAsync(`${import.meta.env.BASE_URL}models/character.glb`, scene);
    const root = result.meshes[0]!;
    for (const a of result.animationGroups) a.stop();
    root.computeWorldMatrix(true);
    const bounds = root.getHierarchyBoundingVectors(true);
    const height = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(height) || height < 0.001) throw new Error('Empty character');
    root.scaling.scaleInPlace(1.8 / height);
    root.position.y = -bounds.min.y * 1.8 / height;
    root.parent = visual;
    for (const mesh of result.meshes) { mesh.isPickable = false; mesh.checkCollisions = false; }
    animations = result.animationGroups;
    for (const a of animations) a.stop();
    fallback.dispose();
    notify(startupMessage || 'Готово. WASD — идти · Tab — редактировать');
  } catch (error) {
    console.error('Character loading failed', error);
    notify('Модель не загрузилась. Управление доступно с временной капсулой.');
  }
}

let editing = false;
let selected: Mesh | null = null;
let dirty = false;
let playerState = initialPlayerState();
let jumpQueued = false;
const keys = new Set<string>();
const gizmos = new GizmoManager(scene);
gizmos.usePointerToAttachGizmos = false;
gizmos.positionGizmoEnabled = true;
gizmos.clearGizmoOnEmptyPointerEvent = false;
let tool: 'position' | 'rotation' | 'scale' = 'position';
function notify(message: string) { $('notice').textContent = message; }
function markDirty() { dirty = true; $('save').textContent = 'Сохранить •'; }
function syncObjects() {
  activeCell = '';
  for (const o of world.objects) {
    const mesh = meshes.get(o.id)!;
    o.position = mesh.position.asArray() as Triple;
    o.size = mesh.scaling.asArray().map(n => Math.max(0.25, Math.min(128, n))) as Triple;
    mesh.scaling.copyFromFloats(...o.size);
    const yaw = mesh.rotationQuaternion ? mesh.rotationQuaternion.toEulerAngles().y : mesh.rotation.y;
    o.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    updateCellCoverage(mesh);
  }
}
function describeSelection() {
  if (!selected) { $('selection').textContent = 'Выберите объект в сцене'; return; }
  const p = selected.position, s = selected.scaling;
  $('selection').textContent = `${selected.name}\nXYZ ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}\nРазмер ${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} м`;
}
function select(mesh: Mesh | null) {
  selected = mesh; gizmos.attachToMesh(editing ? mesh : null);
  $('duplicate').toggleAttribute('disabled', !mesh); $('delete').toggleAttribute('disabled', !mesh);
  describeSelection();
}
function configureGizmos() {
  gizmos.attachToMesh(null);
  gizmos.positionGizmoEnabled = tool === 'position';
  gizmos.rotationGizmoEnabled = tool === 'rotation';
  gizmos.scaleGizmoEnabled = tool === 'scale';
  const snap = $<HTMLInputElement>('snap').checked;
  if (gizmos.gizmos.positionGizmo) gizmos.gizmos.positionGizmo.snapDistance = snap ? 1 : 0;
  if (gizmos.gizmos.rotationGizmo) {
    const g = gizmos.gizmos.rotationGizmo;
    g.snapDistance = snap ? Math.PI / 12 : 0;
    g.xGizmo.isEnabled = false; g.zGizmo.isEnabled = false;
  }
  if (gizmos.gizmos.scaleGizmo) gizmos.gizmos.scaleGizmo.snapDistance = snap ? 1 : 0;
  gizmos.attachToMesh(editing ? selected : null);
}
const hooked = new Set<unknown>();
function watchGizmos() {
  for (const g of [gizmos.gizmos.positionGizmo, gizmos.gizmos.rotationGizmo, gizmos.gizmos.scaleGizmo]) {
    if (g && !hooked.has(g)) {
      g.onDragEndObservable.add(() => { syncObjects(); markDirty(); describeSelection(); });
      hooked.add(g);
    }
  }
}
function respawn() {
  cameraBoom.reset();
  player.position.copyFromFloats(...world.spawn); playerState = initialPlayerState(); jumpQueued = false;
  camera.target.copyFrom(player.position).addInPlaceFromFloats(0, 1.1, 0);
}
function setMode() {
  syncObjects(); editing = !editing; keys.clear(); jumpQueued = false;
  $('editor').hidden = !editing; $('intro').hidden = editing;
  $('mode').innerHTML = editing ? 'Играть <kbd>Tab</kbd>' : 'Редактор <kbd>Tab</kbd>';
  if (editing) {
    cameraBoom.reset();
    camera.detachControl();
    editorCamera.position.copyFrom(player.position).addInPlaceFromFloats(0, 18, -18);
    editorCamera.setTarget(player.position.add(new Vector3(0, 1, 0)));
    scene.activeCamera = editorCamera; editorCamera.attachControl(canvas, true);
    // Keep editor keyboard flight scoped to the canvas, not form controls.
    const mouse = editorCamera.inputs.attached.mouse;
    if (mouse && 'buttons' in mouse) (mouse as { buttons: number[] }).buttons = [2];
    configureGizmos(); watchGizmos();
    for (const m of meshes.values()) m.setEnabled(true);
    notify('Редактор · изменения применяются сразу. Сохраните карту перед выходом.');
  } else {
    editorCamera.detachControl(); scene.activeCamera = followCamera; camera.attachControl(canvas, true);
    select(null); respawn(); notify('Режим игры · карта применена');
  }
  canvas.focus();
}
$('mode').onclick = setMode;
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.onclick = () => {
  tool = button.dataset.tool as typeof tool;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b === button));
  configureGizmos(); watchGizmos();
};
$('snap').onchange = configureGizmos;
scene.onPointerObservable.add(info => {
  if (info.type !== 1 || !editing || (info.event as PointerEvent).button !== 0) return;
  const mesh = info.pickInfo?.pickedMesh;
  if (mesh instanceof Mesh && mesh.metadata?.worldId) select(mesh);
});
$('add').onclick = () => {
  const kind = $<HTMLSelectElement>('kind').value as Kind;
  const center = editorCamera.position.add(editorCamera.getForwardRay().direction.scale(18));
  const size: Triple = kind === 'building' ? [8, 10, 8] : kind === 'ground' ? [16, 1, 16] : [3, 1, 3];
  const o: WorldObject = { id: crypto.randomUUID(), kind, position: [Math.round(center.x), size[1] / 2 - (kind === 'ground' ? 1 : 0), Math.round(center.z)], size, yaw: 0, color: kind === 'obstacle' ? '#d4a663' : kind === 'ground' ? '#39484e' : '#9caba9' };
  if (world.objects.length >= 2000 || Math.abs(o.position[0]) > WORLD_LIMIT || Math.abs(o.position[2]) > WORLD_LIMIT) { notify('Лимит: 2000 объектов, координаты ±2048 м.'); return; }
  world.objects.push(o); select(addMesh(o)); markDirty();
};
$('duplicate').onclick = () => {
  if (!selected || world.objects.length >= 2000) return;
  syncObjects();
  const source = world.objects.find(o => o.id === selected!.name)!;
  const copy = structuredClone(source); copy.id = crypto.randomUUID(); copy.position[0] += copy.size[0] + 1;
  if (Math.abs(copy.position[0]) > WORLD_LIMIT) { notify('Объект выходит за границы карты.'); return; }
  world.objects.push(copy); select(addMesh(copy)); markDirty();
};
$('delete').onclick = () => {
  if (!selected) return;
  const mesh = selected; select(null); meshes.delete(mesh.name);
  world.objects = world.objects.filter(o => o.id !== mesh.name); mesh.dispose(); markDirty();
};
function snapshot() { syncObjects(); return parseWorld(world); }
$('save').onclick = () => {
  try {
    const data = snapshot(); localStorage.setItem('block-district-world-v1', JSON.stringify(data));
    dirty = false; $('save').textContent = 'Сохранить'; notify('Карта сохранена в этом браузере.');
  } catch (e) { notify(`Не удалось сохранить: ${e instanceof Error ? e.message : 'хранилище недоступно'}`); }
};
$('export').onclick = () => {
  try {
    const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'block-district.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('JSON экспортирован.');
  } catch (e) { notify(String(e)); }
};
$<HTMLInputElement>('import').onchange = async event => {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('Файл больше 2 МБ.');
    const next = parseWorld(JSON.parse(await file.text()));
    if (dirty && !confirm('Заменить карту? Несохранённые изменения будут потеряны.')) return;
    world = next; rebuild(); respawn(); markDirty(); notify('Карта импортирована. Нажмите «Сохранить», чтобы оставить её в браузере.');
  } catch (e) { notify(`Импорт отменён: ${e instanceof Error ? e.message : 'ошибка файла'}`); }
  finally { input.value = ''; }
};
$('spawn').onclick = () => { world.spawn = player.position.asArray() as Triple; world.spawn[1] = Math.max(1, world.spawn[1]); markDirty(); notify('Точка старта обновлена по позиции игрока.'); };
$('reset').onclick = () => {
  if (!confirm('Заменить текущую карту исходным кварталом?')) return;
  world = createWorld(); rebuild(); respawn(); markDirty(); notify('Исходная карта восстановлена. Сохранение в браузере пока не изменено.');
};
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
function inForm(target: EventTarget | null) { return target instanceof HTMLElement && !!target.closest('input, select, textarea, button'); }
window.addEventListener('keydown', event => {
  if (inForm(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === 'Tab') { event.preventDefault(); if (!event.repeat) setMode(); return; }
  if (!editing && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (!editing && event.code === 'Space' && !event.repeat) jumpQueued = true;
  if (!editing && event.code === 'KeyR' && !event.repeat) respawn();
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); jumpQueued = false; });
document.addEventListener('visibilitychange', () => { keys.clear(); jumpQueued = false; accumulator = 0; });
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('pointerdown', () => canvas.focus());

function simulate(dt: number) {
  const input = {
    x: Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
    z: Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
    yaw: camera.alpha,
    run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    jump: jumpQueued,
  };
  jumpQueued = false;
  stepPlayer(scene, player, playerState, input, dt);
  if (playerState.moving) {
    $('intro').hidden = true;
    const difference = Math.atan2(Math.sin(playerState.facing - visual.rotation.y), Math.cos(playerState.facing - visual.rotation.y));
    visual.rotation.y += difference * Math.min(1, 14 * dt);
  }
  if (player.position.y < -30) respawn();
}
function animate() {
  const state = !playerState.grounded ? 'Jump_Loop' : playerState.moving ? playerState.running ? 'Sprint_Loop' : 'Walk_Loop' : 'Idle_Loop';
  if (state === animationState || !animations.length) return;
  animationState = state;
  activeAnimation?.stop(); activeAnimation = animations.find(a => a.name === state);
  activeAnimation?.start(true, 1);
}
rebuild(); configureGizmos(); watchGizmos(); respawn();
void loadCharacter();
let accumulator = 0;
let statsTime = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  if (!editing && !document.hidden) {
    accumulator += dt;
    while (accumulator >= 1 / 60) { simulate(1 / 60); accumulator -= 1 / 60; }
    camera.target.copyFrom(player.position).addInPlaceFromFloats(0, 1.15, 0);
    animate();
    const cell = cellAt(player.position.x, player.position.z);
    if (cell !== activeCell) {
      activeCell = cell;
      const [cx, cz] = cell.split(',').map(Number);
      // shortcut: cells only toggle existing meshes; load/unload assets when the map outgrows memory.
      for (const m of meshes.values()) {
        const b = m.metadata;
        m.setEnabled(b.minCellX <= cx! + 1 && b.maxCellX >= cx! - 1 && b.minCellZ <= cz! + 1 && b.maxCellZ >= cz! - 1);
      }
    }
  } else { accumulator = 0; }
  if (!editing) {
    // The orbit camera owns input/desired zoom; the render camera owns the collision-safe pose.
    camera.update();
    cameraBoom.update(camera.target, camera.position, meshes.values(), dt);
    followCamera.position.copyFrom(cameraBoom.position);
    followCamera.setTarget(camera.target);
  }
  scene.render();
  statsTime += dt;
  if (statsTime >= 0.5) {
    statsTime = 0;
    const count = [...meshes.values()].filter(m => m.isEnabled()).length;
    $('stats').textContent = `${Math.round(engine.getFps())} FPS · ${count} объектов · ячейка ${cellAt(player.position.x, player.position.z)}`;
    if (editing) describeSelection();
  }
});
window.addEventListener('resize', () => engine.resize());
