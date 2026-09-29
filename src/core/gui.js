import GUI from 'lil-gui';
import { CAMERA_MODES, RAILS } from './cameras.js';
import { BREATH_STYLES } from '../whale/breathPlanner.js';

/**
 * Panel lil-gui (Fase 2.2): una carpeta por módulo. Los estados de los módulos están registrados
 * en `params` (presets y URL); los cambios hechos en el panel se escriben en la URL.
 */
export function createGui(m) {
  const { clock, fsm, anim, lod, look, cameras, lighting, sky, clouds, ocean, water, under, post, sequence, audio, quality, recorder, fish, viewer, applySky, applyClouds, helpers, skeleton, anchor, debug, stats, params, presets, toggleHelpers } = m;
  const gui = new GUI({ title: 'Ballena jorobada' });

  // ------------------------------------------------------------------ tiempo (2.1)
  // ------------------------------------------------------------------ calidad (Fase 8.1)
  const fQ = gui.addFolder('Calidad');
  fQ.add(quality.state, 'profile', quality.levels).name('Perfil').onChange(() => quality.apply());
  fQ.add(quality.state, 'active').name('Nivel activo').listen().disable();
  fQ.add(quality.state, 'frameMs').name('Tiempo por fotograma').listen().disable();

  // ------------------------------------------------------------------ secuencia (Fase 7.1)
  const fSeq = gui.addFolder('Secuencia');
  const sq = sequence.state;
  const seqActions = {
    toggle: () => { sequence.toggle(); playCtl.name(sq.playing ? '■ Parar (P)' : '▶ Reproducir secuencia (P)'); },
    jump: () => sequence.jumpNow(),
    breathe: () => sequence.breatheNow(),
  };
  const playCtl = fSeq.add(seqActions, 'toggle').name('▶ Reproducir secuencia (P)');
  fSeq.add(seqActions, 'jump').name('Saltar ahora');
  fSeq.add(seqActions, 'breathe').name('Respirar ahora');
  fSeq.add(sq, 'phase').name('Fase').listen().disable();
  fSeq.add(sq, 'progress').name('Progreso').listen().disable();
  fSeq.add(sq, 'loop').name('Repetir');
  fSeq.add(sq, 'autoCamera').name('Cámaras automáticas');
  fSeq.add(sq, 'deepTime', 2, 60, 1).name('Nado profundo (s)');
  fSeq.add(sq, 'deepDepth', 6, 40, 1).name('Profundidad (m)');
  fSeq.add(sq, 'swimTime', 2, 60, 1).name('Nado entre respiraciones (s)');
  fSeq.add(sq, 'swimDepth', 2, 30, 0.5).name('Profundidad entre respiraciones (m)');
  fSeq.add(sq, 'surfaceTime', 2, 60, 1).name('Ondas y espuma (s)');
  fSeq.add(sq, 'surfaceDepth', 1, 10, 0.5).name('Nado en superficie (m)');

  // ------------------------------------------------------------------ grabar vídeo (Fase 8.4)
  const fRec = gui.addFolder('Grabar vídeo');
  const recActions = { toggle: () => { const on = recorder.toggle(); recCtl.name(on ? '■ Parar y descargar' : '● Grabar (WebM)'); } };
  const recCtl = fRec.add(recActions, 'toggle').name('● Grabar (WebM)');
  fRec.add(recorder.state, 'status').name('Estado').listen().disable();
  fRec.add(recorder.state, 'fps', [30, 60]).name('Fotogramas/s');
  fRec.add(recorder.state, 'bitrate', 5, 120, 1).name('Calidad (Mbit/s)');
  fRec.close();

  // ------------------------------------------------------------------ audio (Fase 7.4)
  const fAudio = gui.addFolder('Audio');
  const au = audio.state;
  const aa = () => audio.apply();
  fAudio.add(au, 'enabled').name('Sonido (clic para activar)').onChange(aa);
  fAudio.add(au, 'volume', 0, 1, 0.01).name('Volumen').onChange(aa);
  fAudio.add(au, 'ocean', 0, 2, 0.05).name('Oleaje');
  fAudio.add(au, 'effects', 0, 2, 0.05).name('Salto e impacto');
  fAudio.add(au, 'song', 0, 2, 0.05).name('Canto de ballena (bajo el agua)');

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
  fWhale.add({ breathe: () => fsm.breathe() }, 'breathe').name('● Respirar ahora (R)');
  fWhale.add(p, 'autoJump').name('Salto automático');
  fWhale.add(p, 'autoBreath').name('Respiración automática');
  fWhale.add(p, 'autoInterval', 1, 60, 0.5).name('Nadar entre acciones (s)');
  fWhale.add(p, 'blendTime', 0, 3, 0.05).name('Transición entre planes (s)');
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
  const fBreath = fWhale.addFolder('Respiración (próxima)');
  fBreath.add(p, 'breathStyle', BREATH_STYLES).name('Estilo');
  fBreath.add(p, 'breathAngle', 10, 60, 1).name('Inclinación al subir (°)');
  fBreath.add(p, 'arcTime', 2, 10, 0.1).name('Arco: duración (s)');
  fBreath.add(p, 'arcLead', 0, 35, 1).name('Arco: cabeza levantada (°)');
  fBreath.add(p, 'arcExit', 5, 45, 1).name('Arco: ángulo de salida (°)');
  fBreath.add(p, 'archFront', 0, 25, 1).name('Arco: flexión de la cabeza (°)');
  fBreath.add(p, 'archRear', 0, 35, 1).name('Arco: cola abajo (°)');
  fBreath.add(p, 'breathExposure', -0.3, 1, 0.05).name('Arco: asoma el espiráculo (m)');
  fBreath.add(p, 'blowLead', 0, 2, 0.05).name('Arco: exhala antes de asomar (s)');
  fBreath.add(p, 'breathSurfaceTime', 1.5, 12, 0.1).name('Superficie: tiempo (s)');
  fBreath.add(p, 'breathRootDepth', 0, 2, 0.05).name('Superficie: hundimiento (m)');
  fBreath.add(p, 'breathDiveAngle', 8, 45, 1).name('Inclinación al bajar (°)');
  fBreath.add(p, 'blowHeight', 1, 9, 0.1).name('Altura del soplido (m)');
  fBreath.add(p, 'blowAmount', 0, 3, 0.05).name('Cantidad de soplido');
  fBreath.add(p, 'surfaceStroke', 0.1, 1, 0.05).name('Aleteo junto a la superficie');
  fSwim.close();
  fTraj.close();
  fBreath.close();

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

  // ------------------------------------------------------------------ cielo (Fase 3)
  const fSky = gui.addFolder('Cielo · fecha, hora y lugar');
  const sk3 = sky.state;
  fSky.add(sk3, 'enabled').name('Cielo físico').onChange(applySky);
  fSky.add(sk3, 'place', sky.places).name('Lugar').listen().onChange(applySky);
  fSky.add(sk3, 'lat', -90, 90, 0.01).name('Latitud (°)').listen().onChange(() => { sk3.place = 'Personalizado'; applySky(); });
  fSky.add(sk3, 'lon', -180, 180, 0.01).name('Longitud (°)').listen().onChange(() => { sk3.place = 'Personalizado'; applySky(); });
  fSky.add(sk3, 'tz', -12, 14, 0.5).name('Zona horaria (UTC±h)').listen().onChange(() => { sk3.place = 'Personalizado'; applySky(); });
  fSky.add(sk3, 'date').name('Fecha (AAAA-MM-DD)').listen().onFinishChange(applySky);
  fSky.add(sk3, 'hour', 0, 23.99, 0.01).name('Hora local').listen();
  fSky.add(sk3, 'animate').name('Avanzar la hora');
  fSky.add(sk3, 'timeSpeed', 1, 3600, 1).name('Velocidad (× tiempo real)');
  fSky.add(sk3, 'localTime').name('Fecha y hora').listen().disable();
  fSky.add(sk3, 'sunAltAz').name('Sol').listen().disable();
  fSky.add(sk3, 'sunTimes').name('Salida / puesta').listen().disable();
  fSky.add(sk3, 'moonInfo').name('Luna').listen().disable();
  const fAtm = gui.addFolder('Cielo · atmósfera y luz');
  fAtm.add(sk3, 'model', sky.models).name('Modelo de cielo').onChange(applySky);
  fAtm.add(sk3, 'turbidity', 1, 20, 0.1).name('Turbidez (bruma)');
  fAtm.add(sk3, 'ozone', 0, 3, 0.05).name('Ozono (solo físico)');
  fAtm.add(sk3, 'multiScattering', 0, 3, 0.05).name('Dispersión múltiple (físico)');
  fAtm.add(sk3, 'rayleigh', 0, 4, 0.01).name('Rayleigh (azul)');
  fAtm.add(sk3, 'mieCoefficient', 0, 0.1, 0.001).name('Mie (halo)');
  fAtm.add(sk3, 'mieDirectionalG', 0, 0.999, 0.001).name('Mie · direccionalidad');
  fAtm.add(sk3, 'skyBrightness', 0.1, 4, 0.05).name('Brillo del cielo');
  fAtm.add(sk3, 'sunStrength', 0, 10, 0.05).name('Fuerza del sol');
  fAtm.add(sk3, 'ambientStrength', 0, 3, 0.05).name('Luz ambiente');
  fAtm.add(sk3, 'moonStrength', 0, 2, 0.05).name('Luz de luna');
  fAtm.add(sk3, 'stars', 0, 3, 0.05).name('Estrellas');
  fAtm.add(sk3, 'cloudLight', 0.1, 4, 0.05).name('Brillo de las nubes');
  fAtm.add(sk3, 'fogDensity', 0, 0.02, 0.0001).name('Bruma (perspectiva aérea)');
  fAtm.onFinishChange(() => sky.invalidateEnv()); // rehacer el entorno al soltar el control
  const fClouds = gui.addFolder('Nubes volumétricas');
  const cl = clouds.state;
  fClouds.add(cl, 'enabled').name('Nubes').onChange(applyClouds);
  fClouds.add(cl, 'coverage', 0, 1, 0.01).name('Cobertura').onChange(applyClouds);
  fClouds.add(cl, 'density', 0.002, 0.15, 0.001).name('Densidad').onChange(applyClouds);
  fClouds.add(cl, 'type', 0, 1, 0.01).name('Tipo (cúmulo - estrato)').onChange(applyClouds);
  fClouds.add(cl, 'base', 200, 6000, 50).name('Altitud de la base (m)').onChange(applyClouds);
  fClouds.add(cl, 'thickness', 100, 4000, 50).name('Grosor (m)').onChange(applyClouds);
  fClouds.add(cl, 'scale', 0.2, 4, 0.05).name('Tamaño de las formaciones').onChange(applyClouds);
  fClouds.add(cl, 'windSpeed', 0, 60, 0.5).name('Viento (m/s)');
  fClouds.add(cl, 'windDirection', 0, 360, 1).name('Viento hacia (° desde N)');
  fClouds.add(cl, 'shadows', 0, 1, 0.01).name('Sombras sobre el mar').onChange(applyClouds);
  fClouds.add(cl, 'resolution', 0.25, 1, 0.05).name('Resolución (fracción)').onChange(applyClouds);
  fClouds.add(cl, 'temporal').name('Acumulación temporal').onChange(applyClouds);
  fClouds.add(cl, 'steps', 8, 128, 1).name('Calidad (pasos)').onChange(applyClouds);
  fClouds.add(cl, 'lightSteps', 1, 12, 1).name('Pasos de luz').onChange(applyClouds);
  fClouds.add(cl, 'maxDistance', 2000, 80000, 500).name('Distancia máx. (m)').onChange(applyClouds);

  // ------------------------------------------------------------------ océano (Fase 4)
  const fOcean = gui.addFolder('Océano');
  const oc = ocean.state;
  const oa = () => ocean.apply();
  fOcean.add(oc, 'enabled').name('Océano').onChange(oa);
  fOcean.add(oc, 'mode', ocean.modes).name('Olas').onChange(oa);
  fOcean.add(oc, 'info').name('Estado del mar').listen().disable();
  fOcean.add(oc, 'level', -3, 3, 0.01).name('Nivel (m)').onChange(oa);
  fOcean.add(oc, 'choppiness', 0, 2, 0.01).name('Crestas afiladas (choppy)').onChange(oa);
  const fWind = fOcean.addFolder('FFT · mar de viento');
  fWind.add(oc, 'windSpeed', 0, 30, 0.1).name('Viento (m/s)').onFinishChange(oa);
  fWind.add(oc, 'windDirection', 0, 360, 1).name('Viento hacia (° desde N)').onFinishChange(oa);
  fWind.add(oc, 'fetch', 1, 1000, 1).name('Fetch (km)').onFinishChange(oa);
  fWind.add(oc, 'windAlign', 0.1, 4, 0.05).name('Alineación con el viento').onFinishChange(oa);
  fWind.add(oc, 'shortWaveCut', 0, 0.2, 0.005).name('Corte de ondas cortas (m)').onFinishChange(oa);
  fWind.add(oc, 'seed', 1, 100, 1).name('Semilla').onFinishChange(oa);
  const fSwell = fOcean.addFolder('FFT · mar de fondo (swell)');
  fSwell.add(oc, 'swellHeight', 0, 6, 0.05).name('Altura significativa (m)').onFinishChange(oa);
  fSwell.add(oc, 'swellPeriod', 4, 20, 0.1).name('Periodo (s)').onFinishChange(oa);
  fSwell.add(oc, 'swellDirection', 0, 360, 1).name('Hacia (° desde N)').onFinishChange(oa);
  fSwell.add(oc, 'swellSpread', 1, 100, 1).name('Concentración (s)').onFinishChange(oa);
  const fGer = fOcean.addFolder('Gerstner (prototipo)');
  fGer.add(oc, 'gAmplitude', 0, 3, 0.01).name('Amplitud (m)').onChange(oa);
  fGer.add(oc, 'gWavelength', 2, 200, 0.5).name('Longitud de onda (m)').onChange(oa);
  fGer.add(oc, 'gDirection', 0, 360, 1).name('Dirección (° desde N)').onChange(oa);
  fGer.add(oc, 'gSpread', 0, 90, 1).name('Dispersión (°)').onChange(oa);
  fGer.add(oc, 'gSteepness', 0, 1, 0.01).name('Afilado').onChange(oa);
  const fLook = fOcean.addFolder('Aspecto');
  fLook.add(oc, 'waterType', Object.keys(ocean.waterTypes)).name('Tipo de agua').onChange((t) => {
    Object.assign(oc, { scatterColor: ocean.waterTypes[t].scatter, clarity: ocean.waterTypes[t].clarity });
    oa();
    fLook.controllersRecursive().forEach((c) => c.updateDisplay());
  });
  fLook.addColor(oc, 'scatterColor').name('Color del agua (dispersión)').onChange(oa);
  fLook.add(oc, 'clarity', 1, 60, 0.5).name('Claridad (m)').onChange(oa);
  fLook.add(oc, 'sss', 0, 4, 0.05).name('Luz a través de las crestas').onChange(oa);
  fLook.add(oc, 'roughness', 0.01, 0.4, 0.005).name('Rugosidad').onChange(oa);
  fLook.add(oc, 'reflections', 0, 2, 0.01).name('Reflejo del cielo').onChange(oa);
  fLook.add(oc, 'foam', 0, 3, 0.05).name('Espuma').onChange(oa);
  fLook.add(oc, 'foamJacobian', 0, 1.2, 0.01).name('Umbral de espuma (jacobiano)').onChange(oa);
  fLook.add(oc, 'foamDecay', 0.05, 5, 0.05).name('Disipación de la espuma (1/s)').onChange(oa);
  fLook.add(oc, 'haze', 1, 80, 0.5).name('Visibilidad horizontal (km)').onChange(oa);
  fLook.add(oc, 'refraction').name('Refracción (ver bajo el agua)').onChange(oa);
  fOcean.add(oc, 'buoys').name('Boyas de prueba (altura en CPU)').onChange(oa);

  // ------------------------------------------------------------------ interacción con el agua (Fase 5)
  const fWater = gui.addFolder('Ballena ↔ agua');
  const wa = water.state;
  const wapply = () => water.apply();
  fWater.add(wa, 'enabled').name('Interacción').onChange(wapply);
  fWater.add(wa, 'info').name('Estado').listen().disable();
  fWater.add(wa, 'splashes').name('Salpicaduras').onChange(wapply);
  fWater.add(wa, 'density', 0, 3, 0.05).name('Cantidad de agua');
  fWater.add(wa, 'sizeScale', 0.3, 3, 0.05).name('Tamaño de las gotas');
  fWater.add(wa, 'brightness', 0.2, 3, 0.05).name('Brillo de las gotas');
  fWater.add(wa, 'curtains', 0, 3, 0.05).name('Cortinas (agua del cuerpo)');
  fWater.add(wa, 'bubbles', 0, 3, 0.05).name('Burbujas');
  fWater.add(wa, 'breathFoam', 0, 3, 0.05).name('Espuma al respirar');
  fWater.add(wa, 'waves', 0, 3, 0.05).name('Fuerza de las ondas');
  fWater.add(wa, 'rippleSpeed', 1, 10, 0.1).name('Velocidad de las ondas (m/s)');
  fWater.add(wa, 'wake', 0, 3, 0.05).name('Estela');
  fWater.add(wa, 'foamLife', 2, 90, 1).name('Duración de la espuma (s)');
  fWater.add(wa, 'dynamicWet').name('Piel mojada automática');
  fWater.add(wa, 'showProbes').name('Ver sondas').onChange(wapply);

  // ------------------------------------------------------------------ posprocesado (Fase 7.3)
  const fPost = gui.addFolder('Posprocesado');
  const ps = post.state;
  const pa = () => post.apply();
  fPost.add(ps, 'enabled').name('Posprocesado').onChange(pa);
  fPost.add(ps, 'aa', post.aaModes).name('Antialiasing').onChange(pa);
  fPost.add(ps, 'bloom').name('Bloom').onChange(pa);
  fPost.add(ps, 'bloomStrength', 0, 2, 0.01).name('Bloom: intensidad').onChange(pa);
  fPost.add(ps, 'bloomThreshold', 0, 4, 0.05).name('Bloom: umbral').onChange(pa);
  fPost.add(ps, 'bloomRadius', 0, 1, 0.01).name('Bloom: radio').onChange(pa);
  fPost.add(ps, 'dof').name('Profundidad de campo').onChange(pa);
  fPost.add(ps, 'autoFocus').name('Enfoque en la ballena').onChange(pa);
  fPost.add(ps, 'focusDistance', 1, 200, 0.5).name('Distancia de enfoque (m)').onChange(pa);
  fPost.add(ps, 'focalRange', 1, 150, 1).name('Zona enfocada (m)').onChange(pa);
  fPost.add(ps, 'bokeh', 0, 5, 0.05).name('Bokeh').onChange(pa);
  fPost.add(ps, 'motionBlur').name('Motion blur').onChange(pa);
  fPost.add(ps, 'motionBlurAmount', 0, 2, 0.05).name('Motion blur: obturador').onChange(pa);
  fPost.add(ps, 'exposure', -3, 3, 0.05).name('Exposición (EV)').onChange(pa);
  fPost.add(ps, 'contrast', 0.5, 1.6, 0.01).name('Contraste').onChange(pa);
  fPost.add(ps, 'saturation', 0, 2, 0.01).name('Saturación').onChange(pa);
  fPost.add(ps, 'temperature', -1, 1, 0.01).name('Temperatura (frío - cálido)').onChange(pa);
  fPost.add(ps, 'vignette', 0, 1, 0.01).name('Viñeta').onChange(pa);
  fPost.add(ps, 'grain', 0, 0.4, 0.005).name('Grano').onChange(pa);

  // ------------------------------------------------------------------ peces
  const fFish = gui.addFolder('Peces');
  const fs = fish.state;
  fFish.add(fs, 'enabled').name('Peces').onChange(() => fish.apply());
  fFish.add(fs, 'info').name('Estado').listen().disable();
  fFish.add(fs, 'schoolCount', 0, 1200, 10).name('Peces en el cardumen');
  fFish.add(fs, 'schoolSize', 0.08, 0.5, 0.01).name('Tamaño (m)');
  fFish.add(fs, 'schoolSpeed', 0.3, 4, 0.05).name('Velocidad (m/s)');
  fFish.add(fs, 'schoolDepth', 2, 25, 0.5).name('Profundidad mínima (m)');
  fFish.add(fs, 'schoolDistance', 4, 30, 0.5).name('Distancia a la cámara (m)');
  fFish.add(fs, 'separation', 0, 4, 0.05).name('Separación');
  fFish.add(fs, 'alignment', 0, 4, 0.05).name('Alineación');
  fFish.add(fs, 'cohesion', 0, 4, 0.05).name('Cohesión');
  fFish.add(fs, 'flee', 0, 4, 0.05).name('Huida de la ballena');

  // ------------------------------------------------------------------ bajo el agua (Fase 6)
  const fUnder = gui.addFolder('Bajo el agua');
  const us = under.state;
  const ua = () => under.apply();
  fUnder.add(us, 'enabled').name('Efectos bajo el agua').onChange(ua);
  fUnder.add(us, 'info').name('Cámara').listen().disable();
  fUnder.add(us, 'godRays', 0, 8, 0.05).name('God rays').onChange(ua);
  fUnder.add(us, 'steps', 2, 48, 1).name('Pasos (god rays)').onChange(ua);
  fUnder.add(us, 'rayClouds', 0, 1, 0.01).name('Las nubes apagan los haces').onChange(ua);
  fUnder.add(us, 'scattering', 0, 4, 0.05).name('Turbidez (dispersión)').onChange(ua);
  fUnder.add(us, 'caustics', 0, 3, 0.05).name('Cáusticas (ballena y partículas)').onChange(ua);
  fUnder.add(us, 'causticSharpness', 0, 1, 0.01).name('Nitidez de las cáusticas').onChange(ua);
  fUnder.add(us, 'surfaceCaustics', 0, 3, 0.05).name('Brillo de la superficie (desde abajo)').onChange(ua);
  fUnder.add(us, 'snow', 0, 3, 0.05).name('Partículas en suspensión');
  fUnder.add(us, 'distortion', 0, 4, 0.05).name('Distorsión').onChange(ua);
  fUnder.add(us, 'chroma', 0, 4, 0.05).name('Aberración cromática').onChange(ua);
  fUnder.add(us, 'blur', 0, 4, 0.05).name('Desenfoque lejano').onChange(ua);
  fUnder.add(us, 'vignette', 0, 1, 0.01).name('Viñeta').onChange(ua);
  fUnder.add(us, 'lensDrops').name('Gotas en la lente al salir');

  // ------------------------------------------------------------------ iluminación y ambiente
  const fLight = gui.addFolder('Iluminación (sin cielo: manual)');
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
  fHelp.add({ toggle: () => toggleHelpers() }, 'toggle').name('Ayudas de depuración (B)');

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
  fDebug.add(stats.state, 'visible').name('Estadísticas').listen().onChange(() => stats.apply());

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

  for (const f of [fAnim, fModel, fAtm, fClouds, fLight, fHelp, fSkel, fAnchor, fDebug]) f.close();
  gui.close(); // por defecto, replegado (29/09/2026)
  return gui;
}
