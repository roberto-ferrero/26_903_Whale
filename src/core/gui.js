import GUI from 'lil-gui';
import { CAMERA_MODES, RAILS } from './cameras.js';

/**
 * Panel lil-gui (Fase 2.2): una carpeta por módulo. Los estados de los módulos están registrados
 * en `params` (presets y URL); los cambios hechos en el panel se escriben en la URL.
 */
export function createGui(m) {
  const { clock, fsm, anim, lod, look, cameras, lighting, helpers, skeleton, anchor, debug, stats, params, presets } = m;
  const gui = new GUI({ title: 'Ballena jorobada' });

  // ------------------------------------------------------------------ tiempo (2.1)
  const fTime = gui.addFolder('Tiempo');
  fTime.add(clock.state, 'paused').name('Pausa (espacio)').listen();
  fTime.add(clock.state, 'timeScale', 0, 3, 0.05).name('Velocidad (cámara lenta < 1)');
  fTime.add({ step: () => clock.step() }, 'step').name('Avanzar un fotograma (.)');
  fTime.add(clock.state, 'stepSize', 1 / 120, 0.2, 1 / 120).name('Paso (s)');
  fTime.add(clock.state, 'time').name('Tiempo simulado (s)').listen().disable();

  // ------------------------------------------------------------------ comportamiento (2.4)
  const fWhale = gui.addFolder('Ballena · comportamiento');
  const p = fsm.params;
  fWhale.add(p, 'enabled').name('Máquina de estados').onChange((v) => fsm.setEnabled(v));
  fWhale.add({ jump: () => fsm.jump() }, 'jump').name('▲ Saltar ahora (J)');
  fWhale.add(p, 'autoJump').name('Salto automático');
  fWhale.add(p, 'autoInterval', 1, 60, 0.5).name('Nadar antes de saltar (s)');
  fWhale.add(fsm.state, 'label').name('Estado').listen().disable();
  fWhale.add(fsm.state, 'lastEvent').name('Último evento').listen().disable();
  fWhale.add(fsm.state, 'airTime').name('Tiempo en el aire').listen().disable();
  fWhale.add(fsm.state, 'apexHeight').name('Altura máxima').listen().disable();
  fWhale.add(p, 'showPath').name('Ver trayectoria del salto').onChange(() => fsm.apply());
  const fSwim = fWhale.addFolder('Nado');
  fSwim.add(p, 'depth', 3, 40, 0.5).name('Profundidad (m)');
  fSwim.add(p, 'swimSpeed', 0.5, 5, 0.1).name('Velocidad (m/s)');
  fSwim.add(p, 'wander', 0, 0.5, 0.01).name('Deriva del rumbo (rad/s)');
  fSwim.add(p, 'radius', 10, 200, 1).name('Radio de vuelta al centro (m)');
  const fTraj = fWhale.addFolder('Salto (próximo)');
  fTraj.add(p, 'ascentTime', 1.5, 12, 0.1).name('Duración ascenso (s)');
  fTraj.add(p, 'exitSpeed', 3, 14, 0.1).name('Velocidad de salida (m/s)');
  fTraj.add(p, 'exitAngle', 30, 89, 1).name('Ángulo de salida (°)');
  fTraj.add(p, 'roll', 0, 270, 5).name('Giro sobre su eje (°)');
  fTraj.add(p, 'rollSide', ['Derecha', 'Izquierda']).name('Sentido del giro');
  fTraj.add(p, 'landingPitch', -60, 30, 1).name('Inclinación al caer (°)');
  fTraj.add(p, 'submergeTime', 0.8, 6, 0.1).name('Duración inmersión (s)');
  fTraj.add(p, 'submergeDepth', 1, 15, 0.5).name('Profundidad tras impacto (m)');
  fTraj.add(p, 'recoverTime', 1, 15, 0.5).name('Duración recuperación (s)');
  fSwim.close();
  fTraj.close();

  // ------------------------------------------------------------------ animación (modo libre)
  const fAnim = gui.addFolder('Animación (modo libre)');
  fAnim.add(anim.state, 'clip', anim.names).name('Clip').listen().onChange((name) => anim.play(name));
  fAnim.add(anim.state, 'loop').name('Bucle').onChange(() => anim.applyLoop());
  fAnim.add(anim.state, 'fade', 0, 2, 0.05).name('Fundido (s)');
  const timeCtrl = fAnim.add(anim.state, 'time', 0, 6, 0.01).name('Tiempo del clip (s)').listen()
    .onChange((t) => { clock.state.paused = true; anim.seek(t); });
  const updateTimeRange = () => timeCtrl.max(Math.max(anim.state.duration, 0.01)).updateDisplay();
  fAnim.controllers[0].onFinishChange(updateTimeRange);
  fAnim.add({ rest: () => anim.restPose() }, 'rest').name('Pose de reposo');
  updateTimeRange();

  // ------------------------------------------------------------------ cámara (2.3)
  const fCam = gui.addFolder('Cámara');
  const c = cameras.state;
  fCam.add(c, 'mode', CAMERA_MODES).name('Modo (C)').listen().onChange(cameras.apply);
  fCam.add(c, 'rail', RAILS).name('Plano cinemático').onChange(cameras.apply);
  fCam.add(c, 'shot').name('Plano actual').listen().disable();
  fCam.add(c, 'transition', 0, 5, 0.1).name('Transición (s)');
  fCam.add(c, 'hardCuts').name('Director: cortes secos');
  fCam.add(c, 'followSmoothing', 0.5, 15, 0.5).name('Suavizado seguimiento');
  fCam.add(c, 'railSpeed', 0, 4, 0.1).name('Velocidad de los raíles');
  fCam.add(c, 'fov', 10, 90, 1).name('Campo de visión (°)').onChange(cameras.apply);
  fCam.add(c, 'autoRotate').name('Girar sola (órbita)').onChange(cameras.apply);
  fCam.add(c, 'rotateSpeed', 0.1, 10, 0.1).name('Velocidad de giro').onChange(cameras.apply);
  const fViews = fCam.addFolder('Vistas (órbita)');
  const views = {};
  for (const name of cameras.views) {
    views[name] = () => cameras.setView(name);
    fViews.add(views, name).name(name);
  }
  fViews.close();

  // ------------------------------------------------------------------ modelo
  const fModel = gui.addFolder('Modelo');
  fModel.add(lod.state, 'mode', ['Auto', 'LOD0', 'LOD1', 'LOD2']).name('LOD');
  fModel.add(lod.state, 'dist1', 5, 200, 1).name('Distancia LOD1 (m)');
  fModel.add(lod.state, 'dist2', 10, 500, 1).name('Distancia LOD2 (m)');
  const L = look.state;
  fModel.add(L, 'wetness', 0, 1, 0.01).name('Mojado').onChange(look.apply);
  fModel.add(L, 'wetDarken', 0, 0.4, 0.01).name('Oscurecer al mojar').onChange(look.apply);
  fModel.add(L, 'normalMap').name('Normal map').onChange(look.apply);
  fModel.add(L, 'normalScale', 0, 3, 0.05).name('Intensidad normal').onChange(look.apply);
  fModel.add(L, 'aoIntensity', 0, 2, 0.05).name('Intensidad AO').onChange(look.apply);
  fModel.add(L, 'wireframe').name('Alambre').onChange(look.apply);
  fModel.add(L, 'barbs').name('Pelos (barbs)').onChange(look.apply);

  // ------------------------------------------------------------------ iluminación y ambiente
  const fLight = gui.addFolder('Iluminación y ambiente');
  const li = lighting.state;
  fLight.add(li, 'toneMapping', lighting.toneMappings).name('Tone mapping').onChange(lighting.apply);
  fLight.add(li, 'exposure', 0.1, 3, 0.01).name('Exposición').onChange(lighting.apply);
  fLight.add(li, 'environment', 0, 2, 0.01).name('Luz de entorno').onChange(lighting.apply);
  fLight.add(li, 'sunIntensity', 0, 8, 0.05).name('Sol · intensidad').onChange(lighting.apply);
  fLight.addColor(li, 'sunColor').name('Sol · color').onChange(lighting.apply);
  fLight.add(li, 'sunElevation', -10, 90, 1).name('Sol · elevación (°)').onChange(lighting.apply);
  fLight.add(li, 'sunAzimuth', -180, 180, 1).name('Sol · azimut (°)').onChange(lighting.apply);
  fLight.add(li, 'hemiIntensity', 0, 3, 0.05).name('Hemisférica').onChange(lighting.apply);
  fLight.addColor(li, 'background').name('Fondo y niebla').onChange(lighting.apply);
  fLight.add(li, 'fog').name('Niebla').onChange(lighting.apply);
  fLight.add(li, 'fogNear', 0, 500, 5).name('Niebla desde (m)').onChange(lighting.apply);
  fLight.add(li, 'fogFar', 10, 2000, 10).name('Niebla hasta (m)').onChange(lighting.apply);

  // ------------------------------------------------------------------ ayudas
  const fHelp = gui.addFolder('Ayudas');
  const h = helpers.state;
  fHelp.add(h, 'water').name('Plano de agua').onChange(helpers.apply);
  fHelp.add(h, 'waterLevel', -10, 10, 0.05).name('Nivel del agua (m)').onChange(helpers.apply);
  fHelp.add(h, 'waterOpacity', 0, 1, 0.01).name('Opacidad del agua').onChange(helpers.apply);
  fHelp.addColor(h, 'waterColor').name('Color del agua').onChange(helpers.apply);
  fHelp.add(h, 'grid').name('Rejilla (1 m)').onChange(helpers.apply);
  fHelp.add(h, 'gridHeight', -60, 5, 0.5).name('Altura rejilla (m)').onChange(helpers.apply);
  fHelp.add(h, 'axes').name('Ejes (3 m)').onChange(helpers.apply);
  fHelp.add(h, 'box').name('Caja envolvente').onChange(helpers.apply);
  fHelp.add(h, 'sunHelper').name('Dirección del sol').onChange(helpers.apply);
  fHelp.add(h, 'human').name('Persona 1,8 m (en el agua)').onChange(helpers.apply);

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
  fAnchor.add(an, 'position').name('Posición').listen().disable();
  fAnchor.add(an, 'heightOverWater').name('Altura sobre el agua').listen().disable();

  // ------------------------------------------------------------------ depuración (2.5)
  const fDebug = gui.addFolder('Depuración');
  fDebug.add(debug.state, 'view', debug.views).name('Vista de buffer').onChange(debug.apply);
  fDebug.add(debug.state, 'depthRange', 5, 300, 1).name('Rango profundidad (m)').onChange(debug.apply);
  fDebug.add(debug.state, 'timeline').name('Línea de tiempo').onChange(debug.apply);
  const statsState = { visible: true };
  fDebug.add(statsState, 'visible').name('Estadísticas').onChange((v) => { stats.el.style.display = v ? '' : 'none'; });

  // ------------------------------------------------------------------ presets y URL (2.2)
  const fPresets = gui.addFolder('Presets y URL');
  const presetState = { preset: presets[0]?.nombre ?? '', autoURL: true };
  const byName = Object.fromEntries(presets.map((pr) => [pr.nombre, pr]));
  const presetInfo = { descripcion: presets[0]?.descripcion ?? '' };
  fPresets.add(presetState, 'preset', Object.keys(byName)).name('Preset').onChange((n) => { presetInfo.descripcion = byName[n].descripcion; });
  fPresets.add(presetInfo, 'descripcion').name('Descripción').listen().disable();
  fPresets.add({
    aplicar() {
      params.reset();
      params.apply(byName[presetState.preset].valores);
      if (presetState.autoURL) params.writeURL();
    },
  }, 'aplicar').name('Aplicar preset');
  fPresets.add(presetState, 'autoURL').name('Guardar cambios en la URL');
  fPresets.add({
    async copiar() {
      const url = params.shareURL();
      try { await navigator.clipboard.writeText(url); } catch { window.prompt('Copia este enlace:', url); }
    },
  }, 'copiar').name('Copiar enlace con los ajustes');
  fPresets.add({
    exportar() {
      const nombre = window.prompt('Nombre del preset:', 'Mi preset');
      if (!nombre) return;
      const blob = new Blob([JSON.stringify(params.toPreset(nombre), null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${nombre.replace(/\W+/g, '_')}.json` });
      a.click();
      URL.revokeObjectURL(a.href);
    },
  }, 'exportar').name('Exportar preset (JSON)');
  fPresets.add({
    restablecer() {
      params.reset();
      params.writeURL();
    },
  }, 'restablecer').name('Restablecer todo');

  // los cambios del panel se guardan en la URL; al aplicar presets o la URL se refresca el panel
  gui.onFinishChange(() => { if (presetState.autoURL) params.writeURL(); });
  params.onChange(() => { gui.controllersRecursive().forEach((ctrl) => ctrl.updateDisplay()); updateTimeRange(); });

  for (const f of [fAnim, fModel, fLight, fHelp, fSkel, fAnchor, fDebug]) f.close();
  return gui;
}
