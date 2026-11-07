import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  MeshBuilder,
  Vector3,
} from "@babylonjs/core";

import "./style.css";

const canvas = document.createElement("canvas");
canvas.id = "renderCanvas";
document.body.appendChild(canvas);

// Движок
const engine = new Engine(canvas, true);

// Сцена
const scene = new Scene(engine);

// Камера
const camera = new ArcRotateCamera(
  "camera",
  Math.PI / 2,
  Math.PI / 3,
  10,
  Vector3.Zero(),
  scene
);

camera.attachControl(canvas, true);

// Освещение
new HemisphericLight(
  "light",
  new Vector3(0, 1, 0),
  scene
);

// Куб
const box = MeshBuilder.CreateBox(
  "box",
  { size: 2 },
  scene
);

// Земля
MeshBuilder.CreateGround(
  "ground",
  { width: 10, height: 10 },
  scene
);

box.position.y = 1;

// Игровой цикл
engine.runRenderLoop(() => {
  box.rotation.y += 0.01;
  scene.render();
});

// Адаптация под размер окна
window.addEventListener("resize", () => {
  engine.resize();
});