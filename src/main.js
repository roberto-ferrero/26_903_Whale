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
import { createPost } from './core/post.js';
import { createSequence } from './core/sequence.js';
import { createAudio } from './audio/audio.js';
import { createQuality } from './core/quality.js';
import { createRecorder } from './core/recorder.js';
import { createFish } from './life/fish.js';
import { createUi } from './core/ui.js';
import { createParallax } from './core/parallax.js';
import { output, positionWorld, vec4 } from 'three/tsl';

const MODEL_URL = `${import.meta.env.BASE_URL}models/whale.glb`;
const WET_URL = `${import.meta.env.BASE_URL}models/whale_wet_2k.ktx2`;

const container = document.querySelector('#app');
// presentación (29/09/2026): cortina azul con los pasos de la inicialización, cabecera y pie
const ui = createUi(document.body, navigator.gpu && !new URLSearchParams(location.search).has('webgl') ? 'WebGPU' : 'WebGL2');
await ui.step('Iniciando el renderizador WebGPU…', 0.04);

const viewer = await createViewer(container);
ui.setBackend(viewer.compute ? 'WebGPU' : 'WebGL2 (fallback)');

let whale;
try {
  await ui.step('Cargando la ballena (malla, esqueleto y texturas)…', 0.1);
  whale = await loadWhale(MODEL_URL, WET_URL, viewer.renderer);
} catch (err) {
  console.error(err);
  ui.error('No se pudo cargar <code>public/models/whale.glb</code>.<br>'
    + 'El modelo no se versiona (licencia de CGTrader): genéralo con el proceso de '
    + '<code>.PLAN/docs/fase_1_8_exportacion.md</code> y copia <code>whale.glb</code> y '
    + '<code>whale_wet_2k.ktx2</code> a <code>public/models/</code>.');
  throw err;
}
viewer.scene.add(whale.root);

// ------------------------------------------------------------------ módulos
const clock = createSimClock();
await ui.step('Generando las nubes volumétricas…', 0.3);
const clouds = await createClouds(viewer.renderer, viewer.scene);
await ui.step('Calculando el cielo y la luz del sol…', 0.4);
const sky = createSky(viewer, [clouds.envMesh]);
const lighting = createLighting(viewer, () => sky.state.enabled);
await ui.step('Generando el océano (espectro y FFT)…', 0.48);
const ripples = viewer.compute ? createRipples(viewer.renderer) : null; // ondas y espuma de la ballena (Fase 5); sin compute no hay
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
fsm.setWaterHeight((x, z) => ocean.heightAt(x, z)); // la respiración sigue la ola local
const skeleton = createSkeletonHelpers(viewer.scene, whale);
await ui.step('Preparando salpicaduras, burbujas y espuma…', 0.56);
const water = createInteraction({ renderer: viewer.renderer, scene: viewer.scene, whale, ocean, ripples, fsm });
const under = createUnderwater({ renderer: viewer.renderer, scene: viewer.scene, camera: viewer.camera, ocean }); // Fase 6
const snow = createSnow({ scene: viewer.scene, ocean });
// posprocesado global (Fase 7.3): enfoque automático en el centro de la ballena
const post = createPost({
  renderer: viewer.renderer, scene: viewer.scene, camera: viewer.camera, under, getFocusTarget: (out) => fsm.getPose(out),
  consumeCut: () => cameras.consumeCut(),
});
// bajo el agua, la ballena recibe la luz que llega a esa profundidad, con cáusticas (Fase 6.5)
for (const m of Object.values(whale.materials)) m.outputNode = output.mul(vec4(ocean.underLightNode(positionWorld), 1));
const anchor = createAnchor(viewer.scene, whale, helpers.state);
const cameras = createCameras(viewer, (out) => fsm.getPose(out), helpers.state, () => fsm.state.current,
  (x, z) => (ocean.state.enabled ? ocean.heightAt(x, z) : helpers.state.waterLevel));
const sequence = createSequence({ fsm, cameras, helpers, anchor, skeleton }); // Fase 7.1
const audio = createAudio({ camera: viewer.camera, fsm, ocean, under }); // Fase 7.4
const recorder = createRecorder({ canvas: viewer.renderer.domElement }); // Fase 8.4
await ui.step('Soltando el cardumen…', 0.62);
const fish = createFish({ scene: viewer.scene, ocean, water, camera: viewer.camera }); // cardumen y peces sueltos
// efecto 3D de ventana (paralaje con la cámara frontal); desactivado hasta que se pulse el botón
const parallax = createParallax({ camera: viewer.camera, controls: viewer.controls, canvas: viewer.renderer.domElement });
const parallaxButton = ui.addButton('Activar efecto 3D (cámara)', () => {
  const on = parallax.toggle();
  parallaxButton.textContent = on ? 'Desactivar efecto 3D' : 'Activar efecto 3D (cámara)';
  gui?.controllersRecursive().forEach((c) => c.updateDisplay());
});
let gui = null;
const quality = createQuality({ // Fase 8.1
  viewer, clouds, under, post, water, onChange: () => gui?.controllersRecursive().forEach((c) => c.updateDisplay()),
});
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
params.add('calidad', quality.state, quality.apply, ['profile']);
params.add('peces', fish.state, fish.apply, Object.keys(fish.state).filter((k) => !['info', 'loners', 'lonerSize'].includes(k)));
params.add('post', post.state, post.apply);
params.add('audio', audio.state, audio.apply, ['volume', 'ocean', 'effects', 'song']); // sin 'enabled': el navegador exige un clic
params.add('secuencia', sequence.state, () => {}, ['loop', 'deepTime', 'deepDepth', 'swimTime', 'swimDepth', 'surfaceTime', 'surfaceDepth', 'autoCamera']);
params.add('modelo', look.state, look.apply);
params.add('lod', lod.state, () => {}, ['mode', 'dist1', 'dist2']);
params.add('ayudas', helpers.state, helpers.apply);
params.add('debug', debug.state, debug.apply);
const presets = loadBuiltinPresets();

// ayudas de depuración (tecla B): por defecto no se ve ninguna; B activa o quita a la vez el
// marcador y la línea del ancla, el hueso seleccionado, la trayectoria del salto, la dirección del
// sol, la línea de tiempo y las estadísticas
let helpersOn = false;
function toggleHelpers(on = !helpersOn) {
  helpersOn = on;
  anchor.state.marker = on; anchor.state.dropLine = on; anchor.apply();
  skeleton.state.showSelected = on; skeleton.apply();
  fsm.params.showPath = on; fsm.apply();
  helpers.state.sunHelper = on; helpers.apply();
  debug.state.timeline = on; debug.apply();
  stats.state.visible = on; stats.apply();
  gui?.controllersRecursive().forEach((c) => c.updateDisplay());
}

gui = createGui({ clock, fsm, anim, lod, look, cameras, lighting, sky, clouds, ocean, water, under, post, sequence, audio, quality, recorder, fish, viewer, applySky, applyClouds, helpers, skeleton, anchor, debug, stats, params, presets, toggleHelpers, parallax });
applySky();
if (!viewer.compute) {
  // Fase 8.5: WebGL2 (sin WebGPU): perfil bajo y aviso de lo que no está disponible
  quality.state.profile = 'Bajo';
  quality.apply();
  const note = document.createElement('div');
  note.className = 'message webgl-note';
  note.textContent = 'Este navegador no tiene WebGPU: modo WebGL2 con calidad reducida '
    + '(olas de Gerstner en lugar de FFT, sin salpicaduras ni ondas de la ballena).';
  container.appendChild(note);
  setTimeout(() => note.remove(), 9000);
}
params.readURL();

// ------------------------------------------------------------------ teclado
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea')) return;
  if (e.code === 'Space') { clock.togglePause(); e.preventDefault(); }
  else if (e.key === '.') clock.step();
  else if (e.key.toLowerCase() === 'j') fsm.jump();
  else if (e.key.toLowerCase() === 'r') fsm.breathe();
  else if (e.key.toLowerCase() === 'b') toggleHelpers();
  else if (e.key.toLowerCase() === 'p') sequence.toggle();
  else if (e.key.toLowerCase() === 'c') {
    cameras.state.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(cameras.state.mode) + 1) % CAMERA_MODES.length];
    cameras.apply();
  }
});

// ------------------------------------------------------------------ fotograma
/** Un fotograma completo: simulación, cámaras, cielo, nubes, ayudas y render. */
function frame(realDt) {
  const dt = clock.tick(realDt);
  sequence.update(dt); // Fase 7.1
  // durante el arranque la ballena solo nada (la primera respiración o salto, cuando la cámara ya
  // está en su sitio)
  if (cameras.introActive && fsm.state.current === 'nadar') fsm.state.timeInState = 0;
  fsm.update(dt); // incluye el mixer de animación
  cameras.update(realDt, dt);
  parallax.begin(realDt); // efecto 3D: ojo desplazado y proyección descentrada (se deshace tras dibujar)
  sky.update(dt);
  clouds.update(dt, viewer.camera, sky.light.dir, sky.light.sunColor, sky.light.sunIntensity, sky.light.ambient);
  clouds.changing = sky.state.animate && dt > 0; // con la hora avanzando, sin historial temporal
  sky.renderEnv(); // entorno PMREM con el cielo y las nubes ya actualizados
  ocean.update(dt, sky.light, viewer.sun); // oleaje FFT (compute) y luz del agua (Fase 4)
  water.update(dt, sky.light, viewer.sun); // sondas, ondas, espuma y salpicaduras (Fase 5)
  fish.update(dt);
  under.update(realDt); // ¿cámara bajo el agua? (Fase 6)
  snow.update(dt, under.underwater, under.state.snow);
  audio.update(realDt);
  quality.update(realDt);
  lod.update(viewer.camera);
  helpers.update();
  skeleton.update();
  anchor.update();
  debug.update();
  if (!viewer.ensureSize()) { parallax.end(); return false; } // ventana oculta: evita texturas de tamaño 0
  clouds.render(viewer.camera); // pase de nubes a resolución reducida (Fase 3.4)
  post.render(); // escena + bajo el agua (Fase 6) + posprocesado global (Fase 7.3)
  recorder.frame(); // Fase 8.4
  viewer.labelRenderer.render(viewer.scene, viewer.camera);
  parallax.end();
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
    THREE, viewer, whale, clock, anim, fsm, lod, look, lighting, sky, clouds, ocean, water, under, snow, post, sequence, audio, quality, recorder, fish, helpers, parallax,
    get gui() { return gui; }, skeleton, anchor, cameras, debug, params,
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
          post.render();
          recorder.frame();
        }
        await renderer.resolveTimestampsAsync('render');
      }
      return renderer.info.render.timestamp;
    },
    /** Rendimiento: n fotogramas completos a paso fijo; ms por fotograma (tiempo real con la GPU sincronizada). */
    async benchmark(n = 60, size = [1920, 1080]) {
      renderer.setSize(size[0], size[1], false);
      viewer.camera.aspect = size[0] / size[1];
      viewer.camera.updateProjectionMatrix();
      const dev = renderer.backend.device;
      const step = () => {
        renderer._nodes.nodeFrame.update();
        if (!frame(1 / 60)) { clouds.render(viewer.camera); post.render(); } // pestaña oculta: se dibuja igual
      };
      for (let i = 0; i < 5; i++) step();
      await dev?.queue.onSubmittedWorkDone();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) step();
      await dev?.queue.onSubmittedWorkDone();
      return +((performance.now() - t0) / n).toFixed(2);
    },
    /** Guarda una captura JPEG del canvas en .PLAN/docs/img/<nombre>.jpg (servidor de desarrollo). */
    async capture(name, frames = 6) {
      await this.renderFrames(frames);
      const c = renderer.domElement;
      const t = document.createElement('canvas');
      t.width = 1280; t.height = Math.round((1280 * c.height) / Math.max(c.width, 1)); // conserva el encuadre (2,4:1)
      t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
      const res = await fetch(`/__capture?name=${encodeURIComponent(name)}`, { method: 'POST', body: t.toDataURL('image/jpeg', 0.85) });
      return res.text();
    },
  };
}

// ------------------------------------------------------------------ arranque (29/09/2026)
// la cámara empieza bajo la ballena, mirando hacia arriba a contraluz del sol (el encuadre de
// referencia) y, cuando la imagen ya es estable y la cortina se ha fundido, viaja hasta la posición
// de seguimiento
const FOLLOW_OFFSET = new THREE.Vector3(16, 4.3, 10.8); // seguimiento por defecto, respecto a la ballena
{
  const sunH = new THREE.Vector3(sky.light.dir.x, 0, sky.light.dir.z);
  if (sunH.lengthSq() < 1e-4) sunH.set(1, 0, 0);
  sunH.normalize();
  const heading = fsm.getPose(new THREE.Vector3());
  const fwd = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
  // debajo y del lado contrario al sol: al mirar a la ballena se mira también hacia el sol
  const from = new THREE.Vector3().addScaledVector(sunH, -6).addScaledVector(fwd, -3).setY(-13);
  const target = fwd.clone().multiplyScalar(2).setY(0.5);
  cameras.setIntro(from, target, FOLLOW_OFFSET);
}

// métricas del pie (dos veces por segundo)
let mFrames = 0, mTime = 0, mMs = 0;
function updateMetrics(realDt) {
  mFrames++; mTime += realDt;
  if (mTime < 0.5) return;
  const fps = mFrames / mTime;
  mMs = (mTime / mFrames) * 1000;
  mFrames = 0; mTime = 0;
  const r = viewer.renderer.info.render;
  const s = viewer.renderer.getDrawingBufferSize(new THREE.Vector2());
  ui.setMetrics(`${fps.toFixed(1)} FPS · ${mMs.toFixed(2)} ms/fotograma · ${s.x} × ${s.y} · `
    + `${(r.drawCalls ?? r.calls ?? 0).toLocaleString('es-ES')} dibujos · `
    + `${(r.triangles ?? 0).toLocaleString('es-ES')} triángulos · calidad: ${quality.state.active}`);
}

// ------------------------------------------------------------------ bucle
await ui.step('Compilando shaders…', 0.7);
const timer = new THREE.Timer();
let warm = 0, warmTime = 0, revealed = false;
const recent = [];
viewer.renderer.setAnimationLoop((time) => {
  timer.update(time);
  const realDt = Math.min(timer.getDelta(), 0.1);
  frame(realDt);
  updateMetrics(realDt);
  if (revealed) return;
  // se funde cuando la imagen es estable: al menos 1,5 s y 45 fotogramas dibujados y los últimos 15
  // sin tirones (compilación de shaders); como mucho, 12 s
  warm++; warmTime += realDt;
  recent.push(realDt); if (recent.length > 15) recent.shift();
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const worst = Math.max(...recent);
  if (warm === 3) ui.step('Estabilizando la imagen…', 0.85);
  if ((warm > 45 && warmTime > 1.5 && recent.length === 15 && worst < Math.max(0.06, avg * 2.5)) || warmTime > 12) {
    revealed = true;
    ui.reveal(2.2);
    setTimeout(() => cameras.releaseIntro(7), 3200); // la cámara viaja tras un momento a contraluz
  }
});
