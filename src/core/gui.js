import GUI from 'lil-gui';
import { TONE_MAPPINGS } from './viewer.js';

const STORAGE_KEY = 'whale-viewer-gui';

const CAMERA_VIEWS = {
  'Tres cuartos': [16, 5, 12],
  Lateral: [22, 0.4, 0],
  Frontal: [0, 1, 20],
  Superior: [0, 26, 0.01],
  Inferior: [0, -24, 0.01],
  Cabeza: [6, 2, 10],
  Cola: [5, 2, -12],
};

/** Panel lil-gui con todas las opciones del visor. */
export function createGui({ viewer, whale, anim, lod, helpers, stats }) {
  const { renderer, scene, camera, controls, sun, sunParams, updateSun, hemi } = viewer;
  const gui = new GUI({ title: 'Ballena jorobada · visor' });

  // ------------------------------------------------------------------ animación
  const fAnim = gui.addFolder('Animación');
  fAnim.add(anim.state, 'clip', anim.names).name('Clip').onChange((name) => anim.play(name));
  fAnim.add(anim.state, 'playing').name('Reproducir');
  fAnim.add(anim.state, 'speed', 0, 3, 0.05).name('Velocidad');
  fAnim.add(anim.state, 'loop').name('Bucle').onChange(() => anim.applyLoop());
  fAnim.add(anim.state, 'fade', 0, 2, 0.05).name('Fundido (s)');
  const timeCtrl = fAnim.add(anim.state, 'time', 0, 6, 0.01).name('Tiempo (s)').listen()
    .onChange((t) => { anim.state.playing = false; anim.seek(t); });
  const updateTimeRange = () => timeCtrl.max(Math.max(anim.state.duration, 0.01)).updateDisplay();
  fAnim.controllers[0].onFinishChange(updateTimeRange);
  updateTimeRange();
  fAnim.add({ rest: () => anim.restPose() }, 'rest').name('Pose de reposo');

  // ------------------------------------------------------------------ modelo
  const fModel = gui.addFolder('Modelo');
  fModel.add(lod.state, 'mode', ['Auto', 'LOD0', 'LOD1', 'LOD2']).name('LOD');
  fModel.add(lod.state, 'dist1', 5, 200, 1).name('Distancia LOD1 (m)');
  fModel.add(lod.state, 'dist2', 10, 500, 1).name('Distancia LOD2 (m)');
  const skin = whale.materials.Humpback;
  const barbs = whale.materials.Barbs;
  const matState = {
    wetness: 0,
    wetDarken: whale.uniforms.wetDarken.value,
    normalMap: true,
    normalScale: 1,
    aoIntensity: skin.aoMapIntensity,
    wireframe: false,
    barbs: true,
  };
  const normalMaps = new Map(Object.values(whale.materials).map((m) => [m, m.normalMap]));
  fModel.add(matState, 'wetness', 0, 1, 0.01).name('Mojado').onChange((v) => { whale.uniforms.wetness.value = v; });
  fModel.add(matState, 'wetDarken', 0, 0.4, 0.01).name('Oscurecer al mojar').onChange((v) => { whale.uniforms.wetDarken.value = v; });
  fModel.add(matState, 'normalMap').name('Normal map').onChange((on) => {
    for (const [m, map] of normalMaps) { m.normalMap = on ? map : null; m.needsUpdate = true; }
  });
  fModel.add(matState, 'normalScale', 0, 3, 0.05).name('Intensidad normal').onChange((v) => {
    for (const m of normalMaps.keys()) m.normalScale.set(v, v);
  });
  fModel.add(matState, 'aoIntensity', 0, 2, 0.05).name('Intensidad AO').onChange((v) => { skin.aoMapIntensity = v; });
  fModel.add(matState, 'wireframe').name('Alambre').onChange((on) => {
    for (const m of Object.values(whale.materials)) m.wireframe = on;
  });
  if (barbs) {
    fModel.add(matState, 'barbs').name('Pelos (barbs)').onChange((on) => {
      whale.meshes.forEach((mesh) => { if (mesh.material === barbs) mesh.visible = on; });
    });
  }

  // ------------------------------------------------------------------ iluminación
  const fLight = gui.addFolder('Iluminación');
  const lightState = {
    toneMapping: 'AgX',
    exposure: renderer.toneMappingExposure,
    environment: scene.environmentIntensity,
    background: `#${scene.background.getHexString()}`,
    sunIntensity: sun.intensity,
    sunColor: `#${sun.color.getHexString()}`,
    hemiIntensity: hemi.intensity,
  };
  fLight.add(lightState, 'toneMapping', Object.keys(TONE_MAPPINGS)).name('Tone mapping')
    .onChange((k) => { renderer.toneMapping = TONE_MAPPINGS[k]; });
  fLight.add(lightState, 'exposure', 0.1, 3, 0.01).name('Exposición').onChange((v) => { renderer.toneMappingExposure = v; });
  fLight.add(lightState, 'environment', 0, 2, 0.01).name('Luz de entorno').onChange((v) => { scene.environmentIntensity = v; });
  fLight.add(lightState, 'sunIntensity', 0, 8, 0.05).name('Sol · intensidad').onChange((v) => { sun.intensity = v; });
  fLight.addColor(lightState, 'sunColor').name('Sol · color').onChange((v) => sun.color.set(v));
  fLight.add(sunParams, 'elevation', -10, 90, 1).name('Sol · elevación (°)').onChange(updateSun);
  fLight.add(sunParams, 'azimuth', -180, 180, 1).name('Sol · azimut (°)').onChange(updateSun);
  fLight.add(lightState, 'hemiIntensity', 0, 3, 0.05).name('Hemisférica').onChange((v) => { hemi.intensity = v; });
  fLight.addColor(lightState, 'background').name('Fondo').onChange((v) => scene.background.set(v));

  // ------------------------------------------------------------------ ayudas
  const fHelp = gui.addFolder('Ayudas');
  const h = helpers.state;
  fHelp.add(h, 'grid').name('Rejilla (1 m)').onChange(helpers.apply);
  fHelp.add(h, 'gridHeight', -10, 5, 0.1).name('Altura rejilla (m)').onChange(helpers.apply);
  fHelp.add(h, 'axes').name('Ejes (3 m)').onChange(helpers.apply);
  fHelp.add(h, 'skeleton').name('Esqueleto').onChange(helpers.apply);
  fHelp.add(h, 'box').name('Caja envolvente').onChange(helpers.apply);
  fHelp.add(h, 'water').name('Plano de agua').onChange(helpers.apply);
  fHelp.add(h, 'waterLevel', -10, 10, 0.05).name('Nivel del agua (m)').onChange(helpers.apply);
  fHelp.add(h, 'waterOpacity', 0, 1, 0.01).name('Opacidad del agua').onChange(helpers.apply);
  fHelp.add(h, 'sunHelper').name('Dirección del sol').onChange(helpers.apply);
  fHelp.add(h, 'human').name('Persona 1,8 m').onChange(helpers.apply);
  const statsState = { visible: true };
  fHelp.add(statsState, 'visible').name('Estadísticas').onChange((v) => { stats.el.style.display = v ? '' : 'none'; });

  // ------------------------------------------------------------------ cámara
  const fCam = gui.addFolder('Cámara');
  const camState = { fov: camera.fov, autoRotate: false, rotateSpeed: 1 };
  const views = {};
  for (const [name, pos] of Object.entries(CAMERA_VIEWS)) {
    views[name] = () => {
      camera.position.set(...pos);
      controls.target.set(0, 0.4, 0);
      controls.update();
    };
    fCam.add(views, name).name(`Vista: ${name.toLowerCase()}`);
  }
  fCam.add(camState, 'fov', 10, 90, 1).name('Campo de visión (°)').onChange((v) => { camera.fov = v; camera.updateProjectionMatrix(); });
  fCam.add(camState, 'autoRotate').name('Girar sola').onChange((v) => { controls.autoRotate = v; });
  fCam.add(camState, 'rotateSpeed', 0.1, 10, 0.1).name('Velocidad de giro').onChange((v) => { controls.autoRotateSpeed = v; });

  // ------------------------------------------------------------------ guardar / restablecer
  const defaults = gui.save();
  const persist = {
    guardar() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(gui.save())); } catch { /* almacenamiento no disponible */ }
    },
    restablecer() {
      gui.load(defaults);
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* idem */ }
    },
  };
  gui.add(persist, 'guardar').name('Guardar ajustes');
  gui.add(persist, 'restablecer').name('Restablecer');
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) gui.load(JSON.parse(saved));
  } catch { /* sin ajustes guardados */ }
  updateTimeRange();

  fLight.close();
  fHelp.close();
  fCam.close();
  return gui;
}
