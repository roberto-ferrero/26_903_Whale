import './style.css';
import * as THREE from 'three/webgpu';
import { createViewer } from './core/viewer.js';
import { createSimClock } from './core/clock.js';
import { createParamRegistry, loadBuiltinPresets } from './core/params.js';
import { createLighting } from './core/lighting.js';
import { createHelpers } from './core/helpers.js';
import { createCameras, CAMERA_MODES } from './core/cameras.js';
import { createDebug } from './core/debug.js';
import { createStats } from './core/stats.js';
import { createGui } from './core/gui.js';
import { loadWhale, createLodController, createAnimationController } from './whale/whale.js';
import { createWhaleLook } from './whale/look.js';
import { createWhaleStates } from './whale/whaleStates.js';
import { createSkeletonHelpers } from './whale/skeletonHelpers.js';
import { createAnchor } from './whale/anchor.js';
import { createSky } from './sky/sky.js';
import { createClouds } from './sky/clouds.js';

const MODEL_URL = `${import.meta.env.BASE_URL}models/whale.glb`;
const WET_URL = `${import.meta.env.BASE_URL}models/whale_wet_2k.ktx2`;

const container = document.querySelector('#app');
const message = document.createElement('div');
message.className = 'message';
message.textContent = 'Cargando ballena…';
container.appendChild(message);

const viewer = await createViewer(container);

let whale;
try {
  whale = await loadWhale(MODEL_URL, WET_URL, viewer.renderer);
} catch (err) {
  console.error(err);
  message.innerHTML = 'No se pudo cargar <code>public/models/whale.glb</code>.<br>'
    + 'El modelo no se versiona (licencia de CGTrader): genéralo con el proceso de '
    + '<code>.PLAN/docs/fase_1_8_exportacion.md</code> y copia <code>whale.glb</code> y '
    + '<code>whale_wet_2k.ktx2</code> a <code>public/models/</code>.';
  throw err;
}
message.remove();
viewer.scene.add(whale.root);

// ------------------------------------------------------------------ módulos
const clock = createSimClock();
const clouds = await createClouds(viewer.renderer, viewer.scene);
const sky = createSky(viewer, [clouds.envMesh]);
const lighting = createLighting(viewer, () => sky.state.enabled);
// al cambiar cielo o nubes: la iluminación manual vuelve si el cielo se apaga y se rehace el entorno
const applySky = () => { sky.apply(); lighting.apply(); };
const applyClouds = () => { clouds.apply(); sky.invalidateEnv(); };
const lod = createLodController(whale);
const anim = createAnimationController(whale);
const look = createWhaleLook(whale);
const helpers = createHelpers(viewer.scene, viewer.sun, whale, lod.state);
helpers.setWaterShadow((p) => clouds.cloudShadowNode(p)); // sombras de nubes sobre el agua (Fase 3.5)
const fsm = createWhaleStates(viewer.scene, whale, anim, helpers.state);
const skeleton = createSkeletonHelpers(viewer.scene, whale);
const anchor = createAnchor(viewer.scene, whale, helpers.state);
const cameras = createCameras(viewer, (out) => fsm.getPose(out), helpers.state, () => fsm.state.current);
const debug = createDebug(container, whale, fsm);
const stats = createStats(container, viewer.backend);

// ------------------------------------------------------------------ parámetros: presets y URL (Fase 2.2)
const params = createParamRegistry();
params.add('tiempo', clock.state, clock.apply, ['timeScale', 'stepSize']);
params.add('ballena', fsm.params, () => fsm.apply());
params.add('camara', cameras.state, cameras.apply, ['mode', 'rail', 'transition', 'hardCuts', 'followSmoothing', 'railSpeed', 'fov', 'autoRotate', 'rotateSpeed']);
params.add('luz', lighting.state, lighting.apply);
params.add('cielo', sky.state, applySky, ['enabled', 'place', 'lat', 'lon', 'tz', 'date', 'hour', 'animate', 'timeSpeed',
  'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'skyBrightness', 'sunStrength', 'ambientStrength',
  'moonStrength', 'stars', 'cloudLight', 'fogDensity']);
params.add('nubes', clouds.state, applyClouds);
params.add('modelo', look.state, look.apply);
params.add('lod', lod.state, () => {}, ['mode', 'dist1', 'dist2']);
params.add('ayudas', helpers.state, helpers.apply);
params.add('debug', debug.state, debug.apply);
const presets = loadBuiltinPresets();
createGui({ clock, fsm, anim, lod, look, cameras, lighting, sky, clouds, applySky, applyClouds, helpers, skeleton, anchor, debug, stats, params, presets });
applySky();
params.readURL();

// ------------------------------------------------------------------ teclado
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea')) return;
  if (e.code === 'Space') { clock.togglePause(); e.preventDefault(); }
  else if (e.key === '.') clock.step();
  else if (e.key.toLowerCase() === 'j') fsm.jump();
  else if (e.key.toLowerCase() === 'c') {
    cameras.state.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(cameras.state.mode) + 1) % CAMERA_MODES.length];
    cameras.apply();
  }
});

// depuración desde la consola del navegador (solo en `npm run dev`)
if (import.meta.env.DEV) {
  window.whaleViewer = { THREE, viewer, whale, clock, anim, fsm, lod, look, lighting, sky, clouds, helpers, skeleton, anchor, cameras, debug, params };
}

// ------------------------------------------------------------------ bucle
const timer = new THREE.Timer();
viewer.renderer.setAnimationLoop((time) => {
  timer.update(time);
  const realDt = Math.min(timer.getDelta(), 0.1);
  const dt = clock.tick(realDt);
  fsm.update(dt); // incluye el mixer de animación
  cameras.update(realDt, dt);
  sky.update(dt);
  clouds.update(dt, viewer.camera, sky.light.dir, sky.light.sunColor, sky.light.sunIntensity, sky.light.ambient);
  clouds.changing = sky.state.animate && dt > 0; // con la hora avanzando, sin historial temporal
  lod.update(viewer.camera);
  helpers.update();
  skeleton.update();
  anchor.update();
  debug.update();
  if (!viewer.ensureSize()) return; // ventana oculta: evita texturas de tamaño 0
  clouds.render(viewer.camera); // pase de nubes a resolución reducida (Fase 3.4)
  viewer.renderer.render(viewer.scene, viewer.camera);
  viewer.labelRenderer.render(viewer.scene, viewer.camera);
  const c = clock.state;
  stats.update(
    viewer.renderer,
    `LOD${lod.state.active} (${whale.triangles[lod.state.active].toLocaleString('es-ES')} tris, ${lod.state.distance.toFixed(0)} m)`
      + ` · cámara: ${cameras.state.shot}`
      + `\n${c.paused ? '⏸ pausa' : `▶ ×${c.timeScale.toFixed(2)}`} · t = ${c.time.toFixed(1)} s · ${fsm.params.enabled ? fsm.state.label : 'modo libre'}`
      + ` · clip ${anim.state.clip} ${anim.state.time.toFixed(2)} s`
      + (sky.state.enabled ? `\ncielo: ${sky.state.localTime} · sol ${sky.state.sunAltAz} · ${sky.state.moonInfo}` : ''),
  );
});
