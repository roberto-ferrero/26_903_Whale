import * as THREE from 'three/webgpu';

export const CAMERA_MODES = ['Órbita libre', 'Seguimiento', 'Cinemática'];
export const RAILS = ['Director (cortes)', 'Barco', 'Aérea', 'Ras de agua', 'Bajo el agua'];
// plano que usa el director en cada estado de la ballena
const DIRECTOR = { nadar: 'Aérea', preparar: 'Bajo el agua', saltar: 'Barco', caer: 'Ras de agua', recuperar: 'Aérea' };

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
export function createCameras(viewer, getWhalePose, waterState, getWhaleState) {
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
  const blend = { t: 1, fromPos: new THREE.Vector3(), fromTarget: new THREE.Vector3() };
  const desiredPos = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();

  getWhalePose(smoothPos);
  lastSmooth.copy(smoothPos);
  controls.target.copy(smoothPos);

  function startBlend(duration = state.transition) {
    blend.t = duration > 0 ? 0 : 1;
    blend.duration = duration;
    blend.fromPos.copy(camera.position);
    blend.fromTarget.copy(controls.target);
  }

  function railPose(name, t, A, out, look) {
    const w = waterState.waterLevel;
    const f = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const r = new THREE.Vector3(f.z, 0, -f.x);
    look.copy(A);
    switch (name) {
      case 'Barco': // desde un barco a 30 m por el costado, moviéndose despacio
        out.copy(A).addScaledVector(r, 30).addScaledVector(f, -6 + 10 * Math.sin(t * 0.05)).setY(w + 2.5);
        look.y = Math.max(A.y, w - 2);
        break;
      case 'Aérea': // órbita alta alrededor de la ballena
        out.set(A.x + Math.cos(t * 0.12) * 38, w + 20, A.z + Math.sin(t * 0.12) * 38);
        break;
      case 'Ras de agua': // delante, casi tocando el agua
        out.copy(A).addScaledVector(f, 26).addScaledVector(r, 9 * Math.sin(t * 0.1)).setY(w + 0.4);
        look.y = Math.max(A.y, w);
        break;
      case 'Bajo el agua': // a un costado y por debajo de la superficie
        out.copy(A).addScaledVector(r, -15).addScaledVector(f, -5).setY(Math.min(w - 4, A.y + 1));
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
        if (shot === 'Director (cortes)') shot = DIRECTOR[getWhaleState()] ?? 'Aérea';
        if (shot !== currentShot) {
          if (currentShot) startBlend(state.rail === 'Director (cortes)' && state.hardCuts ? 0 : state.transition);
          currentShot = shot;
        }
        state.shot = shot;
        railPose(shot, railTime, smoothPos, desiredPos, desiredTarget);
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
