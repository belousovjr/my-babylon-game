import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';

// Fade repeating microdetail into its measured average without additional texture samples.
export class SurfaceDetail extends MaterialPluginBase {
  private mean: number[];

  constructor(material: Material, mean: number[]) {
    super(material, 'SurfaceDetail', 190, {}, true, true);
    this.mean = mean;
    this.doNotSerialize = true;
  }

  getClassName() { return 'SurfaceDetail'; }
  getUniforms() { return { ubo: [{ name: 'surfaceMean', size: 4, type: 'vec4' }] }; }
  bindForSubMesh(buffer: UniformBuffer) {
    buffer.updateFloat4('surfaceMean', this.mean[0]!, this.mean[1]!, this.mean[2]!, this.mean[3]!);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: `
        float surfaceDetailFade = smoothstep(16., 96., length(vPositionW - vEyePosition.xyz));
        vec3 surfaceAverage = surfaceMean.rgb;
        #if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
          surfaceAverage *= vColor.rgb;
        #endif
        baseColor.rgb = mix(baseColor.rgb, surfaceAverage, surfaceDetailFade);
        #ifdef AMBIENT
          baseAmbientColor = mix(baseAmbientColor, vec3(surfaceMean.a), surfaceDetailFade);
        #endif
        #ifdef NORMAL
          normalW = normalize(mix(normalW, normalize(vNormalW), surfaceDetailFade));
        #endif
      `,
    };
  }
}
