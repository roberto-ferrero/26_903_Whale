import * as THREE from 'three/webgpu';

const G = 9.81;
const DEG = THREE.MathUtils.DEG2RAD;
const smooth = (e0, e1, x) => { const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const lerp = THREE.MathUtils.lerp;

// Hermite cúbica entre p0 y p1 con tangentes m0 y m1 (ya multiplicadas por la duración)
function hermite(p0, m0, p1, m1, u, out) {
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return out.set(0, 0, 0).addScaledVector(p0, h00).addScaledVector(m0, h10).addScaledVector(p1, h01).addScaledVector(m1, h11);
}
function hermiteVel(p0, m0, p1, m1, u, dur, out) {
  const u2 = u * u;
  const d00 = 6 * u2 - 6 * u, d10 = 3 * u2 - 4 * u + 1, d01 = -6 * u2 + 6 * u, d11 = 3 * u2 - 2 * u;
  return out.set(0, 0, 0).addScaledVector(p0, d00).addScaledVector(m0, d10).addScaledVector(p1, d01).addScaledVector(m1, d11).divideScalar(dur);
}

export const PHASE_NAMES = {
  swim: 'Nado profundo', ascent: 'Ascenso', air: 'En el aire', submerge: 'Impacto e inmersión', recover: 'Recuperación',
};

/**
 * Secuencia del salto (Fase 1.7): nado profundo → ascenso acelerando → arco balístico
 * con giro sobre el eje → caída de espalda → recuperación. Mueve y gira el hueso Root
 * (centro de masas) por código; el cuerpo lo animan los clips swim_idle, swim_fast y
 * breach_body (sincronizado para que su salida e impacto coincidan con la trayectoria).
 * Eventos: surface_exit (la cabeza sale del agua), apex, impact (el centro de masas vuelve al agua).
 */
export function createBreach(scene, whale, anim, waterState) {
  const root = whale.rootBone;
  const head = whale.skinned[0].skeleton.bones.find((b) => (b.userData.name ?? b.name) === 'Head');
  const restLocal = { pos: root.position.clone(), quat: root.quaternion.clone() };
  const parentInv = new THREE.Matrix4();
  const restWorldQuat = new THREE.Quaternion();
  const restWorldPos = new THREE.Vector3();
  whale.root.updateMatrixWorld(true);
  root.getWorldQuaternion(restWorldQuat);
  root.getWorldPosition(restWorldPos);
  const bodyEvents = whale.clipEvents.breach_body ?? { surface_exit: 2.625, apex: 3.625, impact: 5.083 };
  const bodyDuration = whale.actions.breach_body?.getClip().duration ?? 5.96;

  const params = {
    depth: 12, // profundidad del centro de masas mientras nada (m)
    swimSpeed: 2, // m/s
    swimTime: 3, // s
    ascentTime: 4.5, // s
    exitSpeed: 8.5, // velocidad del centro de masas al cruzar la superficie (m/s)
    exitAngle: 72, // grados sobre la horizontal
    roll: 160, // giro total sobre el eje del cuerpo en el aire (grados)
    rollSide: 'Derecha',
    landingPitch: -8, // inclinación al impactar (grados; negativo = morro abajo)
    submergeTime: 2.5,
    submergeDepth: 6,
    recoverTime: 5,
    repeat: true,
  };

  const state = {
    active: false,
    showPath: true,
    phase: '—',
    cycleTime: 0,
    cycleDuration: 0,
    lastEvent: '—',
    airTime: '',
    apexHeight: '',
  };

  let plan = null;
  let t = 0;
  let lastHeadY = null;
  let apexDone = false;
  let impactDone = false;
  let bodyStarted = false;
  let recoverStarted = false;
  const listeners = [];

  // ------------------------------------------------------------------ plan de la trayectoria
  function build() {
    const w = waterState.waterLevel;
    const th = params.exitAngle * DEG;
    const v = params.exitSpeed;
    const vE = new THREE.Vector3(0, v * Math.sin(th), v * Math.cos(th));
    const tAir = (2 * v * Math.sin(th)) / G;
    const dh = (params.depth / Math.tan(th)) * 1.6 + params.swimSpeed * params.ascentTime * 0.3;
    const x = restWorldPos.x;
    const E = new THREE.Vector3(x, w, 0); // la ballena sale del agua en el origen
    const B = new THREE.Vector3(x, w - params.depth, -dh);
    const A = B.clone().add(new THREE.Vector3(0, 0, -params.swimSpeed * params.swimTime));
    const vSwim = new THREE.Vector3(0, 0, params.swimSpeed);
    const I = E.clone().add(new THREE.Vector3(0, 0, vE.z * tAir));
    const vI = new THREE.Vector3(0, -vE.y, vE.z);
    const S = I.clone().add(new THREE.Vector3(0, -params.submergeDepth, 4));
    const vS = new THREE.Vector3(0, -0.4, 1.2);
    const R = new THREE.Vector3(x, w - params.depth, S.z + params.swimSpeed * params.recoverTime * 0.8);
    const phases = [
      { id: 'swim', dur: params.swimTime },
      { id: 'ascent', dur: params.ascentTime, p0: B, m0: vSwim.clone().multiplyScalar(params.ascentTime), p1: E, m1: vE.clone().multiplyScalar(params.ascentTime) },
      { id: 'air', dur: tAir },
      { id: 'submerge', dur: params.submergeTime, p0: I, m0: vI.clone().multiplyScalar(params.submergeTime), p1: S, m1: vS.clone().multiplyScalar(params.submergeTime) },
      { id: 'recover', dur: params.recoverTime, p0: S, m0: vS.clone().multiplyScalar(params.recoverTime), p1: R, m1: vSwim.clone().multiplyScalar(params.recoverTime) },
    ];
    let acc = 0;
    for (const ph of phases) { ph.start = acc; acc += ph.dur; }
    // el clip del cuerpo se reescala para que su salida e impacto coincidan con los de la trayectoria
    const rate = (bodyEvents.impact - bodyEvents.surface_exit) / tAir;
    const tExit = phases[2].start;
    plan = {
      w, th, v, vE, tAir, A, B, E, I, S, R, vSwim, phases, duration: acc, rate,
      bodyStart: tExit - bodyEvents.surface_exit / rate,
      bodyEnd: tExit - bodyEvents.surface_exit / rate + bodyDuration / rate,
      apex: E.clone().add(new THREE.Vector3(0, (vE.y * vE.y) / (2 * G), vE.z * (vE.y / G))),
    };
    state.cycleDuration = acc;
    state.airTime = `${tAir.toFixed(2)} s`;
    state.apexHeight = `${((vE.y * vE.y) / (2 * G)).toFixed(2)} m (centro de masas)`;
    updatePath();
  }

  // ------------------------------------------------------------------ muestreo: posición y orientación en t
  const tmpV = new THREE.Vector3();
  const qPitch = new THREE.Quaternion();
  const qRoll = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  const Z = new THREE.Vector3(0, 0, 1);

  function sample(time, outPos, outQuat) {
    const p = plan;
    const ph = p.phases.find((f) => time < f.start + f.dur) ?? p.phases[p.phases.length - 1];
    const u = THREE.MathUtils.clamp((time - ph.start) / ph.dur, 0, 1);
    const side = params.rollSide === 'Derecha' ? 1 : -1;
    const rollTotal = params.roll * DEG * side;
    let pitch = 0;
    let roll = 0;
    if (ph.id === 'swim') {
      outPos.copy(p.A).addScaledVector(p.vSwim, time);
    } else if (ph.id === 'air') {
      const ta = time - ph.start;
      outPos.copy(p.E).addScaledVector(p.vE, ta);
      outPos.y -= 0.5 * G * ta * ta;
      pitch = lerp(p.th, params.landingPitch * DEG, smooth(0.2, 1, u));
      roll = rollTotal * smooth(0.05, 0.95, u);
    } else {
      hermite(ph.p0, ph.m0, ph.p1, ph.m1, u, outPos);
      hermiteVel(ph.p0, ph.m0, ph.p1, ph.m1, u, ph.dur, tmpV);
      if (ph.id === 'ascent') {
        pitch = Math.atan2(tmpV.y, tmpV.z);
      } else if (ph.id === 'submerge') {
        pitch = lerp(params.landingPitch * DEG, -15 * DEG, smooth(0, 1, u));
        roll = rollTotal;
      } else {
        pitch = lerp(-15 * DEG, 0, smooth(0, 1, u));
        roll = lerp(rollTotal, 0, smooth(0.1, 0.9, u));
      }
    }
    // morro arriba = giro negativo sobre X (la ballena mira hacia +Z); el giro sobre su eje, en Z
    qPitch.setFromAxisAngle(X, -pitch);
    qRoll.setFromAxisAngle(Z, roll);
    outQuat.copy(qPitch).multiply(qRoll);
    return ph;
  }

  // ------------------------------------------------------------------ vista previa de la trayectoria
  const pathGeo = new THREE.BufferGeometry();
  const path = new THREE.Line(pathGeo, new THREE.LineBasicNodeMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.7 }));
  path.frustumCulled = false;
  scene.add(path);
  const markerGeo = new THREE.SphereGeometry(0.18, 12, 8);
  const markers = {
    surface_exit: new THREE.Mesh(markerGeo, new THREE.MeshBasicNodeMaterial({ color: 0x66bb6a })),
    apex: new THREE.Mesh(markerGeo, new THREE.MeshBasicNodeMaterial({ color: 0xffee58 })),
    impact: new THREE.Mesh(markerGeo, new THREE.MeshBasicNodeMaterial({ color: 0xef5350 })),
  };
  Object.values(markers).forEach((m) => scene.add(m));

  function updatePath() {
    const pts = [];
    for (let s = 0; s <= plan.duration; s += 0.05) pts.push(samplePos(s));
    pathGeo.setFromPoints(pts);
    markers.surface_exit.position.copy(plan.E);
    markers.apex.position.copy(plan.apex);
    markers.impact.position.copy(plan.I);
    applyVisibility();
  }
  function samplePos(s) {
    const pos = new THREE.Vector3();
    sample(s, pos, new THREE.Quaternion());
    return pos;
  }
  function applyVisibility() {
    const show = state.showPath && state.active;
    path.visible = show;
    Object.values(markers).forEach((m) => { m.visible = show; });
  }

  // ------------------------------------------------------------------ aplicar al hueso Root
  const P = new THREE.Vector3();
  const Q = new THREE.Quaternion();
  const worldQ = new THREE.Quaternion();
  const parentQ = new THREE.Quaternion();
  function applyToRoot(pos, quat) {
    const parent = root.parent;
    parent.updateMatrixWorld(true);
    parentInv.copy(parent.matrixWorld).invert();
    root.position.copy(pos).applyMatrix4(parentInv);
    worldQ.copy(quat).multiply(restWorldQuat);
    parent.getWorldQuaternion(parentQ);
    root.quaternion.copy(parentQ.invert().multiply(worldQ));
  }

  function emit(name) {
    state.lastEvent = `${name} (t = ${t.toFixed(2)} s)`;
    listeners.forEach((fn) => fn(name, t));
  }

  function restartCycle() {
    t = 0;
    state.cycleTime = 0;
    lastHeadY = null;
    apexDone = impactDone = bodyStarted = recoverStarted = false;
    anim.play('swim_idle', anim.state.fade, { restart: true });
  }

  build();
  applyVisibility();
  const headPos = new THREE.Vector3();

  return {
    params,
    state,
    phaseNames: PHASE_NAMES,
    rebuild() { build(); },
    applyVisibility,
    on(fn) { listeners.push(fn); },
    start() {
      build();
      state.active = true;
      applyVisibility();
      restartCycle();
    },
    stop() {
      state.active = false;
      state.phase = '—';
      applyVisibility();
      root.position.copy(restLocal.pos);
      root.quaternion.copy(restLocal.quat);
      anim.play('swim_idle', anim.state.fade, { restart: true });
    },
    restart() { if (state.active) restartCycle(); },
    update(dt) {
      anim.update(dt); // mixer con la velocidad/pausa globales del panel (cámara lenta)
      if (!state.active) return;
      t += dt * (anim.state.playing ? anim.state.speed : 0);
      if (t >= plan.duration) {
        if (params.repeat) restartCycle();
        else { t = plan.duration; }
      }
      const ph = sample(t, P, Q);
      applyToRoot(P, Q);
      state.phase = PHASE_NAMES[ph.id];
      state.cycleTime = t;

      // clips del cuerpo según la fase
      if (ph.id === 'ascent' && anim.state.clip === 'swim_idle' && t < plan.bodyStart) anim.play('swim_fast', 1.0);
      if (!bodyStarted && t >= plan.bodyStart) {
        bodyStarted = true;
        anim.play('breach_body', 0.8, { timeScale: plan.rate, startTime: Math.max(0, (t - plan.bodyStart) * plan.rate), once: true, restart: true });
      }
      if (!recoverStarted && (t >= plan.bodyEnd || ph.id === 'recover')) {
        recoverStarted = true;
        anim.play('swim_idle', 1.5, { restart: true });
      }

      // eventos
      if (head) {
        head.getWorldPosition(headPos);
        if (lastHeadY !== null && lastHeadY < plan.w && headPos.y >= plan.w && ph.id !== 'recover') emit('surface_exit');
        lastHeadY = headPos.y;
      }
      if (!apexDone && ph.id === 'air' && t - ph.start >= plan.vE.y / G) { apexDone = true; emit('apex'); }
      if (!impactDone && ph.id === 'submerge') { impactDone = true; emit('impact'); }
    },
  };
}
