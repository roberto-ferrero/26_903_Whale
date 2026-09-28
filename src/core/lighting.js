import * as THREE from 'three/webgpu';
import { TONE_MAPPINGS } from './viewer.js';

/**
 * Iluminación y ambiente de la escena placeholder (Fase 2.1): tone mapping y exposición,
 * sol (elevación/azimut), luz hemisférica, entorno, fondo y niebla.
 * Con el cielo de la Fase 3 activo, sol, ambiente, fondo y niebla los calcula el cielo y aquí
 * solo quedan el tone mapping y la exposición (el resto se usa con el cielo desactivado).
 */
export function createLighting(viewer, isSkyActive = () => false) {
  const { renderer, scene, sun, sunParams, updateSun, hemi } = viewer;
  const state = {
    toneMapping: 'AgX',
    exposure: 1,
    environment: 0.6,
    sunIntensity: 2.5,
    sunColor: '#fff4e5',
    sunElevation: sunParams.elevation,
    sunAzimuth: sunParams.azimuth,
    hemiIntensity: 0.6,
    background: '#8e979f',
    fog: true,
    fogNear: 60,
    fogFar: 420,
  };
  scene.fog = new THREE.Fog(state.background, state.fogNear, state.fogFar);

  function apply() {
    renderer.toneMapping = TONE_MAPPINGS[state.toneMapping] ?? THREE.AgXToneMapping;
    renderer.toneMappingExposure = state.exposure;
    if (isSkyActive()) return; // el cielo (Fase 3) calcula sol, ambiente, fondo y niebla
    if (!scene.fog?.isFog) scene.fog = new THREE.Fog(state.background, state.fogNear, state.fogFar);
    if (!scene.background?.isColor) scene.background = new THREE.Color();
    scene.environmentIntensity = state.environment;
    sun.intensity = state.sunIntensity;
    sun.color.set(state.sunColor);
    sunParams.elevation = state.sunElevation;
    sunParams.azimuth = state.sunAzimuth;
    updateSun();
    hemi.intensity = state.hemiIntensity;
    scene.background.set(state.background);
    scene.fog.color.set(state.background);
    scene.fog.near = state.fog ? state.fogNear : 1e6;
    scene.fog.far = state.fog ? state.fogFar : 1e6 + 1;
  }
  apply();

  return { state, apply, toneMappings: Object.keys(TONE_MAPPINGS) };
}
