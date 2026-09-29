import * as THREE from 'three/webgpu';
import { bodyQuaternion } from './breachPlanner.js';

const DEG = THREE.MathUtils.DEG2RAD;

export const BREATH_DEFAULTS = {
  breathAngle: 28, // grados: inclinación máxima del ascenso a respirar
  breathSurfaceTime: 4.5, // s en la superficie (soplido y lomo arqueado)
  breathRootDepth: 0.7, // m: centro de masas bajo la superficie al respirar (el espiráculo está ~0,75 m por encima: justo asoma)
  breathDiveAngle: 25, // grados: inclinación de la inmersión
  blowHeight: 4, // m: altura del soplido (jorobada: 3-5 m, arbustivo)
  blowAmount: 1, // multiplicador de partículas del soplido
};

/** Punta de la cola: altura máxima sobre el centro de masas en una brazada del clip de nado (m). */
export const STROKE_HEIGHT = 3.9;
/**
 * Amplitud del aleteo (peso del clip de nado) según la profundidad del centro de masas: junto a la
 * superficie, brazadas cortas (la cola no sale del agua); a partir de ~9 m, la del clip.
 */
export function strokeAt(depth, surfaceStroke) {
  return THREE.MathUtils.lerp(surfaceStroke, 1, THREE.MathUtils.smoothstep(depth, 1.5, 9));
}

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

/**
 * Plan de una respiración desde la posición del centro de masas y el rumbo actuales:
 *   subir (curva en S hasta quedar horizontal justo bajo la superficie) → respirar (avanza por la
 *   superficie: soplido al asomar el espiráculo, con la cabeza algo levantada) → bajar (inmersión
 *   suave hasta la profundidad de partida).
 * Las tres fases empiezan y acaban con la velocidad de nado, así que no hay cambios bruscos de
 * dirección; el cabeceo sale de la velocidad (más un arco en la superficie que empieza y acaba en 0).
 */
export function planBreath(start, heading, waterLevel, swimSpeed, p) {
  const f = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
  const at = (s, y) => start.clone().addScaledVector(f, s).setY(y);
  const vel = (vs, vy) => f.clone().multiplyScalar(vs).setY(vy);
  const w = waterLevel;
  const sp = Math.max(swimSpeed, 0.5);
  const ys = w - p.breathRootDepth;
  // subir: la curva en S tiene su pendiente máxima (~1,3-1,5 × la media) a mitad de camino
  const rise = Math.max(ys - start.y, 0.3);
  const dh1 = Math.max((rise * 1.3) / Math.tan(p.breathAngle * DEG), 6);
  const len1 = Math.hypot(dh1, rise);
  const vUp = sp * 1.35; // sube algo más deprisa de lo que nada
  const t1 = len1 / vUp;
  const S1 = at(dh1, ys);
  // superficie: avanza despacio, con un ligero hundimiento final
  const vSurf = sp * 0.75;
  const t2 = p.breathSurfaceTime;
  const S2 = at(dh1 + vSurf * t2, ys - 0.35);
  // bajar: hasta la profundidad de partida
  const sink = Math.max(S2.y - start.y, 0.3);
  const dh3 = Math.max((sink * 1.3) / Math.tan(p.breathDiveAngle * DEG), 6);
  const t3 = Math.hypot(dh3, sink) / (sp * 1.2);
  const R = at(dh1 + vSurf * t2 + dh3, start.y);

  const vSwim = vel(sp, 0);
  const phases = [
    { id: 'subir', dur: t1, p0: start.clone(), m0: vSwim.clone().multiplyScalar(t1), p1: S1, m1: vel(vSurf, 0).multiplyScalar(t1) },
    { id: 'respirar', dur: t2, p0: S1, m0: vel(vSurf, 0).multiplyScalar(t2), p1: S2, m1: vel(vSurf, -0.25).multiplyScalar(t2) },
    { id: 'bajar', dur: t3, p0: S2, m0: vel(vSurf, -0.25).multiplyScalar(t3), p1: R, m1: vSwim.clone().multiplyScalar(t3) },
  ];
  let acc = 0;
  for (const ph of phases) { ph.start = acc; acc += ph.dur; }
  const tmpV = new THREE.Vector3();

  function sample(t, outPos, outQuat) {
    const ph = phases.find((x) => t < x.start + x.dur) ?? phases[phases.length - 1];
    const u = THREE.MathUtils.clamp((t - ph.start) / ph.dur, 0, 1);
    hermite(ph.p0, ph.m0, ph.p1, ph.m1, u, outPos);
    hermiteVel(ph.p0, ph.m0, ph.p1, ph.m1, u, ph.dur, tmpV);
    let pitch = Math.atan2(tmpV.y, Math.hypot(tmpV.x, tmpV.z));
    // en la superficie: la cabeza sube un poco al soplar y vuelve a nivel (bajar la cabeza con el
    // cuerpo rígido levantaría la cola fuera del agua: el arqueo real es una curvatura del cuerpo)
    if (ph.id === 'respirar') pitch += 5 * DEG * Math.sin(u * Math.PI);
    // al bajar, con el cuerpo rígido el morro abajo levanta la cola (6-7 m por detrás del centro):
    // se limita el cabeceo al fondo que tiene la cola bajo el agua (la ballena real arquea el pedúnculo)
    if (ph.id !== 'subir') {
      const d = w - outPos.y;
      const room = (d - 1.1 - STROKE_HEIGHT * strokeAt(d, p.surfaceStroke ?? 0.25)) / 6.5;
      pitch = Math.max(pitch, -Math.asin(THREE.MathUtils.clamp(room, 0, 0.6)));
    }
    if (outQuat) bodyQuaternion(heading, pitch, 0, outQuat);
    return ph;
  }

  return {
    kind: 'breath',
    heading, w, phases, duration: acc,
    // el soplido: nada más asomar el espiráculo, al empezar la fase en superficie
    blowTime: phases[1].start + 0.15,
    R,
    sample,
  };
}
