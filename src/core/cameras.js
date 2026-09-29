import * as THREE from 'three/webgpu';

export const CAMERA_MODES = ['Órbita libre', 'Seguimiento', 'Cinemática'];
export const RAILS = ['Director (cortes)', 'Barco', 'Aérea', 'Ras de agua', 'Bajo el agua', 'Hacia la luz (desde abajo)', 'Cruce de superficie', 'Soplido (cerca)'];
// plano que usa el director en cada estado de la ballena (Fase 7.2); la secuencia puede sustituirlo
const DIRECTOR = {
  nadar: 'Aérea', preparar: 'Hacia la luz (desde abajo)', saltar: 'Barco', caer: 'Ras de agua', recuperar: 'Cruce de superficie',
  subir: 'Hacia la luz (desde abajo)', respirar: 'Soplido (cerca)', bajar: 'Cruce de superficie',
};

const VIEWS = {
  'Tres cuartos': [16, 5, 12], Lateral: [22, 0.4, 0], Frontal: [0, 1, 20], Superior: [0, 26, 0.01],
  Inferior: [0, -24, 0.01], Cabeza: [6, 2, 10], Cola: [5, 2, -12],
};

const smoothstep = (x) => x * x * (3 - 2 * x);

/**
 * Cámaras (Fase 2.3):
 * - **Órbita libre**: OrbitControls sobre un punto fijo.
 * - **Seguimiento**: órbita alrededor de la ballena; cámara y objetivo la acompañan (suavizado).
 * - **Cinemática**: raíles relativos a la ballena (barco, aérea, a ras de agua, bajo el agua) o un
 *   director que cambia de plano según el estado de la ballena.
 * Cualquier cambio de modo o de plano se hace con una transición suave (o corte seco).
 */
export function createCameras(viewer, getWhalePose, waterState, getWhaleState, getWaterHeight = null) {
  const { camera, controls } = viewer;
  const state = {
    mode: 'Seguimiento',
    rail: 'Director (cortes)',
    transition: 1.5, // s
    hardCuts: false, // el director corta en seco
    followSmoothing: 4, // 1/s
    railSpeed: 1,
    fov: camera.fov,
    autoRotate: false,
    rotateSpeed: 1,
    // lectura
    shot: '',
  };

  const whalePos = new THREE.Vector3();
  const smoothPos = new THREE.Vector3();
  const lastSmooth = new THREE.Vector3();
  let heading = 0;
  let railTime = 0;
  let currentShot = '';
  let shotStart = 0; // railTime al empezar el plano actual (travellings)
  let director = null; // (estado) → plano, o null para el director por defecto
  const blend = { t: 1, fromPos: new THREE.Vector3(), fromTarget: new THREE.Vector3() };
  const desiredPos = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();

  getWhalePose(smoothPos);
  lastSmooth.copy(smoothPos);
  controls.target.copy(smoothPos);

  let cutFlag = false; // corte seco en este fotograma (el motion blur lo ignora)
  function startBlend(duration = state.transition) {
    if (duration <= 0) cutFlag = true;
    blend.t = duration > 0 ? 0 : 1;
    blend.duration = duration;
    blend.fromPos.copy(camera.position);
    blend.fromTarget.copy(controls.target);
  }

  function railPose(name, t, A, out, look, tShot = 0) {
    const w = waterState.waterLevel;
    const f = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const r = new THREE.Vector3(f.z, 0, -f.x);
    look.copy(A);
    switch (name) {
      case 'Barco': // desde un barco a 30 m por el costado, moviéndose despacio (sube y baja con las olas)
        out.copy(A).addScaledVector(r, 30).addScaledVector(f, -6 + 10 * Math.sin(t * 0.05));
        out.y = (getWaterHeight ? getWaterHeight(out.x, out.z) : w) + 2.5;
        look.y = Math.max(A.y, w - 2);
        break;
      case 'Aérea': // órbita alta alrededor de la ballena
        out.set(A.x + Math.cos(t * 0.12) * 38, w + 20, A.z + Math.sin(t * 0.12) * 38);
        break;
      case 'Ras de agua': // delante, casi tocando el agua
        out.copy(A).addScaledVector(f, 26).addScaledVector(r, 9 * Math.sin(t * 0.1));
        out.y = Math.max(w + 0.6, (getWaterHeight ? getWaterHeight(out.x, out.z) : w) + 0.9); // siempre sobre la ola
        look.y = Math.max(A.y, w);
        break;
      case 'Bajo el agua': // a un costado y por debajo de la superficie
        out.copy(A).addScaledVector(r, -15).addScaledVector(f, -5).setY(Math.min(w - 4, A.y + 1));
        break;
      case 'Hacia la luz (desde abajo)': // por debajo y delante: la ballena sube hacia la superficie
        out.copy(A).addScaledVector(r, -10).addScaledVector(f, 7).setY(Math.min(A.y - 6, w - 4));
        look.copy(A).addScaledVector(f, 4).setY(Math.min(A.y + 4, w));
        break;
      case 'Cruce de superficie': // travelling: baja de encima del agua a debajo junto al impacto
        out.copy(A).addScaledVector(r, 14).addScaledVector(f, 3)
          .setY(w + 1.4 - 4.6 * smoothstep(Math.min(Math.max((tShot - 1) / 5, 0), 1)));
        look.copy(A).setY(Math.max(A.y, w - 3));
        break;
      case 'Soplido (cerca)': // respiración: de lado y algo por delante, a 2 m del agua; encuadra lomo y soplido
        out.copy(A).addScaledVector(r, 17).addScaledVector(f, 6 + 0.6 * tShot);
        out.y = Math.max(w + 1.2, (getWaterHeight ? getWaterHeight(out.x, out.z) : w) + 2);
        look.copy(A).addScaledVector(f, 2).setY(w + 1.6);
        break;
      default:
        out.copy(A).add(new THREE.Vector3(16, 5, 12));
    }
  }

  function apply() {
    camera.fov = state.fov;
    camera.updateProjectionMatrix();
    controls.autoRotate = state.autoRotate;
    controls.autoRotateSpeed = state.rotateSpeed;
    controls.enabled = state.mode !== 'Cinemática';
    currentShot = '';
    if (state.mode === 'Órbita libre') blend.t = 1; // se queda donde está
    else startBlend();
  }
  apply();

  return {
    state,
    views: Object.keys(VIEWS),
    apply,
    /** true durante el fotograma de un corte seco (lo lee el posprocesado y lo limpia). */
    consumeCut() { const c = cutFlag; cutFlag = false; return c; },
    /** Sustituye el director (estado de la ballena → plano); null = el de por defecto. */
    setDirector(fn) { director = fn; currentShot = ''; },
    /** Encuadre predefinido alrededor de la ballena (pasa a órbita libre). */
    setView(name) {
      state.mode = 'Órbita libre';
      apply();
      getWhalePose(whalePos);
      desiredTarget.copy(whalePos);
      desiredPos.copy(whalePos).add(new THREE.Vector3(...VIEWS[name]));
      startBlend();
      blend.toPos = desiredPos.clone();
      blend.toTarget = desiredTarget.clone();
    },
    /**
     * @param {number} realDt tiempo real (suavizados y transiciones)
     * @param {number} simDt  tiempo simulado (avance de los raíles)
     */
    update(realDt, simDt) {
      heading = getWhalePose(whalePos);
      smoothPos.lerp(whalePos, 1 - Math.exp(-state.followSmoothing * realDt));
      railTime += simDt * state.railSpeed;

      if (state.mode === 'Seguimiento') {
        // la cámara y el objetivo se desplazan con la ballena; el usuario puede orbitar a la vez
        const delta = smoothPos.clone().sub(lastSmooth);
        camera.position.add(delta);
        controls.target.add(delta);
        if (blend.t < 1) {
          desiredTarget.copy(smoothPos);
          desiredPos.copy(blend.fromPos).add(delta);
        }
      } else if (state.mode === 'Cinemática') {
        let shot = state.rail;
        if (shot === 'Director (cortes)') shot = director?.(getWhaleState()) ?? DIRECTOR[getWhaleState()] ?? 'Aérea';
        if (shot !== currentShot) {
          if (currentShot) startBlend(state.rail === 'Director (cortes)' && state.hardCuts ? 0 : state.transition);
          else cutFlag = true;
          currentShot = shot;
          shotStart = railTime;
        }
        state.shot = shot;
        railPose(shot, railTime, smoothPos, desiredPos, desiredTarget, railTime - shotStart);
        if (blend.t >= 1) {
          camera.position.copy(desiredPos);
          controls.target.copy(desiredTarget);
        }
      }

      // transición suave entre la pose de partida y la deseada
      if (blend.t < 1) {
        blend.t = Math.min(1, blend.t + realDt / Math.max(blend.duration, 1e-3));
        const k = smoothstep(blend.t);
        const toPos = blend.toPos ?? desiredPos;
        const toTarget = blend.toTarget ?? (state.mode === 'Órbita libre' ? blend.fromTarget : desiredTarget);
        if (state.mode === 'Seguimiento' && !blend.toPos) {
          controls.target.lerpVectors(blend.fromTarget, smoothPos, k);
        } else {
          camera.position.lerpVectors(blend.fromPos, toPos, k);
          controls.target.lerpVectors(blend.fromTarget, toTarget, k);
        }
        if (blend.t >= 1) { blend.toPos = null; blend.toTarget = null; }
      }
      if (state.mode !== 'Cinemática') state.shot = state.mode;
      lastSmooth.copy(smoothPos);
      if (controls.enabled) controls.update(realDt);
      else camera.lookAt(controls.target);
    },
  };
}
