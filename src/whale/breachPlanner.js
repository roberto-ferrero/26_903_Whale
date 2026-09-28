import * as THREE from 'three/webgpu';

export const G = 9.81;
const DEG = THREE.MathUtils.DEG2RAD;
const smooth = (e0, e1, x) => { const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const lerp = THREE.MathUtils.lerp;

export const BREACH_DEFAULTS = {
  ascentTime: 4.5, // s
  exitSpeed: 8.5, // velocidad del centro de masas al cruzar la superficie (m/s)
  exitAngle: 72, // grados sobre la horizontal
  roll: 160, // giro total sobre el eje del cuerpo en el aire (grados)
  rollSide: 'Derecha',
  landingPitch: -8, // inclinación al impactar (grados; negativo = morro abajo)
  submergeTime: 2.5,
  submergeDepth: 6,
  recoverTime: 5,
};

// Hermite cúbica (tangentes ya multiplicadas por la duración) y su derivada
function hermite(p0, m0, p1, m1, u, out) {
  const u2 = u * u, u3 = u2 * u;
  return out.set(0, 0, 0).addScaledVector(p0, 2 * u3 - 3 * u2 + 1).addScaledVector(m0, u3 - 2 * u2 + u)
    .addScaledVector(p1, -2 * u3 + 3 * u2).addScaledVector(m1, u3 - u2);
}
function hermiteVel(p0, m0, p1, m1, u, dur, out) {
  const u2 = u * u;
  return out.set(0, 0, 0).addScaledVector(p0, 6 * u2 - 6 * u).addScaledVector(m0, 3 * u2 - 4 * u + 1)
    .addScaledVector(p1, -6 * u2 + 6 * u).addScaledVector(m1, 3 * u2 - 2 * u).divideScalar(dur);
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** Orientación del cuerpo: rumbo (sobre Y), cabeceo (morro arriba > 0) y giro sobre su eje. */
export function bodyQuaternion(heading, pitch, roll, out = new THREE.Quaternion()) {
  const qy = new THREE.Quaternion().setFromAxisAngle(Y, heading);
  const qp = new THREE.Quaternion().setFromAxisAngle(X, -pitch); // la ballena mira hacia +Z
  const qr = new THREE.Quaternion().setFromAxisAngle(Z, roll);
  return out.copy(qy).multiply(qp).multiply(qr);
}

/**
 * Plan del salto desde la posición actual del centro de masas y su rumbo:
 * ascenso (Hermite) → vuelo balístico con giro → impacto e inmersión → recuperación a la
 * profundidad de partida. Todas las posiciones son del centro de masas en el mundo.
 * @param {THREE.Vector3} start  centro de masas al empezar el ascenso
 * @param {number} heading       rumbo (rad; 0 = +Z)
 * @param {number} waterLevel    altura del agua (m)
 * @param {number} swimSpeed     velocidad de nado al empezar y al terminar (m/s)
 * @param {object} p             parámetros (BREACH_DEFAULTS)
 * @param {{surface_exit:number, impact:number}} bodyEvents  tiempos del clip breach_body
 * @param {number} bodyDuration  duración del clip breach_body (s)
 */
export function planBreach(start, heading, waterLevel, swimSpeed, p, bodyEvents, bodyDuration) {
  const f = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
  const at = (s, y) => start.clone().addScaledVector(f, s).setY(y);
  const vel = (vs, vy) => f.clone().multiplyScalar(vs).setY(vy);
  const w = waterLevel;
  const depth = Math.max(0.5, w - start.y);
  const th = p.exitAngle * DEG;
  const v = p.exitSpeed;
  const vE = vel(v * Math.cos(th), v * Math.sin(th));
  const tAir = (2 * v * Math.sin(th)) / G;
  const dh = (depth / Math.tan(th)) * 1.6 + swimSpeed * p.ascentTime * 0.3;
  const B = start.clone();
  const E = at(dh, w);
  const vSwim = vel(swimSpeed, 0);
  const sI = dh + v * Math.cos(th) * tAir;
  const I = at(sI, w);
  const vI = vel(v * Math.cos(th), -v * Math.sin(th));
  const S = at(sI + 4, w - p.submergeDepth);
  const vS = vel(1.2, -0.4);
  const R = at(sI + 4 + swimSpeed * p.recoverTime * 0.8, start.y);
  const phases = [
    { id: 'preparar', dur: p.ascentTime, p0: B, m0: vSwim.clone().multiplyScalar(p.ascentTime), p1: E, m1: vE.clone().multiplyScalar(p.ascentTime) },
    { id: 'saltar', dur: tAir },
    { id: 'caer', dur: p.submergeTime, p0: I, m0: vI.clone().multiplyScalar(p.submergeTime), p1: S, m1: vS.clone().multiplyScalar(p.submergeTime) },
    { id: 'recuperar', dur: p.recoverTime, p0: S, m0: vS.clone().multiplyScalar(p.recoverTime), p1: R, m1: vSwim.clone().multiplyScalar(p.recoverTime) },
  ];
  let acc = 0;
  for (const ph of phases) { ph.start = acc; acc += ph.dur; }
  const tExit = phases[1].start;
  const rate = (bodyEvents.impact - bodyEvents.surface_exit) / tAir;
  const bodyStart = tExit - bodyEvents.surface_exit / rate;
  const apexHeight = (vE.y * vE.y) / (2 * G);
  const side = p.rollSide === 'Derecha' ? 1 : -1;
  const rollTotal = p.roll * DEG * side;
  const tmpV = new THREE.Vector3();

  function sample(t, outPos, outQuat) {
    const ph = phases.find((x) => t < x.start + x.dur) ?? phases[phases.length - 1];
    const u = THREE.MathUtils.clamp((t - ph.start) / ph.dur, 0, 1);
    let pitch = 0;
    let roll = 0;
    if (ph.id === 'saltar') {
      const ta = t - ph.start;
      outPos.copy(E).addScaledVector(vE, ta);
      outPos.y -= 0.5 * G * ta * ta;
      pitch = lerp(th, p.landingPitch * DEG, smooth(0.2, 1, u));
      roll = rollTotal * smooth(0.05, 0.95, u);
    } else {
      hermite(ph.p0, ph.m0, ph.p1, ph.m1, u, outPos);
      hermiteVel(ph.p0, ph.m0, ph.p1, ph.m1, u, ph.dur, tmpV);
      if (ph.id === 'preparar') {
        pitch = Math.atan2(tmpV.y, Math.hypot(tmpV.x, tmpV.z));
      } else if (ph.id === 'caer') {
        pitch = lerp(p.landingPitch * DEG, -15 * DEG, smooth(0, 1, u));
        roll = rollTotal;
      } else {
        pitch = lerp(-15 * DEG, 0, smooth(0, 1, u));
        roll = lerp(rollTotal, 0, smooth(0.1, 0.9, u));
      }
    }
    if (outQuat) bodyQuaternion(heading, pitch, roll, outQuat);
    return ph;
  }

  return {
    heading, w, phases, duration: acc, tExit, tAir, rate, bodyStart,
    bodyEnd: bodyStart + bodyDuration / rate,
    apexTime: tExit + vE.y / G,
    impactTime: phases[2].start,
    apexHeight,
    E, I, R,
    apex: at(dh + v * Math.cos(th) * (vE.y / G), w + apexHeight),
    sample,
  };
}
