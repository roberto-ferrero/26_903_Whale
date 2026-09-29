import * as THREE from 'three/webgpu';
import { bodyQuaternion } from './breachPlanner.js';

const DEG = THREE.MathUtils.DEG2RAD;

export const BREATH_STYLES = ['Arco (continua)', 'En superficie'];

export const BREATH_DEFAULTS = {
  breathStyle: 'Arco (continua)',
  breathAngle: 28, // grados: inclinación máxima del ascenso a respirar
  breathSurfaceTime: 4.5, // s en la superficie (soplido y lomo arqueado)
  breathRootDepth: 0.7, // m: centro de masas bajo la superficie al respirar (el espiráculo está ~0,75 m por encima: justo asoma)
  breathDiveAngle: 25, // grados: inclinación de la inmersión
  blowHeight: 4, // m: altura del soplido (jorobada: 3-5 m, arbustivo)
  blowAmount: 1, // multiplicador de partículas del soplido
  // estilo «Arco (continua)»
  arcTime: 4.5, // s: el arco en la superficie (sin pararse: avanza y gira a la vez)
  arcLead: 22, // grados: la cabeza va más levantada que la trayectoria al soplar
  arcExit: 24, // grados: inclinación de la trayectoria al salir del arco (hacia abajo)
  archFront: 22, // grados: la cabeza se flexiona hacia abajo (el morro no asoma más que el espiráculo)
  archRear: 14, // grados: la parte trasera se arquea hacia abajo (la cola queda hundida)
  breathExposure: 0.2, // m: lo que asoma el espiráculo sobre el agua al soplar
};

// geometría aproximada (sistema del cuerpo: hacia delante, hacia arriba; m, medida en la malla):
// pivote de la flexión de la cabeza (hueso Head) respecto al centro de masas, y espiráculo
// respecto a ese pivote
const NECK = [2.0, 0.0];
const BLOWHOLE = [1.29, 0.82];
const rot = ([f, u], a) => [f * Math.cos(a) - u * Math.sin(a), f * Math.sin(a) + u * Math.cos(a)];
/** Altura del espiráculo sobre el centro de masas con cabeceo `pitch` y cabeza flexionada `front` (rad). */
function blowholeUp(pitch, front) {
  const b = rot(BLOWHOLE, -front);
  return rot([NECK[0] + b[0], NECK[1] + b[1]], pitch)[1];
}
const smooth = (e0, e1, x) => THREE.MathUtils.smoothstep(x, e0, e1);

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

/** Plan de respiración según el estilo elegido (`breathStyle`). */
export function planBreath(start, heading, waterLevel, swimSpeed, p) {
  return p.breathStyle === 'En superficie'
    ? planBreathSurface(start, heading, waterLevel, swimSpeed, p)
    : planBreathArc(start, heading, waterLevel, swimSpeed, p);
}

/**
 * Respiración «en superficie» (la primera versión, 29/09/2026):
 *   subir (curva en S hasta quedar horizontal justo bajo la superficie) → respirar (avanza por la
 *   superficie: soplido al asomar el espiráculo, con la cabeza algo levantada) → bajar (inmersión
 *   suave hasta la profundidad de partida).
 * Las tres fases empiezan y acaban con la velocidad de nado, así que no hay cambios bruscos de
 * dirección; el cabeceo sale de la velocidad (más un arco en la superficie que empieza y acaba en 0).
 */
function planBreathSurface(start, heading, waterLevel, swimSpeed, p) {
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
    archAt: () => NO_ARCH,
  };
}
const NO_ARCH = { front: 0, rear: 0 };

/**
 * Respiración «en arco» (continua): la ballena no se para. Sube con el cuerpo arqueado (cabeza algo
 * flexionada hacia abajo y la cola hundida), asoma poco más que el espiráculo con la cabeza
 * levantada, sopla mientras sigue avanzando y girando hacia delante, y se sumerge en el mismo
 * movimiento. Fases:
 *   subir (curva en S hasta entrar en el arco casi horizontal) → respirar (arco: la trayectoria pasa
 *   de subir a bajar; el cabeceo va por delante de ella) → bajar (hasta la profundidad de partida).
 * Velocidad constante en todo el plan. El cabeceo es el de la trayectoria más un adelanto que crece
 * al acercarse a la superficie y desaparece al bajar; así el giro es continuo.
 * La altura del arco se calcula para que el espiráculo asome `breathExposure` m en el soplido; la
 * joroba del lomo queda más baja porque el cuerpo va inclinado hacia arriba.
 */
function planBreathArc(start, heading, waterLevel, swimSpeed, p) {
  const f = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
  const at = (s, y) => start.clone().addScaledVector(f, s).setY(y);
  const vel = (vs, vy) => f.clone().multiplyScalar(vs).setY(vy);
  const dirVel = (s, a) => vel(s * Math.cos(a), s * Math.sin(a));
  const w = waterLevel;
  const s = Math.max(swimSpeed, 0.5);
  const g0 = 6 * DEG; // entrada al arco: subiendo un poco
  const g1 = p.arcExit * DEG; // salida: bajando
  const Ta = p.arcTime;
  const L = s * Ta;
  // arco: parábola con esas pendientes (altura final respecto a su inicio A)
  const yC = (L * (Math.tan(g0) - Math.tan(g1))) / 2;
  const lead = p.arcLead * DEG, front = p.archFront * DEG, rear = p.archRear * DEG;
  const vSwim = vel(s, 0);
  const tmpV = new THREE.Vector3(), tmpP = new THREE.Vector3();

  // plan completo para una altura de entrada al arco yA
  function build(yA) {
    const rise = Math.max(yA - start.y, 0.3);
    const dh1 = Math.max((rise * 1.3) / Math.tan(p.breathAngle * DEG), 6);
    const t1 = Math.hypot(dh1, rise) / s;
    const A = at(dh1, yA);
    const C = at(dh1 + L, yA + yC);
    const sink = Math.max(C.y - start.y, 0.3);
    const dh3 = Math.max((sink * 1.3) / Math.tan(p.breathDiveAngle * DEG), 6);
    const t3 = Math.hypot(dh3, sink) / s;
    const R = at(dh1 + L + dh3, start.y);
    const phases = [
      { id: 'subir', dur: t1, p0: start.clone(), m0: vSwim.clone().multiplyScalar(t1), p1: A, m1: dirVel(s, g0).multiplyScalar(t1) },
      { id: 'respirar', dur: Ta, p0: A, m0: dirVel(s, g0).multiplyScalar(Ta), p1: C, m1: dirVel(s, -g1).multiplyScalar(Ta) },
      { id: 'bajar', dur: t3, p0: C, m0: dirVel(s, -g1).multiplyScalar(t3), p1: R, m1: vSwim.clone().multiplyScalar(t3) },
    ];
    let acc = 0;
    for (const ph of phases) { ph.start = acc; acc += ph.dur; }
    const tA = phases[1].start, tC = phases[2].start;
    return {
      phases, R, duration: acc, tA, tC,
      // adelanto del cabeceo (cabeza levantada) y arqueo, suaves en el tiempo
      leadAt: (t) => smooth(tA - 2.5, tA, t) * (1 - smooth(tA + Ta * 0.45, tC + 1.5, t)),
      archAmt: (t) => smooth(tA - 3, tA, t) * (1 - smooth(tC, tC + 3, t)),
    };
  }

  function sampleIn(b, t, outPos) {
    const ph = b.phases.find((x) => t < x.start + x.dur) ?? b.phases[b.phases.length - 1];
    const u = THREE.MathUtils.clamp((t - ph.start) / ph.dur, 0, 1);
    hermite(ph.p0, ph.m0, ph.p1, ph.m1, u, outPos);
    hermiteVel(ph.p0, ph.m0, ph.p1, ph.m1, u, ph.dur, tmpV);
    let pitch = Math.atan2(tmpV.y, Math.hypot(tmpV.x, tmpV.z)) + lead * b.leadAt(t);
    // al bajar, la cola no debe salir: el arqueo trasero la baja; el resto lo limita el cabeceo
    if (ph.id === 'bajar') {
      const d = w - outPos.y;
      const room = (d - 1.1 - STROKE_HEIGHT * strokeAt(d, p.surfaceStroke ?? 0.25)) / 6.5 + Math.sin(rear * b.archAmt(t));
      pitch = Math.max(pitch, -Math.asin(THREE.MathUtils.clamp(room, 0, 0.6)));
    }
    return { ph, pitch };
  }

  // altura: el espiráculo, en su punto más alto de todo el plan, asoma `breathExposure` m
  // (la cabeza empieza a levantarse al final de la subida: se busca en todo el plan, iterando)
  let yA = w - 1.5, b = null, tBlow = 0;
  for (let it = 0; it < 4; it++) {
    b = build(yA);
    let best = -1e9;
    for (let t = Math.max(b.tA - 4, 0); t <= b.tC; t += 0.02) {
      const { pitch } = sampleIn(b, t, tmpP);
      const y = tmpP.y + blowholeUp(pitch, front * b.archAmt(t));
      if (y > best) { best = y; tBlow = t; }
    }
    const err = w + p.breathExposure - best;
    yA += err;
    if (Math.abs(err) < 0.01) break;
  }
  b = build(yA);

  const arch = { front: 0, rear: 0 };
  // el soplido: cuando el espiráculo está más alto (un poco antes, al asomar)
  const blowTime = Math.max(tBlow - 0.25, 0);
  // estados que se muestran (y que usa el director de cámara): el soplido cae al final del tramo de
  // subida, así que «respirar» empieza 1,5 s antes de él y dura hasta el final del arco
  const tR = Math.min(Math.max(blowTime - 1.5, 0.1), b.tC - 0.1);
  const labels = [
    { id: 'subir', start: 0, dur: tR },
    { id: 'respirar', start: tR, dur: b.tC - tR },
    { id: 'bajar', start: b.tC, dur: b.duration - b.tC },
  ];
  return {
    kind: 'breath',
    heading, w, phases: labels, duration: b.duration,
    blowTime,
    R: b.R,
    sample(t, outPos, outQuat) {
      const { pitch } = sampleIn(b, t, outPos);
      if (outQuat) bodyQuaternion(heading, pitch, 0, outQuat);
      return labels.find((x) => t < x.start + x.dur) ?? labels[2];
    },
    /** Arqueo del cuerpo en el instante t (rad): cabeza hacia abajo (front) y parte trasera hacia abajo (rear). */
    archAt(t) {
      const a = b.archAmt(t);
      arch.front = front * a;
      arch.rear = rear * a;
      return arch;
    },
  };
}
