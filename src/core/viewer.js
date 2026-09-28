import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export const TONE_MAPPINGS = {
  AgX: THREE.AgXToneMapping,
  ACES: THREE.ACESFilmicToneMapping,
  Neutral: THREE.NeutralToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
  Ninguno: THREE.NoToneMapping,
};

/**
 * Renderer WebGPU, escena, cámara orbital, entorno (PMREM) y luces.
 * Unidades en metros; eje Y arriba; la ballena mira hacia +Z.
 */
export async function createViewer(container) {
  // en desarrollo se miden los tiempos de GPU (timestamp queries) para el panel de depuración
  const renderer = new THREE.WebGPURenderer({ antialias: true, trackTimestamp: import.meta.env.DEV });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1;
  container.appendChild(renderer.domElement);
  await renderer.init();

  // etiquetas HTML (nombres de huesos) sobre el canvas
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'labels';
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1d2b3a);

  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(16, 5, 12);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.4, 0);
  controls.maxDistance = 600;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x1a2a33, 0.6);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4e5, 2.5);
  scene.add(sun, sun.target);
  const sunParams = { elevation: 45, azimuth: 35 };
  const updateSun = () => {
    const el = THREE.MathUtils.degToRad(sunParams.elevation);
    const az = THREE.MathUtils.degToRad(sunParams.azimuth);
    sun.position.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(40);
  };
  updateSun();

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  // Si la página se cargó con la ventana oculta (tamaño 0) no siempre llega un `resize`:
  // se comprueba en cada fotograma. Devuelve false mientras no haya nada que dibujar.
  const size = new THREE.Vector2();
  const ensureSize = () => {
    if (window.innerWidth === 0 || window.innerHeight === 0) return false;
    renderer.getSize(size);
    if (size.x !== window.innerWidth || size.y !== window.innerHeight) onResize();
    return true;
  };

  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 (fallback)';

  return { renderer, labelRenderer, scene, camera, controls, sun, sunParams, updateSun, hemi, backend, ensureSize };
}
