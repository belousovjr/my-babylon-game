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
import '@babylonjs/core/Collisions/collisionCoordinator.js';
import '@babylonjs/core/Culling/ray.js';
import '@babylonjs/loaders/glTF/2.0/glTFLoader.js';
import { CELL_SIZE, cellAt, createWorld, parseWorld, objectProperties, setObjectSize, WORLD_LIMIT, MAX_SIZE } from './world';
import type { Kind, ObjectTemplate, Triple, WorldData, WorldObject } from './world';
import { initialPlayerState, stepPlayer } from './player';
import { NearbyMeshes } from './nearbyMeshes';
import { FollowCamera, MIN_CAMERA_DISTANCE } from './followCamera';
import { attachCollisionGeometry, buildArchitecture, createCollisionPrototype, setArchitectureStatic, PROFILES } from './architecture';
import type { Profile } from './architecture';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { drawChicagoStreets, updateStreetDetailLODs } from './streets';
import { AnimationBlend } from './animationBlend';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <canvas id="renderCanvas" tabindex="0" aria-label="Игровой мир. WASD — движение, Shift — бег, Space — прыжок, Tab — редактор."></canvas>
  <header><div class="brand"><span class="mark">B/</span><div>CHICAGO / LOOP<small>ЛОКАЛЬНАЯ ЛОКАЦИЯ · МАСШТАБ 1:1</small></div></div><button id="mode">Редактор <kbd>Tab</kbd></button></header>
  <div id="intro"><span class="eyebrow">ПЕСОЧНИЦА / ОФЛАЙН</span><h1>Chicago Loop<br>от улицы до силуэта.</h1><p>Река, мосты и архитектура центра Чикаго.</p></div>
  <aside id="editor" hidden aria-label="Редактор карты">
    <div class="panel-heading"><span class="eyebrow">МАСТЕРСКАЯ</span><h2>Редактор локации</h2></div>
    <p id="camera-coordinates" class="muted"></p>
    <p class="muted">Клик по объекту — выбор. ПКМ + WASD — полёт. Q / E — вниз / вверх.</p>
    <div class="tools"><button data-tool="position" class="active">Перенос</button><button data-tool="rotation">Поворот</button><button data-tool="scale">Размер</button></div>
    <label class="check"><input id="snap" type="checkbox" checked> Привязка · перенос 1 м / размер 0,25 м / 15°</label>
    <label>Шаблон<select id="template"></select></label>
    <details><summary>Свойства шаблона</summary>
      <label>Название<input id="template-name" maxlength="80"></label>
      <label>Категория<select id="template-kind"><option value="building">Здание</option><option value="ground">Земля</option><option value="obstacle">Препятствие</option></select></label>
      <label>Размеры X / Y / Z, м</label><div class="tools"><input id="template-x" type="number" min="0.25" max="768" step="0.25" aria-label="Ширина шаблона"><input id="template-y" type="number" min="0.25" max="768" step="0.25" aria-label="Высота шаблона"><input id="template-z" type="number" min="0.25" max="768" step="0.25" aria-label="Глубина шаблона"></div>
      <label>Архитектура<select id="template-profile"></select></label>
      <label>Дистанции LOD, м<input id="template-lod" placeholder="180, 650" aria-label="Дистанции переключения LOD"></label>
      <p class="muted">0–2 расстояния по возрастанию: 1–3 уровня. LOD 0 — самый подробный.</p>
      <label>Цвет<input id="template-color" type="color"></label>
      <button id="save-template">Применить ко всем связанным объектам</button>
      <button id="delete-template" class="danger quiet">Удалить неиспользуемый шаблон</button>
      <p class="muted">Индивидуальные размеры и цвет сохраняются. Позиции объектов не меняются.</p>
    </details>
    <div class="tools"><button id="add">+ Добавить</button><button id="duplicate">Копия</button><button id="delete" class="danger">Удалить</button></div>
    <label>LOD выбранного объекта<select id="lod-preview"><option value="-1">Автоматически</option><option value="0">LOD 0 · ближний</option><option value="1">LOD 1 · средний</option><option value="2">LOD 2 · дальний</option></select></label>
    <div class="tools"><button id="city-overview">Обзор города</button><button id="focus-object">К объекту</button></div>
    <p class="muted"><a href="/maps/chicago.svg" target="_blank">Карта и масштаб ↗</a> · уличный слой генерируется отдельно.</p>
    <div id="selection">Выберите объект в сцене</div>
    <div class="tools"><button id="assign-template">Назначить шаблон</button><button id="reset-overrides">Сбросить изменения</button></div>
    <button id="template-from-object">Новый шаблон из выбранного объекта</button>
    <div class="tools"><button id="save">Сохранить</button><button id="export">Экспорт JSON</button></div>
    <label class="file-button">Импорт JSON<input id="import" type="file" accept=".json,application/json"></label>
    <button id="spawn">Точка старта ← позиция игрока</button>
    <p class="muted">Сохранение — в этом браузере. Экспортируйте JSON для резервной копии и Git.</p>
    <button id="reset" class="danger quiet">Восстановить Chicago Loop</button>
  </aside>
  <div id="notice" role="status" aria-live="polite">Загрузка персонажа…</div>
  <footer><div id="help"><span><kbd>W A S D</kbd> движение</span><span><kbd>Shift</kbd> бег</span><span><kbd>Space</kbd> прыжок</span><span>мышь + ЛКМ · камера</span><span><kbd>R</kbd> на старт</span></div><div id="stats">—</div></footer><a id="attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors · ODbL</a>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('renderCanvas');
const engine = new Engine(canvas, true, { stencil: true });
engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.5));
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString('#bacbccff');
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogColor = Color3.FromHexString('#bacbcc');
scene.fogStart = 1500; scene.fogEnd = 4000;
scene.collisionsEnabled = true;
const light = new HemisphericLight('sky', new Vector3(0.4, 1, 0.3), scene);
light.intensity = 1.05;
light.groundColor = Color3.FromHexString('#56616b');
const camera = new ArcRotateCamera('follow', -Math.PI / 2, 1.22, 9, new Vector3(32, 1, 22), scene);
camera.lowerRadiusLimit = MIN_CAMERA_DISTANCE; camera.upperRadiusLimit = 16;
camera.lowerBetaLimit = 0.25; camera.upperBetaLimit = Math.PI / 2 + Math.PI / 10;
camera.wheelPrecision = 35; camera.panningSensibility = 0;
camera.checkCollisions = false;
camera.minZ = 0.1; camera.maxZ = 3000;
camera.attachControl(canvas, true);
camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
const editorCamera = new UniversalCamera('editor', new Vector3(32, 26, -5), scene);
editorCamera.setTarget(new Vector3(32, 0, 30));
editorCamera.minZ = 1; editorCamera.maxZ = 4000; editorCamera.speed = 3;
editorCamera.keysUp = [87]; editorCamera.keysDown = [83];
editorCamera.keysLeft = [65]; editorCamera.keysRight = [68];
editorCamera.keysUpward = [69]; editorCamera.keysDownward = [81];
editorCamera.inputs.removeByType('FreeCameraTouchInput');
const editorCameraStorageKey = 'block-district-editor-camera-v1';
let hasEditorCameraPose = false;
let savedEditorCameraPose = '';
try {
  const raw = localStorage.getItem(editorCameraStorageKey);
  if (raw) {
    const pose = JSON.parse(raw);
    if ([pose.position, pose.rotation].every(v => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6))) {
      editorCamera.position.copyFromFloats(...pose.position as [number, number, number]);
      editorCamera.rotation.copyFromFloats(...pose.rotation as [number, number, number]);
      hasEditorCameraPose = true;
      savedEditorCameraPose = raw;
    }
  }
} catch { /* Use the initial view if storage is unavailable or invalid. */ }
function saveEditorCamera() {
  if (!hasEditorCameraPose) return;
  const pose = JSON.stringify({ position: editorCamera.position.asArray(), rotation: editorCamera.rotation.asArray() });
  if (pose === savedEditorCameraPose) return;
  try { localStorage.setItem(editorCameraStorageKey, pose); savedEditorCameraPose = pose; }
  catch { /* Camera persistence must not interrupt editing when storage is full or blocked. */ }
}
function describeEditorCamera() {
  const p = editorCamera.position;
  $('camera-coordinates').textContent = `Камера · X ${p.x.toFixed(1)} / Y ${p.y.toFixed(1)} / Z ${p.z.toFixed(1)} м`;
}
window.addEventListener('pagehide', saveEditorCamera);

const followCamera = new UniversalCamera('follow-view', camera.position.clone(), scene);
followCamera.minZ = 0.05; followCamera.maxZ = camera.maxZ;
const cameraBoom = new FollowCamera();
scene.activeCamera = followCamera;

const materials = new Map<string, StandardMaterial>();
function material(hex: string, priority = 0) {
  const key = `${hex}:${priority}`;
  let mat = materials.get(key);
  if (!mat) {
    mat = new StandardMaterial(key, scene); mat.diffuseColor = Color3.FromHexString(hex);
    mat.specularColor = Color3.Black();
    mat.zOffset = -priority; mat.zOffsetUnits = -priority;
    mat.freeze(); materials.set(key, mat);
  }
  return mat;
}
const playerNeighborhood = new NearbyMeshes(), cameraNeighborhood = new NearbyMeshes();
const meshes = new Map<string, Mesh>();
const templateMeshes = new Map<string, Mesh[]>();
const modelLevels = new Map<Mesh, InstancedMesh[]>();
let proceduralMeshes: Mesh[] = [];
const furnitureRoots: Mesh[] = [];
let previewLod = -1;
const colliderSource = createCollisionPrototype(scene);

let activeCell = "";
let world: WorldData = createWorld();
let startupMessage = '';
try {
  const saved = localStorage.getItem('block-district-chicago-v3');
  if (saved) world = parseWorld(JSON.parse(saved));
} catch { startupMessage = 'Сохранённая карта недоступна. Открыт Chicago Loop.'; }
function refreshNearbySources() {
  playerNeighborhood.setSources(scene.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.checkCollisions && (mesh.collisionGroup & player.collisionMask) !== 0 && !!mesh.metadata?.worldId));
  cameraNeighborhood.setSources([...meshes.values(), ...proceduralMeshes].filter(mesh => mesh.checkCollisions));
}
function updateCellCoverage(mesh: Mesh) {
  mesh.computeWorldMatrix(true);
  for (const child of mesh.getChildMeshes()) if (child.metadata?.collisionOnly) child.computeWorldMatrix(true);
  const bounds = mesh.getBoundingInfo().boundingBox;
  mesh.metadata.minCellX = Math.floor(bounds.minimumWorld.x / CELL_SIZE);
  mesh.metadata.maxCellX = Math.floor(bounds.maximumWorld.x / CELL_SIZE);
  mesh.metadata.minCellZ = Math.floor(bounds.minimumWorld.z / CELL_SIZE);
  mesh.metadata.maxCellZ = Math.floor(bounds.maximumWorld.z / CELL_SIZE);
}
function attachModel(root: Mesh, template: ObjectTemplate, color: string, pickable: boolean) {
  const headings = root.metadata.signalHeadings as number[] | undefined;
  const key = `${template.id}:${color}:${headings?.join(',') ?? ''}`;
  let sources = templateMeshes.get(key);
  if (!sources) { sources = buildArchitecture(template, scene, material(color), material(color, 1), headings); templateMeshes.set(key, sources); }
  const levels = sources.map((source, i) => {
    const instance = source.createInstance(`${root.name}-lod${i}`);
    instance.parent = root; instance.isPickable = pickable;
    instance.metadata = { worldId: root.name }; instance.setEnabled(i === sources.length - 1);
    return instance;
  });
  attachCollisionGeometry(root, sources[0]!);
  modelLevels.set(root, levels);
}
function addMesh(o: WorldObject) {
  const properties = objectProperties(world, o);
  const mesh = colliderSource.clone(o.id, null, true)!;
  mesh.setEnabled(true); mesh.isVisible = false; mesh.isPickable = false;
  mesh.position.copyFromFloats(...o.position); mesh.scaling.copyFromFloats(...properties.size);
  mesh.rotation.y = o.yaw;
  mesh.checkCollisions = true; mesh.metadata = { worldId: o.id, kind: properties.kind, templateId: o.templateId };
  attachModel(mesh, world.templates.find(t => t.id === o.templateId)!, properties.color, true);
  updateCellCoverage(mesh);
  setArchitectureStatic(mesh, !editing);
  meshes.set(o.id, mesh); return mesh;
}
function updateLODs() {
  const eye = scene.activeCamera!.position;
  for (const [root, levels] of modelLevels) {
    if (root.isDisposed() || !root.isEnabled()) continue;
    const template = world.templates.find(t => t.id === root.metadata.templateId)!;
    root.computeWorldMatrix(true);
    const bounds = root.getBoundingInfo().boundingBox;
    const distance = Vector3.Distance(eye, Vector3.Clamp(eye, bounds.minimumWorld, bounds.maximumWorld));
    const level = editing && root === selected && previewLod >= 0 ? Math.min(previewLod, levels.length - 1) : (template.lodDistances ?? []).filter(d => distance >= d).length;
    const range = template.profile === 'lamp' ? 120 : template.profile === 'traffic_signal' ? 160 : 240;
    levels.forEach((mesh, i) => { mesh.setEnabled(i === level && (root.metadata.kind === 'building' || distance < range || (editing && root === selected))); mesh.visibility = root.visibility; });
    root.metadata.lod = level;
  }
  updateStreetDetailLODs(proceduralMeshes, eye);
}

function rebuild() {
  activeCell = '';
  select(null);
  for (const levels of modelLevels.values()) for (const mesh of levels) mesh.dispose();
  modelLevels.clear();
  for (const m of [...proceduralMeshes, ...furnitureRoots]) m.dispose();
  proceduralMeshes = []; furnitureRoots.length = 0;
  for (const m of meshes.values()) m.dispose();
  meshes.clear();
  for (const sources of templateMeshes.values()) for (const source of sources) {
    if (source.material?.getClassName() === 'MultiMaterial') source.material.dispose();
    source.dispose();
  }
  templateMeshes.clear();
  refreshTemplates();
  for (const o of world.objects) addMesh(o);
  if (world.environment === 'chicago-loop') {
    const streets = drawChicagoStreets(scene, material); proceduralMeshes = streets.meshes;
    for (const [i, prop] of streets.props.entries()) {
      let template = world.templates.find(t => t.id === prop.templateId);
      if (!template && prop.templateId === 'traffic_signal') {
        template = structuredClone(createWorld().templates.find(t => t.id === 'traffic_signal')!);
        world.templates.push(template);
      }
      if (!template) continue;
      const root = colliderSource.clone(`street-prop-${i}`, null, true)!;
      root.isVisible = false; root.isPickable = false; root.setEnabled(true);
      root.position.copyFromFloats(...prop.position); root.position.y += template.size[1] / 2;
      root.scaling.copyFromFloats(...template.size); root.rotation.y = prop.yaw;
      root.metadata = { templateId: template.id, kind: 'obstacle', signalHeadings: prop.headings };
      attachModel(root, template, template.color, false);
      setArchitectureStatic(root, !editing); furnitureRoots.push(root);
    }
  }
  updateLODs();
  refreshNearbySources();
}
const player = MeshBuilder.CreateBox('player-collider', { size: 1 }, scene);
player.isVisible = false; player.isPickable = false;
player.collisionMask = 1;
player.ellipsoid.set(0.35, 0.9, 0.35); player.ellipsoidOffset.set(0, 0.9, 0);
const visual = new TransformNode('player-visual', scene);
visual.parent = player;
const fallback = MeshBuilder.CreateCapsule('loading-avatar', { height: 1.8, radius: 0.3 }, scene);
fallback.position.y = 0.9; fallback.parent = visual; fallback.isPickable = false; fallback.material = material('#d4a663');
let animationBlend: AnimationBlend | undefined;
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
    animationBlend = new AnimationBlend(result.animationGroups);
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
    const size = mesh.scaling.asArray().map(n => Math.max(0.25, Math.min(MAX_SIZE, n))) as Triple;
    setObjectSize(world, o, size);
    mesh.scaling.copyFromFloats(...size);
    const yaw = mesh.rotationQuaternion ? mesh.rotationQuaternion.toEulerAngles().y : mesh.rotation.y;
    o.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    updateCellCoverage(mesh);
  }
  refreshNearbySources();
}
function describeSelection() {
  if (!selected) { $('selection').textContent = 'Выберите объект в сцене'; return; }
  const p = selected.position, s = selected.scaling;
  const object = world.objects.find(o => o.id === selected!.name)!;
  const template = world.templates.find(t => t.id === object.templateId)!;
  $('selection').textContent = `${object.name ?? template.name} · ${template.kind}\nLOD ${selected.metadata.lod ?? 0} / ${(template.lodDistances?.length ?? 0)} · △ ${(modelLevels.get(selected) ?? []).map(m => m.getTotalIndices() / 3).join(' / ')}\n${object.size || object.color ? 'Есть индивидуальные изменения' : 'Наследует шаблон'}\n${selected.name}\nXYZ ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}\nРазмер ${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} м`;
}
function select(mesh: Mesh | null) {
  selected = mesh; gizmos.attachToMesh(editing ? mesh : null);
  for (const id of ['assign-template', 'reset-overrides', 'template-from-object']) $(id).toggleAttribute('disabled', !mesh);
  const lodSelect = $<HTMLSelectElement>('lod-preview');
  lodSelect.disabled = !mesh; $('focus-object').toggleAttribute('disabled', !mesh);
  const maxLod = mesh ? modelLevels.get(mesh)!.length - 1 : 0;
  for (const option of lodSelect.options) option.disabled = Number(option.value) > maxLod;
  if (previewLod > maxLod) { previewLod = -1; lodSelect.value = '-1'; }
  if (mesh) {
    $<HTMLSelectElement>('template').value = world.objects.find(o => o.id === mesh.name)!.templateId;
    showTemplate();
  }
  $('duplicate').toggleAttribute('disabled', !mesh); $('delete').toggleAttribute('disabled', !mesh);
  describeSelection();
}
function configureGizmos() {
  scene.skipPointerMovePicking = !editing;
  scene.skipPointerDownPicking = !editing;
  scene.skipPointerUpPicking = !editing;
  for (const layer of [gizmos.utilityLayer, gizmos.keepDepthUtilityLayer]) {
    layer.pickingEnabled = editing; layer.shouldRender = editing;
  }
  gizmos.attachToMesh(null);
  gizmos.positionGizmoEnabled = tool === 'position';
  gizmos.rotationGizmoEnabled = tool === 'rotation';
  gizmos.scaleGizmoEnabled = tool === 'scale';
  const snap = $<HTMLInputElement>('snap').checked;
  if (gizmos.gizmos.positionGizmo) gizmos.gizmos.positionGizmo.snapDistance = snap ? 1 : 0;
  if (gizmos.gizmos.rotationGizmo) {
    const g = gizmos.gizmos.rotationGizmo;
    // World Y rotation supports the nonuniform dimensions of our box objects.
    g.updateGizmoRotationToMatchAttachedMesh = false;
    g.snapDistance = snap ? Math.PI / 12 : 0;
    g.xGizmo.isEnabled = false; g.zGizmo.isEnabled = false;
  }
  if (gizmos.gizmos.scaleGizmo) {
    gizmos.gizmos.scaleGizmo.incrementalSnap = true;
    gizmos.gizmos.scaleGizmo.snapDistance = snap ? 0.25 : 0;
  }
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
function updateActiveCell() {
  if (editing) return;
  const cell = cellAt(player.position.x, player.position.z);
  if (cell !== activeCell) {
    activeCell = cell;
    const [cx, cz] = cell.split(',').map(Number);
    // shortcut: cells only toggle existing meshes; load/unload assets when the map outgrows memory.
    for (const m of meshes.values()) {
      const b = m.metadata;
      m.setEnabled((b.minCellX <= cx! + 2 && b.maxCellX >= cx! - 2 && b.minCellZ <= cz! + 2 && b.maxCellZ >= cz! - 2) || m.scaling.y > 120);
    }
    playerNeighborhood.invalidate(); cameraNeighborhood.invalidate();
  }
}
function respawn() {
  playerNeighborhood.invalidate(); cameraNeighborhood.invalidate();
  player.surroundingMeshes = null;
  cameraBoom.reset();
  player.position.copyFromFloats(...world.spawn); playerState = initialPlayerState(); jumpQueued = false;
  updateActiveCell();
  camera.target.copyFrom(player.position).addInPlaceFromFloats(0, 1.1, 0);
}
function setMode() {
  syncObjects(); editing = !editing; keys.clear(); jumpQueued = false;
  for (const root of [...meshes.values(), ...furnitureRoots]) setArchitectureStatic(root, !editing);
  $('editor').hidden = !editing; $('intro').hidden = editing;
  $('mode').innerHTML = editing ? 'Играть <kbd>Tab</kbd>' : 'Редактор <kbd>Tab</kbd>';
  if (editing) {
    cameraBoom.reset();
    camera.detachControl();
    if (!hasEditorCameraPose) {
      editorCamera.position.copyFrom(player.position).addInPlaceFromFloats(0, 18, -18);
      editorCamera.setTarget(player.position.add(new Vector3(0, 1, 0)));
      hasEditorCameraPose = true;
    }
    describeEditorCamera();
    scene.activeCamera = editorCamera; editorCamera.attachControl(canvas, true);
    // Keep editor keyboard flight scoped to the canvas, not form controls.
    const mouse = editorCamera.inputs.attached.mouse;
    if (mouse && 'buttons' in mouse) (mouse as { buttons: number[] }).buttons = [2];
    for (const m of meshes.values()) m.setEnabled(true);
    notify('Редактор · изменения применяются сразу. Сохраните карту перед выходом.');
  } else {
    saveEditorCamera();
    editorCamera.detachControl(); scene.activeCamera = followCamera; camera.attachControl(canvas, true);
    select(null); respawn(); notify('Режим игры · карта применена');
  }
  configureGizmos(); watchGizmos();
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
  if (mesh?.metadata?.worldId && meshes.has(mesh.metadata.worldId)) select(meshes.get(mesh.metadata.worldId)!);
});
function chosenTemplate() { return world.templates.find(t => t.id === $<HTMLSelectElement>('template').value)!; }
function showTemplate() {
  const t = chosenTemplate();
  if (!t) return;
  $<HTMLInputElement>('template-name').value = t.name;
  $<HTMLSelectElement>('template-kind').value = t.kind;
  ['x', 'y', 'z'].forEach((axis, i) => { $<HTMLInputElement>(`template-${axis}`).value = String(t.size[i]); });
  $<HTMLInputElement>('template-color').value = t.color;
  $<HTMLSelectElement>('template-profile').value = t.profile ?? 'box';
  $<HTMLInputElement>('template-lod').value = (t.lodDistances ?? []).join(', ');
}
function refreshTemplates() {
  const select = $<HTMLSelectElement>('template'), previous = select.value;
  select.replaceChildren(...world.templates.map(t => new Option(t.name, t.id)));
  if (world.templates.some(t => t.id === previous)) select.value = previous;
  showTemplate();
}
function rebuildKeepingSelection(id = selected?.name) {
  cameraBoom.reset(); rebuild();
  if (id) select(meshes.get(id) ?? null);
}
$<HTMLSelectElement>('template-profile').replaceChildren(...PROFILES.map(p => new Option(p, p)));
$('template').onchange = showTemplate;
$('lod-preview').onchange = () => { previewLod = Number($<HTMLSelectElement>('lod-preview').value); updateLODs(); describeSelection(); };
$('city-overview').onclick = () => { editorCamera.position.set(900, 850, 1100); editorCamera.setTarget(new Vector3(0, 70, 0)); canvas.focus(); };
$('focus-object').onclick = () => { if (!selected) return; editorCamera.position.copyFrom(selected.position).addInPlaceFromFloats(40, 25, -65); editorCamera.setTarget(selected.position); canvas.focus(); };

$('save-template').onclick = () => {
  try {
    syncObjects();
    const t = chosenTemplate();
    const candidate = structuredClone(world);
    const updated: ObjectTemplate = {
      id: t.id, name: $<HTMLInputElement>('template-name').value,
      kind: $<HTMLSelectElement>('template-kind').value as Kind,
      size: ['x', 'y', 'z'].map(axis => Number($<HTMLInputElement>(`template-${axis}`).value)) as Triple,
      color: $<HTMLInputElement>('template-color').value,
      profile: $<HTMLSelectElement>('template-profile').value as Profile,
      lodDistances: $<HTMLInputElement>('template-lod').value.trim() ? $<HTMLInputElement>('template-lod').value.split(',').map(Number) : [],
    };
    candidate.templates[candidate.templates.findIndex(item => item.id === t.id)] = updated;
    world = parseWorld(candidate); rebuildKeepingSelection(); markDirty();
    notify('Шаблон обновлён. Индивидуальные изменения экземпляров сохранены.');
  } catch (error) { notify(String(error)); }
};
$('delete-template').onclick = () => {
  const t = chosenTemplate();
  if (world.objects.some(o => o.templateId === t.id)) { notify('Шаблон используется. Сначала назначьте его экземплярам другой шаблон или удалите их.'); return; }
  if (world.templates.length === 1) { notify('В каталоге должен остаться хотя бы один шаблон.'); return; }
  world.templates = world.templates.filter(item => item.id !== t.id);
  refreshTemplates(); markDirty();
};
$('assign-template').onclick = () => {
  if (!selected) return;
  syncObjects();
  const o = world.objects.find(o => o.id === selected!.name)!;
  o.templateId = chosenTemplate().id; delete o.size; delete o.color;
  rebuildKeepingSelection(); markDirty();
};
$('reset-overrides').onclick = () => {
  if (!selected) return;
  syncObjects(); const o = world.objects.find(o => o.id === selected!.name)!;
  delete o.size; delete o.color; rebuildKeepingSelection(); markDirty();
};
$('template-from-object').onclick = () => {
  if (!selected) return;
  if (world.templates.length >= 256) { notify('Лимит: 256 шаблонов.'); return; }
  syncObjects(); const o = world.objects.find(o => o.id === selected!.name)!;
  const name = prompt('Название нового шаблона:', `${chosenTemplate().name} — копия`);
  if (name === null) return;
  if (!name.trim() || name.length > 80) { notify('Название: от 1 до 80 символов.'); return; }
  const p = objectProperties(world, o);
  const source = world.templates.find(t => t.id === o.templateId)!;
  const t: ObjectTemplate = { ...structuredClone(source), id: crypto.randomUUID(), name: name.trim(), kind: p.kind, size: [...p.size], color: p.color };
  world.templates.push(t); o.templateId = t.id; delete o.size; delete o.color;
  rebuildKeepingSelection(); markDirty(); notify('Шаблон создан из выбранного объекта.');
};
$('add').onclick = () => {
  const t = chosenTemplate();
  const center = editorCamera.position.add(editorCamera.getForwardRay().direction.scale(18));
  const o: WorldObject = { id: crypto.randomUUID(), templateId: t.id, position: [Math.round(center.x), t.kind === 'ground' ? -t.size[1] / 2 : t.size[1] / 2, Math.round(center.z)], yaw: 0 };
  if (world.objects.length >= 2000 || Math.abs(o.position[0]) > WORLD_LIMIT || Math.abs(o.position[2]) > WORLD_LIMIT) { notify('Лимит: 2000 объектов, координаты ±4096 м.'); return; }
  world.objects.push(o); select(addMesh(o)); markDirty();
};
$('duplicate').onclick = () => {
  if (!selected || world.objects.length >= 2000) return;
  syncObjects();
  const source = world.objects.find(o => o.id === selected!.name)!;
  const copy = structuredClone(source); copy.id = crypto.randomUUID(); copy.position[0] += objectProperties(world, copy).size[0] + 1;
  if (Math.abs(copy.position[0]) > WORLD_LIMIT) { notify('Объект выходит за границы карты.'); return; }
  world.objects.push(copy); select(addMesh(copy)); markDirty();
};
$('delete').onclick = () => {
  if (!selected) return;
  const mesh = selected; select(null); meshes.delete(mesh.name);
  world.objects = world.objects.filter(o => o.id !== mesh.name);
  for (const level of modelLevels.get(mesh) ?? []) level.dispose(); modelLevels.delete(mesh);
  mesh.dispose(); markDirty();
};
function snapshot() { syncObjects(); return parseWorld(world); }
$('save').onclick = () => {
  try {
    const data = snapshot(); localStorage.setItem('block-district-chicago-v3', JSON.stringify(data));
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
    if (file.size > 4_000_000) throw new Error('Файл больше 4 МБ.');
    const next = parseWorld(JSON.parse(await file.text()));
    if (dirty && !confirm('Заменить карту? Несохранённые изменения будут потеряны.')) return;
    world = next; rebuild(); respawn(); markDirty(); notify('Карта импортирована. Нажмите «Сохранить», чтобы оставить её в браузере.');
  } catch (e) { notify(`Импорт отменён: ${e instanceof Error ? e.message : 'ошибка файла'}`); }
  finally { input.value = ''; }
};
$('spawn').onclick = () => { world.spawn = player.position.asArray() as Triple; world.spawn[1] = Math.max(1, world.spawn[1]); markDirty(); notify('Точка старта обновлена по позиции игрока.'); };
$('reset').onclick = () => {
  if (!confirm('Заменить текущую карту исходным Chicago Loop?')) return;
  world = createWorld(); rebuild(); respawn(); markDirty(); notify('Chicago Loop восстановлен. Сохранение в браузере пока не изменено.');
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
  updateActiveCell();
  const input = {
    x: Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
    z: Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
    yaw: camera.alpha,
    run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    jump: jumpQueued,
  };
  jumpQueued = false;
  player.surroundingMeshes = playerNeighborhood.get(player.position, 12);
  stepPlayer(scene, player, playerState, input, dt);
  if (playerState.moving) {
    $('intro').hidden = true;
    const difference = Math.atan2(Math.sin(playerState.facing - visual.rotation.y), Math.cos(playerState.facing - visual.rotation.y));
    visual.rotation.y += difference * Math.min(1, 14 * dt);
  }
  if (player.position.y < -30) respawn();
}
function animate(dt: number) {
  const state = !playerState.grounded ? 'Jump_Loop' : playerState.moving ? playerState.running ? 'Sprint_Loop' : 'Walk_Loop' : 'Idle_Loop';
  animationBlend?.update(state, dt);
}
rebuild(); configureGizmos(); watchGizmos(); respawn();
void loadCharacter();
let accumulator = 0;
let statsTime = 0;
let lodTime = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  if (!editing && !document.hidden) {
    accumulator += dt;
    while (accumulator >= 1 / 60) { simulate(1 / 60); accumulator -= 1 / 60; }
    camera.target.copyFrom(player.position).addInPlaceFromFloats(0, 1.15, 0);
    animate(dt);
  } else { accumulator = 0; }
  if (!editing) {
    // The orbit camera owns input/desired zoom; the render camera owns the collision-safe pose.
    camera.update();
    cameraBoom.update(camera.target, camera.position, cameraNeighborhood.get(camera.target, Vector3.Distance(camera.target, camera.position) + 3), dt);
    followCamera.position.copyFrom(cameraBoom.position);
    followCamera.setTarget(camera.target);
  }
  lodTime += dt;
  if (lodTime >= 0.15) { updateLODs(); lodTime = 0; }
  // Visibility is per instance, so one occluder can fade without affecting its template siblings.
  for (const [root, levels] of modelLevels) {
    if (levels[0]?.visibility === root.visibility) continue;
    for (const mesh of levels) mesh.visibility = root.visibility;
  }
  scene.render();
  statsTime += dt;
  if (statsTime >= 0.5) {
    statsTime = 0;
    const count = [...meshes.values()].filter(m => m.isEnabled()).length;
    $('stats').textContent = `${Math.round(engine.getFps())} FPS · ${count} зданий · ${scene.getActiveMeshes().length} мешей · ячейка ${cellAt(player.position.x, player.position.z)}`;
    if (editing) { describeSelection(); describeEditorCamera(); saveEditorCamera(); }
  }
});
window.addEventListener('resize', () => engine.resize());
