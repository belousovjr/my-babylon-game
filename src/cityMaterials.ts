import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture.js';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { DitheredTileFadeMaterialPlugin } from '@babylonjs/core/Materials/ditheredTileFadeMaterialPlugin.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { ObjectTemplate } from './world';

export type CitySurface = 'plain' | 'light' | 'asphalt' | 'concrete' | 'brick' | 'metal' | 'grass' | 'water' | 'paint' | 'facade-stone' | 'facade-brick' | 'facade-glass' | 'facade-dark' | 'roof' | 'rail-steel';

export function buildingSurface(template: ObjectTemplate, accent = false, luminous = false, role?: 'roof' | 'base'): CitySurface {
  if (role) return role === 'roof' ? 'roof' : 'concrete';
  if (luminous) return 'light';
  if (template.profile === 'tree') return 'plain';
  if (template.profile === 'lamp' || template.profile === 'traffic_signal') return 'metal';
  if (template.profile === 'marina') return accent ? 'concrete' : 'facade-glass';
  if (template.kind !== 'building') return 'concrete';
  if (template.profile === 'bundled') return accent ? 'metal' : 'facade-dark';
  const glass = ['glass', 'rounded'].includes(template.profile ?? '');
  if (accent) return 'concrete';
  return glass ? 'facade-glass' : ['stone', 'deco', 'gothic', 'clock'].includes(template.profile ?? '') ? 'facade-stone' : 'facade-brick';
}

export function streetSurface(color: string): CitySurface {
  if (color === '#454e50') return 'asphalt';
  if (color === '#517d85') return 'water';
  if (color === '#71896a') return 'grass';
  if (color === '#c3baa1') return 'paint';
  if (['#505b55', '#655044'].includes(color)) return 'rail-steel';
  if (color === '#959b92') return 'metal';
  return 'concrete';
}

export function facadeVariant(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (hash >>> 0) % 3;
}

export class CityMaterials {
  private materials = new Map<string, StandardMaterial>();
  private textures = new Map<string, Texture>();
  private environment: CubeTexture | undefined;
  private night = 0;
  private luminous = new Set<StandardMaterial>();
  private scene: Scene;
  private baseUrl: string;

  constructor(scene: Scene, baseUrl: string) { this.scene = scene; this.baseUrl = baseUrl; }

  get(color: string, surface: CitySurface = 'plain', lod = 0, priority = 0, variant = 0, street = false) {
    const level = surface === 'plain' || surface === 'light' ? 0 : Math.min(2, lod);
    variant = surface.startsWith('facade-') ? variant : 0;
    const key = `${color}:${surface}:${level}:${priority}:${variant}:${street}`;
    let material = this.materials.get(key);
    if (material) return material;
    material = new StandardMaterial(key, this.scene);
    material.maxSimultaneousLights = 6;
    material.diffuseColor = Color3.FromHexString(color);
    const glass = surface === 'facade-glass' || surface === 'facade-dark', metal = surface === 'metal', water = surface === 'water';
    material.specularColor = glass ? new Color3(0.12, 0.13, 0.14) : metal ? new Color3(0.12, 0.12, 0.11) : water ? new Color3(0.3, 0.34, 0.35) : new Color3(0.025, 0.025, 0.025);
    if (surface === 'plain' || surface === 'light') material.specularColor = Color3.Black();
    material.specularPower = glass ? 96 : water ? 128 : metal ? 48 : 16;
    material.roughness = glass ? 0.22 : water ? 0.16 : metal ? 0.48 : 0.9;
    if (glass || metal || water) {
      this.environment ??= new CubeTexture(`${this.baseUrl}textures/chicago/environment`, this.scene,
        ['_px.jpg', '_py.jpg', '_pz.jpg', '_nx.jpg', '_ny.jpg', '_nz.jpg']);
      this.environment.level = 1 - this.night * 0.93;
      material.reflectionTexture = this.environment;
      material.reflectionFresnelParameters = new FresnelParameters({
        leftColor: new Color3(glass ? 0.23 : 0.2, glass ? 0.23 : 0.2, glass ? 0.23 : 0.2),
        rightColor: new Color3(metal ? 0.12 : 0.035, metal ? 0.12 : 0.035, metal ? 0.12 : 0.035), power: 3,
      });
    }
    material.zOffset = -priority; material.zOffsetUnits = -priority;
    if (surface !== 'plain' && surface !== 'light') {
      material.diffuseTexture = this.texture(`${surface}-${level}`, true);
      if (level === 0) {
        material.ambientTexture = this.texture(`${surface}-ao`, false);
        material.bumpTexture = this.texture(`${surface}-normal`, false);
        material.bumpTexture.level = water ? 0.12 : 0.22;
        material.specularTexture = this.texture(`${surface}-specular`, false);
        material.useGlossinessFromSpecularMapAlpha = true;
      }
    }
    if (surface.startsWith('facade-')) {
      material.emissiveTexture = this.texture(`${surface}-emission-${variant ? `v${variant}-` : ''}${level}`, true);
      material.emissiveTexture.level = this.night * 0.42;
      material.useEmissiveAsIllumination = true;
    }
    if (street && ['asphalt', 'concrete', 'grass', 'paint'].includes(surface)) {
      material.lightmapTexture = this.texture('street-lightmap', false);
      material.lightmapTexture.coordinatesIndex = 1;
      material.lightmapTexture.level = this.night;
    }
    if (surface === 'light') {
      this.luminous.add(material);
      material.emissiveColor = new Color3(this.night, this.night * 0.84, this.night * 0.6);
    }
    DitheredTileFadeMaterialPlugin.GetOrCreate(material);
    // Dynamic light membership and time uniforms use Babylon's normal material updates.
    this.materials.set(key, material);
    return material;
  }

  setNight(night: number) {
    if (night === this.night) return;
    this.night = night;
    for (const [name, texture] of this.textures) if (name.includes('-emission-')) texture.level = night * 0.42;
    const street = this.textures.get('street-lightmap');
    if (street) street.level = night;
    for (const material of this.luminous) material.emissiveColor.set(night, night * 0.84, night * 0.6);
    if (this.environment) this.environment.level = 1 - night * 0.93;
  }

  private texture(name: string, color: boolean) {
    let texture = this.textures.get(name);
    if (!texture) {
      texture = new Texture(`${this.baseUrl}textures/chicago/${name}.webp`, this.scene, false, name !== 'street-lightmap', Texture.TRILINEAR_SAMPLINGMODE);
      texture.gammaSpace = color;
      texture.anisotropicFilteringLevel = name.startsWith('facade-') ? 8 : 4;
      texture.wrapU = texture.wrapV = name.startsWith('facade-') || name === 'street-lightmap' ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
      this.textures.set(name, texture);
    }
    return texture;
  }
}
