import './style.css';
import * as THREE from 'three/webgpu';
import { createViewer } from './core/viewer.js';
import { createHelpers } from './core/helpers.js';
import { createStats } from './core/stats.js';
import { createGui } from './core/gui.js';
import { loadWhale, createLodController, createAnimationController } from './whale/whale.js';
import { createSkeletonHelpers } from './whale/skeletonHelpers.js';
import { createAnchor } from './whale/anchor.js';
import { createBreach } from './whale/breach.js';

const MODEL_URL = `${import.meta.env.BASE_URL}models/whale.glb`;
const WET_URL = `${import.meta.env.BASE_URL}models/whale_wet_2k.png`;

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
    + 'El modelo no se versiona (licencia de CGTrader): expórtalo con '
    + '<code>_Blender/scripts/export_glb.py</code> y cópialo a <code>public/models/</code> '
    + 'junto con <code>whale_wet_2k.png</code>.';
  throw err;
}
message.remove();
viewer.scene.add(whale.root);

const lod = createLodController(whale);
const anim = createAnimationController(whale);
const helpers = createHelpers(viewer.scene, viewer.sun, whale, lod.state);
const skeleton = createSkeletonHelpers(viewer.scene, whale);
const anchor = createAnchor(viewer.scene, whale, viewer.camera, viewer.controls, helpers.state);
const breach = createBreach(viewer.scene, whale, anim, helpers.state);
const stats = createStats(container, viewer.backend);
createGui({ viewer, whale, anim, lod, helpers, skeleton, anchor, breach, stats });

// depuración desde la consola del navegador (solo en `npm run dev`)
if (import.meta.env.DEV) window.whaleViewer = { THREE, viewer, whale, anim, lod, helpers, skeleton, anchor, breach };

const timer = new THREE.Timer();
viewer.renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.1);
  if (breach.state.active) breach.update(dt);
  else anim.update(dt);
  lod.update(viewer.camera);
  helpers.update();
  skeleton.update();
  anchor.update();
  viewer.controls.update(dt);
  if (!viewer.ensureSize()) return; // ventana oculta: evita texturas de tamaño 0
  viewer.renderer.render(viewer.scene, viewer.camera);
  viewer.labelRenderer.render(viewer.scene, viewer.camera);
  stats.update(
    viewer.renderer,
    `LOD${lod.state.active} (${whale.triangles[lod.state.active].toLocaleString('es-ES')} tris, ${lod.state.distance.toFixed(0)} m)`
      + ` · ${anim.state.clip} ${anim.state.time.toFixed(2)} / ${anim.state.duration.toFixed(2)} s`
      + (breach.state.active
        ? `\nsalto: ${breach.state.phase} · ${breach.state.cycleTime.toFixed(1)} / ${breach.state.cycleDuration.toFixed(1)} s · ${breach.state.lastEvent}`
        : ''),
  );
});
