import * as THREE from 'three/webgpu';
import { clamp, convertToTexture, dot, float, length, max, min, mix, renderOutput, uniform, uv, vec3, vec4 } from 'three/tsl';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';

export const AA_MODES = ['TAA', 'FXAA', 'Ninguno'];

/**
 * Posprocesado global (Fase 7.3), encadenado tras la composición bajo el agua (Fase 6):
 *   escena (color + profundidad + velocidad) → bajo el agua → TAA → profundidad de campo →
 *   motion blur → bloom → exposición / tone mapping → corrección de color → FXAA → grano.
 * El grafo se rehace al activar o desactivar efectos (lo apagado no cuesta nada). Si todo está
 * apagado y la cámara lejos del agua, se dibuja directamente (sin la pasada extra).
 */
export function createPost({ renderer, scene, camera, under, getFocusTarget, consumeCut = null }) {
  const state = {
    enabled: true,
    aa: 'TAA',
    bloom: true,
    bloomStrength: 0.12,
    bloomRadius: 0.25,
    bloomThreshold: 1.4,
    dof: true, // por defecto (perfil Alto) desde el 29/09/2026
    autoFocus: true,
    focusDistance: 30, // m (si no es automático)
    focalRange: 25, // m hasta desenfoque total
    bokeh: 1.5,
    motionBlur: true,
    motionBlurAmount: 0.35, // fracción del fotograma (0,5 = obturador de 180°)
    exposure: 0, // EV
    contrast: 1.05,
    saturation: 1.05,
    temperature: 0, // −1 frío … +1 cálido
    vignette: 0.15,
    grain: 0.04,
  };

  const u = {
    bloomStrength: uniform(state.bloomStrength),
    bloomRadius: uniform(state.bloomRadius),
    bloomThreshold: uniform(state.bloomThreshold),
    focus: uniform(state.focusDistance),
    focalRange: uniform(state.focalRange),
    bokeh: uniform(state.bokeh),
    mb: uniform(state.motionBlurAmount),
    exposure: uniform(1),
    contrast: uniform(state.contrast),
    saturation: uniform(state.saturation),
    temperature: uniform(0),
    vignette: uniform(state.vignette),
    grain: uniform(state.grain),
  };

  const scenePass = under.scenePass;
  const depth = scenePass.getTextureNode('depth');
  const velocity = scenePass.getTextureNode('velocity');
  const viewZ = scenePass.getViewZNode();

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false; // el tone mapping se hace dentro, antes de la corrección de color
  let key = '';

  function build() {
    let n = under.out; // color lineal HDR (con los efectos bajo el agua)
    if (state.enabled && state.aa === 'TAA') n = traa(n, depth, velocity, camera);
    if (state.enabled && state.dof) n = dof(n, viewZ, u.focus, u.focalRange, u.bokeh);
    if (state.enabled && state.motionBlur) {
      // la estela se limita al 3 % de la pantalla (giros rápidos y transiciones largas)
      const vel = velocity.xy.mul(u.mb);
      const len = length(vel);
      n = motionBlur(convertToTexture(n), vel.mul(min(float(1), float(0.03).div(max(len, 1e-5)))));
    }
    if (state.enabled && state.bloom) n = n.add(bloom(n, u.bloomStrength, u.bloomRadius, u.bloomThreshold));
    // exposición en lineal y tone mapping + espacio de color del renderer
    n = renderOutput(vec4(n.rgb.mul(u.exposure), 1));
    if (state.enabled) {
      // corrección de color en el espacio de la pantalla
      let c = n.rgb;
      c = c.mul(vec3(float(1).add(u.temperature.mul(0.08)), 1, float(1).sub(u.temperature.mul(0.08))));
      c = c.sub(0.5).mul(u.contrast).add(0.5);
      const luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, u.saturation);
      const r = length(uv().sub(0.5)).mul(1.4142);
      c = clamp(c.mul(float(1).sub(r.mul(r).mul(u.vignette))), 0, 1);
      n = vec4(c, 1);
      if (state.aa === 'FXAA') n = fxaa(n);
      if (state.grain > 0) n = film(n, u.grain);
    }
    pipeline.outputNode = n;
    pipeline.needsUpdate = true;
  }

  function apply() {
    u.bloomStrength.value = state.bloomStrength;
    u.bloomRadius.value = state.bloomRadius;
    u.bloomThreshold.value = state.bloomThreshold;
    u.focalRange.value = state.focalRange;
    u.bokeh.value = state.bokeh;
    u.mb.value = state.motionBlurAmount;
    u.exposure.value = 2 ** state.exposure;
    u.contrast.value = state.contrast;
    u.saturation.value = state.saturation;
    u.temperature.value = state.temperature;
    u.vignette.value = state.vignette;
    u.grain.value = state.grain;
    const k = [state.enabled, state.aa, state.bloom, state.dof, state.motionBlur, state.grain > 0].join('|');
    if (k !== key) { key = k; build(); }
  }
  apply();

  const tmp = new THREE.Vector3();
  return {
    state,
    apply,
    aaModes: AA_MODES,
    pipeline,
    render() {
      if (state.dof) {
        if (state.autoFocus && getFocusTarget) {
          getFocusTarget(tmp);
          // distancia a lo largo del eje de la cámara
          const fwd = camera.getWorldDirection(new THREE.Vector3());
          u.focus.value = Math.max(1, tmp.sub(camera.position).dot(fwd));
        } else u.focus.value = state.focusDistance;
      }
      // en el fotograma de un corte la velocidad no significa nada: sin motion blur
      u.mb.value = consumeCut?.() ? 0 : state.motionBlurAmount;
      if (state.enabled || under.needsPost) pipeline.render();
      else renderer.render(scene, camera);
    },
  };
}
