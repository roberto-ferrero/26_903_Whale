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
export function createGui({ viewer, whale, anim, lod, helpers, skeleton, anchor, breach, stats }) {
  const { renderer, scene, camera, controls, sun, sunParams, updateSun, hemi } = viewer;
  const gui = new GUI({ title: 'Ballena jorobada · visor' });

  // ------------------------------------------------------------------ animación
  const fAnim = gui.addFolder('Animación');
  fAnim.add(anim.state, 'clip', anim.names).name('Clip').listen().onChange((name) => anim.play(name));
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

  // ------------------------------------------------------------------ salto (secuencia de la Fase 1.7)
  const fBreach = gui.addFolder('Salto (secuencia)');
  const br = breach.state;
  const bp = breach.params;
  const breachActions = {
    iniciar() {
      helpers.state.water = true;
      helpers.apply();
      breach.start();
    },
    detener() { breach.stop(); },
    relanzar() { breach.restart(); },
    vista() {
      camera.position.set(34, 3, 2);
      controls.target.set(0, 1.5, 2);
      controls.update();
    },
  };
  fBreach.add(breachActions, 'iniciar').name('▶ Iniciar secuencia');
  fBreach.add(breachActions, 'detener').name('■ Detener');
  fBreach.add(breachActions, 'relanzar').name('↻ Relanzar ciclo');
  fBreach.add(breachActions, 'vista').name('Vista lateral del salto');
  fBreach.add(bp, 'repeat').name('Repetir').listen();
  fBreach.add(br, 'showPath').name('Ver trayectoria').onChange(breach.applyVisibility);
  fBreach.add(br, 'phase').name('Fase').listen().disable();
  fBreach.add(br, 'lastEvent').name('Último evento').listen().disable();
  fBreach.add(br, 'airTime').name('Tiempo en el aire').listen().disable();
  fBreach.add(br, 'apexHeight').name('Altura máxima').listen().disable();
  const fTraj = fBreach.addFolder('Trayectoria');
  const rebuild = () => breach.rebuild();
  fTraj.add(bp, 'depth', 3, 40, 0.5).name('Profundidad de nado (m)').onChange(rebuild);
  fTraj.add(bp, 'swimSpeed', 0.5, 5, 0.1).name('Velocidad de nado (m/s)').onChange(rebuild);
  fTraj.add(bp, 'swimTime', 0, 15, 0.5).name('Nado previo (s)').onChange(rebuild);
  fTraj.add(bp, 'ascentTime', 1.5, 12, 0.1).name('Duración ascenso (s)').onChange(rebuild);
  fTraj.add(bp, 'exitSpeed', 3, 14, 0.1).name('Velocidad de salida (m/s)').onChange(rebuild);
  fTraj.add(bp, 'exitAngle', 30, 89, 1).name('Ángulo de salida (°)').onChange(rebuild);
  fTraj.add(bp, 'roll', 0, 270, 5).name('Giro sobre su eje (°)').onChange(rebuild);
  fTraj.add(bp, 'rollSide', ['Derecha', 'Izquierda']).name('Sentido del giro').onChange(rebuild);
  fTraj.add(bp, 'landingPitch', -60, 30, 1).name('Inclinación al caer (°)').onChange(rebuild);
  fTraj.add(bp, 'submergeTime', 0.8, 6, 0.1).name('Duración inmersión (s)').onChange(rebuild);
  fTraj.add(bp, 'submergeDepth', 1, 15, 0.5).name('Profundidad tras impacto (m)').onChange(rebuild);
  fTraj.add(bp, 'recoverTime', 1, 15, 0.5).name('Duración recuperación (s)').onChange(rebuild);
  fTraj.close();

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
  fHelp.add(h, 'box').name('Caja envolvente').onChange(helpers.apply);
  fHelp.add(h, 'water').name('Plano de agua').onChange(helpers.apply);
  fHelp.add(h, 'waterLevel', -10, 10, 0.05).name('Nivel del agua (m)').onChange(helpers.apply);
  fHelp.add(h, 'waterOpacity', 0, 1, 0.01).name('Opacidad del agua').onChange(helpers.apply);
  fHelp.add(h, 'sunHelper').name('Dirección del sol').onChange(helpers.apply);
  fHelp.add(h, 'human').name('Persona 1,8 m').onChange(helpers.apply);
  const statsState = { visible: true };
  fHelp.add(statsState, 'visible').name('Estadísticas').onChange((v) => { stats.el.style.display = v ? '' : 'none'; });

  // ------------------------------------------------------------------ esqueleto
  const fSkel = gui.addFolder('Esqueleto');
  const sk = skeleton.state;
  fSkel.add(sk, 'lines').name('Líneas').onChange(skeleton.apply);
  fSkel.add(sk, 'joints').name('Articulaciones').onChange(skeleton.apply);
  fSkel.add(sk, 'jointSize', 0.02, 0.3, 0.01).name('Tamaño articulación (m)');
  fSkel.add(sk, 'axes').name('Ejes de cada hueso').onChange(skeleton.apply);
  fSkel.add(sk, 'axesSize', 0.05, 1, 0.05).name('Tamaño de ejes (m)').onChange(skeleton.apply);
  fSkel.add(sk, 'labels', skeleton.labelGroups).name('Nombres').onChange(skeleton.apply);
  fSkel.add(sk, 'bodyOpacity', 0.05, 1, 0.01).name('Opacidad del cuerpo').onChange(skeleton.apply);
  const fSel = fSkel.addFolder('Hueso seleccionado');
  fSel.add(sk, 'selected', skeleton.names).name('Hueso');
  fSel.add(sk, 'showSelected').name('Resaltar').onChange(skeleton.apply);
  fSel.add(sk.info, 'group').name('Grupo').listen().disable();
  fSel.add(sk.info, 'parent').name('Padre').listen().disable();
  fSel.add(sk.info, 'worldPos').name('Posición (mundo)').listen().disable();
  fSel.add(sk.info, 'localRot').name('Rotación local').listen().disable();

  // ------------------------------------------------------------------ punto de anclaje
  const fAnchor = gui.addFolder('Punto de anclaje');
  const an = anchor.state;
  fAnchor.add(an, 'bone', anchor.choices).name('Hueso de anclaje').onChange(() => anchor.clearTrail());
  fAnchor.add(an, 'marker').name('Marcador y ejes').onChange(anchor.apply);
  fAnchor.add(an, 'size', 0.05, 1, 0.01).name('Tamaño del marcador');
  fAnchor.add(an, 'trail').name('Estela').onChange((v) => { if (!v) anchor.clearTrail(); anchor.apply(); });
  fAnchor.add(an, 'trailLength', 50, 2000, 10).name('Longitud estela (puntos)');
  fAnchor.add({ clear: () => anchor.clearTrail() }, 'clear').name('Borrar estela');
  fAnchor.add(an, 'dropLine').name('Línea al agua').onChange(anchor.apply);
  fAnchor.add(an, 'follow').name('Cámara lo sigue');
  fAnchor.add({ focus: () => anchor.focus() }, 'focus').name('Centrar cámara aquí');
  fAnchor.add(an, 'position').name('Posición').listen().disable();
  fAnchor.add(an, 'heightOverWater').name('Altura sobre el agua').listen().disable();

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
  fSkel.close();
  fAnchor.close();
  fCam.close();
  return gui;
}
