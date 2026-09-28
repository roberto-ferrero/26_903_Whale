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
import { createOcean } from './ocean/ocean.js';
import { createRipples } from './water/ripples.js';
import { createInteraction } from './water/interaction.js';
import { createUnderwater } from './underwater/underwater.js';
import { createSnow } from './underwater/snow.js';
import { output, positionWorld, vec4 } from 'three/tsl';

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
const ripples = createRipples(viewer.renderer); // ondas y espuma de la ballena (Fase 5)
const ocean = createOcean({
  renderer: viewer.renderer, scene: viewer.scene, camera: viewer.camera, clouds, sky, getTime: () => clock.state.time, ripples,
});
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
const water = createInteraction({ renderer: viewer.renderer, scene: viewer.scene, whale, ocean, ripples, fsm });
const under = createUnderwater({ renderer: viewer.renderer, scene: viewer.scene, camera: viewer.camera, ocean }); // Fase 6
const snow = createSnow({ scene: viewer.scene, ocean });
// bajo el agua, la ballena recibe la luz que llega a esa profundidad, con cáusticas (Fase 6.5)
for (const m of Object.values(whale.materials)) m.outputNode = output.mul(vec4(ocean.underLightNode(positionWorld), 1));
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
params.add('cielo', sky.state, applySky, ['enabled', 'model', 'ozone', 'multiScattering', 'place', 'lat', 'lon', 'tz', 'date', 'hour', 'animate', 'timeSpeed',
  'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'skyBrightness', 'sunStrength', 'ambientStrength',
  'moonStrength', 'stars', 'cloudLight', 'fogDensity']);
params.add('nubes', clouds.state, applyClouds);
params.add('oceano', ocean.state, () => ocean.apply(), Object.keys(ocean.state).filter((k) => k !== 'info'));
params.add('agua', water.state, water.apply, Object.keys(water.state).filter((k) => k !== 'info'));
params.add('bajoagua', under.state, under.apply, Object.keys(under.state).filter((k) => k !== 'info'));
params.add('modelo', look.state, look.apply);
params.add('lod', lod.state, () => {}, ['mode', 'dist1', 'dist2']);
params.add('ayudas', helpers.state, helpers.apply);
params.add('debug', debug.state, debug.apply);
const presets = loadBuiltinPresets();
createGui({ clock, fsm, anim, lod, look, cameras, lighting, sky, clouds, ocean, water, under, applySky, applyClouds, helpers, skeleton, anchor, debug, stats, params, presets });
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

// ------------------------------------------------------------------ fotograma
/** Un fotograma completo: simulación, cámaras, cielo, nubes, ayudas y render. */
function frame(realDt) {
  const dt = clock.tick(realDt);
  fsm.update(dt); // incluye el mixer de animación
  cameras.update(realDt, dt);
  sky.update(dt);
  clouds.update(dt, viewer.camera, sky.light.dir, sky.light.sunColor, sky.light.sunIntensity, sky.light.ambient);
  clouds.changing = sky.state.animate && dt > 0; // con la hora avanzando, sin historial temporal
  sky.renderEnv(); // entorno PMREM con el cielo y las nubes ya actualizados
  ocean.update(dt, sky.light, viewer.sun); // oleaje FFT (compute) y luz del agua (Fase 4)
  water.update(dt, sky.light, viewer.sun); // sondas, ondas, espuma y salpicaduras (Fase 5)
  under.update(realDt); // ¿cámara bajo el agua? (Fase 6)
  snow.update(dt, under.underwater, under.state.snow);
  lod.update(viewer.camera);
  helpers.update();
  skeleton.update();
  anchor.update();
  debug.update();
  if (!viewer.ensureSize()) return false; // ventana oculta: evita texturas de tamaño 0
  clouds.render(viewer.camera); // pase de nubes a resolución reducida (Fase 3.4)
  under.render(); // escena + posprocesado bajo el agua (Fase 6)
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
  return true;
}

// depuración desde la consola del navegador (solo en `npm run dev`)
if (import.meta.env.DEV) {
  const renderer = viewer.renderer;
  window.whaleViewer = {
    THREE, viewer, whale, clock, anim, fsm, lod, look, lighting, sky, clouds, ocean, water, under, snow, helpers, skeleton, anchor, cameras, debug, params,
    /** Dibuja n fotogramas a paso fijo aunque la pestaña esté oculta; devuelve el tiempo de GPU del último (ms). */
    async renderFrames(n = 1, realDt = 1 / 30, size = [1280, 720]) {
      if (renderer.domElement.width === 0 || window.innerWidth === 0) {
        renderer.setSize(size[0], size[1], false);
        viewer.camera.aspect = size[0] / size[1];
        viewer.camera.updateProjectionMatrix();
      }
      for (let i = 0; i < n; i++) {
        // sin requestAnimationFrame (pestaña oculta) nadie avanza el frameId de los nodos y la piel
        // de la ballena no se actualiza: se avanza aquí (API interna de Three.js r186)
        renderer._nodes.nodeFrame.update();
        if (!frame(realDt)) {
          clouds.render(viewer.camera);
          under.render();
        }
        await renderer.resolveTimestampsAsync('render');
      }
      return renderer.info.render.timestamp;
    },
    /** Guarda una captura JPEG del canvas en .PLAN/docs/img/<nombre>.jpg (servidor de desarrollo). */
    async capture(name, frames = 6) {
      await this.renderFrames(frames);
      const c = renderer.domElement;
      const t = document.createElement('canvas');
      t.width = 1280; t.height = 720;
      t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
      const res = await fetch(`/__capture?name=${encodeURIComponent(name)}`, { method: 'POST', body: t.toDataURL('image/jpeg', 0.85) });
      return res.text();
    },
  };
}

// ------------------------------------------------------------------ bucle
const timer = new THREE.Timer();
viewer.renderer.setAnimationLoop((time) => {
  timer.update(time);
  frame(Math.min(timer.getDelta(), 0.1));
});
