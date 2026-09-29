import * as THREE from 'three/webgpu';

/**
 * Efecto 3D de «ventana» (paralaje por seguimiento de la cabeza), rama parallax, 29/09/2026.
 *
 * La pantalla se trata como una ventana física: la cámara frontal lee dónde está la cara del
 * espectador (MediaPipe Face Detector, en el navegador; el vídeo no sale del equipo) y el punto de
 * vista se mueve con ella, con una proyección descentrada (el frustum se inclina para que el borde
 * de la «ventana» quede fijo). El plano de la ventana se coloca algo más lejos que la ballena, así
 * que ella queda por delante del cristal y parece salir de la pantalla.
 *
 * Fuentes: cámara (cara), ratón o giroscopio (móvil). Desactivado por defecto: la cámara se pide
 * tras un clic (botón en el pie o en la GUI).
 *
 * Unidades: la cabeza se mide en cm respecto al centro de la pantalla; se pasa a la escena con la
 * escala «ancho de la pantalla física ↔ ancho de la ventana virtual» (así el efecto es realista).
 */
const MP_VERSION = '1.0.1';
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const IPD_CM = 6.3; // distancia media entre los ojos

export const PARALLAX_SOURCES = ['Cámara (cara)', 'Ratón', 'Giroscopio'];

export function createParallax({ camera, controls, canvas }) {
  const mobile = matchMedia('(pointer: coarse)').matches;
  const state = {
    enabled: false,
    source: 'Cámara (cara)',
    intensity: 1, // 1 = realista (ventana física)
    smoothing: 0.12, // s
    windowDepth: 1.25, // distancia a la ventana / distancia al objetivo (> 1: la ballena sale de la pantalla)
    screenWidth: Math.round((screen.width / 37.8) * 10) / 10 || 34, // cm (estimado; ajustable)
    viewDistance: mobile ? 32 : 60, // cm: distancia habitual a la pantalla
    cameraFov: mobile ? 70 : 60, // grados, horizontal de la cámara frontal (típico)
    cameraAbove: 1, // la cámara está en el borde superior (1) o en el centro (0) de la pantalla
    preview: false, // ver la imagen de la cámara (esquina)
    // lectura
    info: 'desactivado',
  };

  // cabeza: medida (cm, respecto al centro de la pantalla; z = distancia) y suavizada
  const measured = new THREE.Vector3(0, 0, state.viewDistance);
  const head = new THREE.Vector3(0, 0, state.viewDistance);
  let hasMeasure = false;

  // ------------------------------------------------------------------ cámara frontal
  let video = null, stream = null, detector = null, lastVideoTime = -1, starting = null;
  const previewEl = document.createElement('video');
  previewEl.className = 'parallax-preview';
  previewEl.muted = true;
  previewEl.playsInline = true;

  let loading = null;
  /** Descarga y crea el detector de caras (MediaPipe: WASM y modelo, ~3 MB); una sola vez. */
  function loadDetector() {
    loading ??= (async () => {
      const { FilesetResolver, FaceDetector } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
      detector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
      });
      return detector;
    })();
    loading.catch(() => { loading = null; });
    return loading;
  }

  async function startCamera() {
    if (detector && stream) return;
    if (starting) return starting;
    starting = (async () => {
      state.info = 'pidiendo permiso para la cámara…';
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      video = previewEl;
      video.srcObject = stream;
      await video.play();
      state.info = 'cargando el detector de caras…';
      await loadDetector();
      state.info = 'buscando la cara…';
      previewEl.style.display = state.preview ? '' : 'none';
    })();
    try { await starting; } catch (err) {
      console.warn('[parallax] cámara no disponible:', err);
      state.info = `sin cámara (${err.name ?? err.message}): se usa el ratón`;
      state.source = 'Ratón';
      stopCamera();
    } finally { starting = null; }
  }
  function stopCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) video.srcObject = null;
  }

  function readFace() {
    if (!detector || !video || video.readyState < 2) return;
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    const res = detector.detectForVideo(video, performance.now());
    const det = res.detections?.[0];
    if (!det || det.keypoints.length < 2) { state.info = 'no se ve ninguna cara'; return; }
    const [eR, eL] = det.keypoints; // ojo derecho e izquierdo (coordenadas normalizadas de la imagen)
    const mx = (eR.x + eL.x) / 2, my = (eR.y + eL.y) / 2;
    const aspect = video.videoWidth / Math.max(video.videoHeight, 1);
    const tanH = Math.tan(THREE.MathUtils.degToRad(state.cameraFov) / 2);
    const tanV = tanH / aspect;
    const ipd = Math.hypot(eR.x - eL.x, (eR.y - eL.y) / aspect); // en fracción del ancho
    const dist = IPD_CM / Math.max(ipd * 2 * tanH, 1e-3);
    // la imagen de la cámara frontal no está en espejo: si te mueves a tu derecha, apareces a la izquierda
    const x = (0.5 - mx) * 2 * tanH * dist;
    const screenH = state.screenWidth * (canvas.clientHeight / Math.max(canvas.clientWidth, 1));
    const y = (0.5 - my) * 2 * tanV * dist + state.cameraAbove * (screenH / 2 + 1);
    measured.set(x, y, THREE.MathUtils.clamp(dist, 15, 250));
    hasMeasure = true;
    state.info = `cara: ${x.toFixed(0)}, ${y.toFixed(0)} cm · a ${dist.toFixed(0)} cm`;
  }

  // ------------------------------------------------------------------ ratón y giroscopio
  const pointer = new THREE.Vector2();
  window.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  });
  const tilt = { beta0: null, gamma0: null, beta: 0, gamma: 0 };
  window.addEventListener('deviceorientation', (e) => {
    if (e.beta == null) return;
    if (tilt.beta0 === null) { tilt.beta0 = e.beta; tilt.gamma0 = e.gamma; }
    tilt.beta = e.beta; tilt.gamma = e.gamma;
  });
  async function startGyro() {
    // iOS: hay que pedir permiso tras un gesto del usuario
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      try { await DeviceOrientationEvent.requestPermission(); } catch { /* sin permiso */ }
    }
    tilt.beta0 = null;
  }

  function readOther() {
    const halfW = state.screenWidth / 2;
    if (state.source === 'Ratón') {
      // el ratón recorre el 60 % del ancho: en los bordes el cambio de punto de vista era excesivo
      measured.set(pointer.x * halfW * 0.6, pointer.y * halfW * 0.36, state.viewDistance);
      hasMeasure = true;
      state.info = 'ratón';
    } else if (state.source === 'Giroscopio') {
      if (tilt.beta0 === null) { state.info = 'sin giroscopio'; return; }
      // inclinar el móvil equivale a mover la cabeza al lado contrario
      const gx = THREE.MathUtils.clamp((tilt.gamma - tilt.gamma0) / 25, -1, 1);
      const gy = THREE.MathUtils.clamp((tilt.beta - tilt.beta0) / 25, -1, 1);
      measured.set(-gx * halfW, gy * halfW, state.viewDistance);
      hasMeasure = true;
      state.info = 'giroscopio';
    }
  }

  // ------------------------------------------------------------------ proyección descentrada
  // Va dentro de updateProjectionMatrix de la cámara: el TAA recalcula la proyección en cada
  // fotograma (jitter con setViewOffset) y borraría una matriz puesta a mano. Es la de three más
  // un escalado (la ventana está a D y el ojo a D + ez) y un desplazamiento (el ojo movido ex, ey).
  const off = { active: false, scale: 1, sx: 0, sy: 0 };
  camera.updateProjectionMatrix = function updateProjectionMatrix() {
    const near = this.near;
    let top = (near * Math.tan(THREE.MathUtils.DEG2RAD * 0.5 * this.fov)) / this.zoom;
    let height = 2 * top;
    let width = this.aspect * height;
    let left = -0.5 * width;
    const view = this.view;
    if (view !== null && view.enabled) {
      left += (view.offsetX * width) / view.fullWidth;
      top -= (view.offsetY * height) / view.fullHeight;
      width *= view.width / view.fullWidth;
      height *= view.height / view.fullHeight;
    }
    if (this.filmOffset !== 0) left += (near * this.filmOffset) / this.getFilmWidth();
    if (off.active) {
      left = left * off.scale - off.sx * near;
      top = top * off.scale - off.sy * near;
      width *= off.scale;
      height *= off.scale;
    }
    this.projectionMatrix.makePerspective(left, left + width, top, top - height, near, this.far, this.coordinateSystem, this.reversedDepth);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  };
  const saved = { pos: new THREE.Vector3(), active: false };
  const eye = new THREE.Vector3();
  let strength = 0; // 0-1: entra y sale suavemente al activar o desactivar

  function apply() {
    if (state.enabled && state.source === 'Cámara (cara)') startCamera();
    if (state.enabled && state.source === 'Giroscopio') startGyro();
    if (!state.enabled || state.source !== 'Cámara (cara)') { if (!starting) stopCamera(); }
    if (!state.enabled) state.info = 'desactivado';
    previewEl.style.display = state.enabled && state.preview && stream ? '' : 'none';
    if (state.preview && !previewEl.isConnected) document.body.appendChild(previewEl);
  }

  return {
    state,
    apply,
    /** Activa o desactiva (desde un clic: el navegador exige un gesto para pedir la cámara). */
    toggle(on = !state.enabled) { state.enabled = on; apply(); return on; },
    /**
     * Antes de dibujar: mueve el ojo según la cabeza y pone la proyección descentrada. Llamar después
     * de posicionar la cámara del fotograma; `end()` lo deshace después de dibujar.
     */
    begin(realDt) {
      strength += ((state.enabled ? 1 : 0) - strength) * Math.min(1, realDt * 3);
      if (strength < 1e-3) return;
      if (state.enabled) {
        if (state.source === 'Cámara (cara)') readFace(); else readOther();
      } else measured.set(0, 0, state.viewDistance);
      if (!hasMeasure) measured.set(0, 0, state.viewDistance);
      if (![measured.x, measured.y, measured.z].every(Number.isFinite)) measured.set(0, 0, state.viewDistance);
      head.lerp(measured, 1 - Math.exp(-realDt / Math.max(state.smoothing, 1e-3)));

      // ventana virtual: a windowDepth × la distancia al objetivo, con el tamaño que cubre el encuadre
      camera.updateMatrixWorld();
      const D = Math.max(camera.position.distanceTo(controls.target) * state.windowDepth, 1);
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const halfH = D * tanV, halfW = halfH * camera.aspect;
      // de cm a unidades de la escena (ancho físico ↔ ancho de la ventana) y la distancia igual
      const s = (halfW / (state.screenWidth / 2)) * state.intensity * strength;
      const ex = head.x * s, ey = head.y * s;
      const ez = (head.z - state.viewDistance) * (D / state.viewDistance) * state.intensity * strength;
      // ojo en el espacio de la cámara (la ventana queda fija en z = −D)
      eye.set(ex, ey, ez);
      saved.pos.copy(camera.position);
      camera.position.add(eye.applyQuaternion(camera.quaternion));
      camera.updateMatrixWorld();
      const dz = Math.max(D + ez, 1e-3);
      off.active = true;
      off.scale = D / dz; // la ventana (fija) se ve más grande o más pequeña según la distancia del ojo
      off.sx = ex / dz; off.sy = ey / dz; // y desplazada al contrario que el ojo
      camera.updateProjectionMatrix();
      saved.active = true;
    },
    /** Después de dibujar: devuelve la cámara a su pose y proyección normales. */
    end() {
      if (!saved.active) return;
      camera.position.copy(saved.pos);
      off.active = false;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      saved.active = false;
    },
    get active() { return strength > 1e-3; },
    loadDetector,
  };
}
