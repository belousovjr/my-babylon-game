import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture.js';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { DitheredTileFadeMaterialPlugin } from '@babylonjs/core/Materials/ditheredTileFadeMaterialPlugin.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { ObjectTemplate } from './world';

export type CitySurface = 'plain' | 'asphalt' | 'concrete' | 'brick' | 'metal' | 'grass' | 'water' | 'paint' | 'facade-stone' | 'facade-brick' | 'facade-glass';

export function buildingSurface(template: ObjectTemplate, accent = false, luminous = false): CitySurface {
  if (template.profile === 'tree' || luminous) return 'plain';
  if (template.profile === 'lamp' || template.profile === 'traffic_signal') return 'metal';
  if (template.kind !== 'building' || template.profile === 'marina') return 'concrete';
  const glass = ['glass', 'rounded', 'bundled'].includes(template.profile ?? '');
  if (accent) return glass ? 'metal' : 'concrete';
  return glass ? 'facade-glass' : ['stone', 'deco', 'gothic', 'clock'].includes(template.profile ?? '') ? 'facade-stone' : 'facade-brick';
}

export function streetSurface(color: string): CitySurface {
  if (color === '#454e50') return 'asphalt';
  if (color === '#517d85') return 'water';
  if (color === '#71896a') return 'grass';
  if (color === '#c3baa1') return 'paint';
  if (['#505b55', '#959b92', '#655044'].includes(color)) return 'metal';
  return 'concrete';
}

export class CityMaterials {
  private materials = new Map<string, StandardMaterial>();
  private textures = new Map<string, Texture>();
  private environment: CubeTexture | undefined;
  private scene: Scene;
  private baseUrl: string;

  constructor(scene: Scene, baseUrl: string) { this.scene = scene; this.baseUrl = baseUrl; }

  get(color: string, surface: CitySurface = 'plain', lod = 0, priority = 0) {
    const level = surface === 'plain' ? 0 : Math.min(2, lod);
    const key = `${color}:${surface}:${level}:${priority}`;
    let material = this.materials.get(key);
    if (material) return material;
    material = new StandardMaterial(key, this.scene);
    material.diffuseColor = Color3.FromHexString(color);
    const glass = surface === 'facade-glass', metal = surface === 'metal', water = surface === 'water';
    material.specularColor = glass ? new Color3(0.24, 0.27, 0.3) : metal ? new Color3(0.18, 0.18, 0.17) : water ? new Color3(0.3, 0.34, 0.35) : new Color3(0.025, 0.025, 0.025);
    if (surface === 'plain') material.specularColor = Color3.Black();
    material.specularPower = glass ? 96 : water ? 128 : metal ? 48 : 16;
    material.roughness = glass ? 0.22 : water ? 0.16 : metal ? 0.48 : 0.9;
    if (glass || metal || water) {
      this.environment ??= new CubeTexture(`${this.baseUrl}textures/chicago/environment`, this.scene,
        ['_px.jpg', '_py.jpg', '_pz.jpg', '_nx.jpg', '_ny.jpg', '_nz.jpg']);
      material.reflectionTexture = this.environment;
      material.reflectionFresnelParameters = new FresnelParameters({
        leftColor: new Color3(glass ? 0.4 : 0.28, glass ? 0.4 : 0.28, glass ? 0.4 : 0.28),
        rightColor: new Color3(metal ? 0.12 : 0.035, metal ? 0.12 : 0.035, metal ? 0.12 : 0.035), power: 3,
      });
    }
    material.zOffset = -priority; material.zOffsetUnits = -priority;
    if (surface !== 'plain') {
      material.diffuseTexture = this.texture(`${surface}-${level}`, true);
      if (level === 0) {
        material.ambientTexture = this.texture(`${surface}-ao`, false);
        material.bumpTexture = this.texture(`${surface}-normal`, false);
        material.bumpTexture.level = water ? 0.12 : 0.22;
        material.specularTexture = this.texture(`${surface}-specular`, false);
        material.useGlossinessFromSpecularMapAlpha = true;
      }
    }
    DitheredTileFadeMaterialPlugin.GetOrCreate(material);
    material.freeze();
    this.materials.set(key, material);
    return material;
  }

  private texture(name: string, color: boolean) {
    let texture = this.textures.get(name);
    if (!texture) {
      texture = new Texture(`${this.baseUrl}textures/chicago/${name}.webp`, this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
      texture.gammaSpace = color;
      texture.anisotropicFilteringLevel = 4;
      texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
      this.textures.set(name, texture);
    }
    return texture;
  }
}
