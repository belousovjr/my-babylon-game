import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';

export interface PlayerInput { x: number; z: number; yaw: number; run: boolean; jump: boolean }
export interface PlayerState { verticalSpeed: number; grounded: boolean; moving: boolean; running: boolean; facing: number }
export function initialPlayerState(): PlayerState {
  return { verticalSpeed: 0, grounded: false, moving: false, running: false, facing: 0 };
}

// Input and simulation stay separate from the camera, keyboard and character animations.
export function stepPlayer(scene: Scene, body: Mesh, state: PlayerState, input: PlayerInput, dt: number) {
  const forward = new Vector3(-Math.cos(input.yaw), 0, -Math.sin(input.yaw));
  const right = new Vector3(forward.z, 0, -forward.x);
  const direction = forward.scale(input.z).addInPlace(right.scale(input.x));
  state.moving = direction.lengthSquared() > 0;
  state.running = state.moving && input.run;
  if (state.moving) direction.normalize();
  const hit = scene.pickWithRay(new Ray(body.position.add(new Vector3(0, 0.12, 0)), Vector3.Down(), 0.22), m => m.checkCollisions && (m.collisionGroup & body.collisionMask) !== 0 && !!m.metadata?.worldId && m.isEnabled());
  state.grounded = !!hit?.hit && state.verticalSpeed <= 0;
  if (state.grounded) state.verticalSpeed = -0.5;
  if (input.jump && state.grounded) { state.verticalSpeed = 7; state.grounded = false; }
  state.verticalSpeed = Math.max(-30, state.verticalSpeed - 20 * dt);
  const displacement = direction.scale((state.running ? 7 : 3.2) * dt);
  displacement.y = state.verticalSpeed * dt;
  const previousY = body.position.y;
  // Multiple fixed steps can run before rendering refreshes the cached world position.
  body.computeWorldMatrix(true);
  body.moveWithCollisions(displacement);
  if (state.verticalSpeed > 0 && body.position.y - previousY < displacement.y * 0.5) state.verticalSpeed = 0;
  if (state.moving) state.facing = Math.atan2(direction.x, direction.z);
}
