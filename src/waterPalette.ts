import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import { WATER_LEVEL } from './water.ts';

export class WaterPalette extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, 'WaterPalette', 210, {}, true, true);
    this.doNotSerialize = true;
  }

  getClassName() { return 'WaterPalette'; }

  getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null;
    const color = this._material.getClassName().startsWith('PBR') ? 'finalColor' : 'color';
    return {
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
        float waterPaletteMask = 1. - smoothstep(${WATER_LEVEL - .06}, ${WATER_LEVEL}, vPositionW.y);
        ${color}.rgb *= mix(vec3(1.), vec3(.9, 1., 1.03), waterPaletteMask);
      `,
    };
  }
}
