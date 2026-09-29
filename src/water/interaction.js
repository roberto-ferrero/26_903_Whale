import * as THREE from 'three/webgpu';
import { createSplash, SPLASH_TYPES as T } from './splash.js';

/**
 * Sondas de la ballena (Fase 5.1): hueso, radio del cuerpo en ese punto y papel.
 * Los huesos están sobre la línea media, así que cada sonda es una esfera de ese radio.
 */
export const PROBES = [
  ['UpperJaw', 0.9, 'head'], ['Head', 1.35, 'head'], ['Spine005', 1.6, 'body'], ['Spine004', 1.7, 'body'],
  ['Spine003', 1.7, 'body'], ['MasterBone', 1.6, 'body'], ['Spine', 1.4, 'body'], ['Spine001', 1.15, 'body'],
  ['Spine002', 0.9, 'body'], ['Spine008', 0.6, 'tail'], ['Spine007', 0.45, 'tail'], ['UpperFin001', 0.25, 'fin'],
  ['FinL002', 0.35, 'fin'], ['FinL004', 0.3, 'fin'], ['FinL005', 0.2, 'finTip'], ['FinR002', 0.35, 'fin'],
  ['FinR004', 0.3, 'fin'], ['FinR005', 0.2, 'finTip'], ['TailL002', 0.3, 'fluke'], ['TailL004', 0.2, 'fluke'],
  ['TailR002', 0.3, 'fluke'], ['TailR004', 0.2, 'fluke'],
];

/**
 * Interacción ballena ↔ agua (Fase 5): sondas, ondas y espuma, salpicaduras, cortinas, estela,
 * piel mojada y sincronización con los eventos del salto.
 */
export function createInteraction({ renderer, scene, whale, ocean, ripples, fsm }) {
  const state = {
    enabled: true,
    splashes: true,
    density: 1, // multiplicador de todas las emisiones
    sizeScale: 1,
    brightness: 1,
    waves: 1, // fuerza de las ondas de la ballena
    rippleSpeed: 4.5,
    foamLife: 25, // s
    wake: 1,
    curtains: 1,
    bubbles: 1, // Fase 6.6
    dynamicWet: true,
    showProbes: false,
    info: '',
  };

  // sin compute (WebGL2, Fase 8.5): ni partículas ni ondas; el resto (sondas, piel mojada) sigue
  const compute = renderer.backend.isWebGPUBackend === true;
  const splash = compute
    ? createSplash(renderer, scene, {
      surfaceHeight: ocean.surfaceHeightNode, lightNode: ocean.underLightNode, velocityNode: ocean.cameraVelocityNode,
    })
    : {
      emit() {}, update() {}, set visible(v) {}, stats: { spawned: 0 },
      uniforms: { wind: { value: new THREE.Vector3() }, sizeScale: { value: 1 }, brightness: { value: 1 } },
    };
  if (!ripples) ripples = { uniforms: { c: { value: 0 }, foamTau: { value: 0 } }, addSource() {}, update() {} };

  // ------------------------------------------------------------------ sondas
  const bones = new Map();
  whale.root.traverse((o) => { if (o.isBone) bones.set(o.name, o); });
  const probes = PROBES.filter(([name]) => bones.has(name)).map(([name, r, role]) => ({
    name, r, role, bone: bones.get(name),
    pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
    depth: -99, water: 0, lastSubmerged: -1e9, lastAir: -1e9, exitSpeed: 0, ready: false,
    acc: { drop: 0, spray: 0, mist: 0, sheet: 0, bubble: 0 },
  }));
  const probeGeo = new THREE.SphereGeometry(1, 12, 8);
  const probeMats = [0x42a5f5, 0xffca28, 0xef5350].map((c) => new THREE.MeshBasicNodeMaterial({ color: c, wireframe: true }));
  const probeMeshes = probes.map((p) => {
    const m = new THREE.Mesh(probeGeo, probeMats[0]);
    m.scale.setScalar(p.r);
    m.visible = false;
    scene.add(m);
    return m;
  });

  let time = 0;
  let lastWet = -1e9;
  const tmp = new THREE.Vector3();
  const wind2 = new THREE.Vector2();
  const windVec = new THREE.Vector3();
  const light = { dir: new THREE.Vector3(), sunRadiance: new THREE.Color(), ambient: new THREE.Color() };

  const emit = (p, kind, n, opts) => {
    // acumula fracciones para no perder emisiones con dt pequeños
    p.acc[kind] += n * state.density;
    const k = Math.floor(p.acc[kind]);
    if (k > 0) { p.acc[kind] -= k; splash.emit(opts, k); }
  };

  // ------------------------------------------------------------------ eventos del salto (5.7)
  const pending = [];
  const pulses = []; // impulsos de ondas que duran varios fotogramas: [x, z, radio, vy, espuma, s restantes]
  fsm.on((name) => { if (state.enabled && (name === 'surface_exit' || name === 'impact' || name === 'apex')) pending.push(name); });

  function burst(name) {
    const d = state.density;
    // el centro del cuerpo en la superficie
    const body = probes.filter((p) => p.role === 'body' || p.role === 'head');
    const c = new THREE.Vector3();
    let n = 0;
    for (const p of body) if (Math.abs(p.depth) < p.r * 3) { c.add(p.pos); n++; }
    if (!n) for (const p of body) { c.add(p.pos); n++; }
    c.divideScalar(n);
    const wl = ocean.heightAt(c.x, c.z);
    c.y = wl;
    if (name === 'impact') {
      // gran impacto: corona de gotas, spray, bruma, cráter y anillos
      splash.emit({ pos: c, vel: tmp.set(0, 0, 0).clone(), radius: 4, spread: 11, type: T.drop, size: [0.04, 0.14], life: 3.5, up: 0.55, ring: true }, 7000 * d);
      splash.emit({ pos: c, vel: new THREE.Vector3(), radius: 5, spread: 8, type: T.spray, size: [0.08, 0.25], life: 2.5, up: 0.4, ring: true }, 5000 * d);
      splash.emit({ pos: c.clone().setY(wl + 1.5), vel: new THREE.Vector3(0, 2.5, 0), radius: 5, spread: 5, type: T.mist, size: [2, 5], life: 5, up: 0.2 }, 220 * d);
      pulses.push([c.x, c.z, 4, -5 * state.waves, 6, 0.3]);
      // 6.6 nube de burbujas: el aire que arrastra el cuerpo al caer
      splash.emit({ pos: c.clone().setY(wl - 3), vel: new THREE.Vector3(), radius: 7, spread: 3, type: T.bubble, size: [0.006, 0.05], life: 9 }, 8000 * d * state.bubbles);
    } else if (name === 'surface_exit') {
      const head = probes.find((p) => p.role === 'head');
      const hv = head ? head.vel.clone() : new THREE.Vector3(0, 8, 0);
      splash.emit({ pos: c, vel: hv.clone().multiplyScalar(0.5), radius: 2.5, spread: 5, type: T.drop, size: [0.04, 0.12], life: 3.5, up: 0.5, ring: true }, 3500 * d);
      splash.emit({ pos: c, vel: new THREE.Vector3(0, 1.5, 0), radius: 3, spread: 3, type: T.mist, size: [1.5, 4], life: 4, up: 0.3 }, 80 * d);
      pulses.push([c.x, c.z, 3, 2.5 * state.waves, 3, 0.2]);
      splash.emit({ pos: c.clone().setY(wl - 2), vel: new THREE.Vector3(0, 1, 0), radius: 4, spread: 2, type: T.bubble, size: [0.006, 0.04], life: 6 }, 2000 * d * state.bubbles);
    }
  }

  // ------------------------------------------------------------------ actualización
  function update(dt, skyLight, sun) {
    time += dt;
    const active = state.enabled;
    splash.visible = active && state.splashes;
    ripples.uniforms.c.value = state.rippleSpeed;
    ripples.uniforms.foamTau.value = state.foamLife;
    // luz para las partículas: sol (o luna) del cielo
    if (skyLight) {
      light.dir.copy(skyLight.dir);
      light.sunRadiance.copy(sun.color).multiplyScalar(sun.visible ? sun.intensity : 0);
      light.ambient.copy(skyLight.ambient);
    }
    // deriva superficial (~3 % del viento del mar)
    const a = THREE.MathUtils.degToRad(ocean.state.windDirection);
    wind2.set(Math.sin(a), -Math.cos(a)).multiplyScalar(ocean.state.windSpeed * 0.03);
    windVec.set(Math.sin(a), 0, -Math.cos(a)).multiplyScalar(ocean.state.windSpeed * 0.6);
    splash.uniforms.wind.value.copy(windVec);
    splash.uniforms.sizeScale.value = state.sizeScale;
    splash.uniforms.brightness.value = state.brightness;

    let wetCount = 0;
    let crossing = 0;
    const level = ocean.state.level;
    for (let i = 0; i < probes.length; i++) {
      const p = probes[i];
      p.bone.getWorldPosition(p.pos);
      if (!p.ready) { p.prev.copy(p.pos); p.ready = true; }
      if (dt > 0) {
        p.vel.subVectors(p.pos, p.prev).divideScalar(dt);
        // saltos (reinicios de la ballena): sin velocidad
        if (p.vel.lengthSq() > 60 * 60) p.vel.set(0, 0, 0);
      }
      p.prev.copy(p.pos);
      // profundidad del centro respecto a la superficie (sin consultar si está muy hondo)
      p.water = p.pos.y < level - 8 ? level : ocean.heightAt(p.pos.x, p.pos.z);
      p.depth = p.pos.y - p.water;
      if (p.depth < 0) { p.lastSubmerged = time; p.exitSpeed = Math.max(p.vel.y, 0); wetCount++; } else p.lastAir = time;
      probeMeshes[i].visible = state.showProbes;
      if (state.showProbes) {
        probeMeshes[i].position.copy(p.pos);
        probeMeshes[i].material = probeMats[Math.abs(p.depth) < p.r ? 1 : p.depth < 0 ? 0 : 2];
      }
      if (!active || dt <= 0) continue;

      const vy = p.vel.y, vh = Math.hypot(p.vel.x, p.vel.z);
      const cutting = Math.abs(p.depth) < p.r * 1.1;
      if (cutting) {
        crossing++;
        const ar = Math.sqrt(Math.max(p.r * p.r - p.depth * p.depth, 0.1 * p.r * p.r)); // radio de la sección
        // 5.2 / 5.6: el cuerpo empuja el agua con su velocidad vertical; al avanzar la hunde (estela)
        // (la superficie solo se levanta un poco: la columna de agua son las partículas)
        const src = (0.3 * vy - 0.12 * vh * state.wake) * state.waves;
        ripples.addSource(p.pos.x, p.pos.z, ar * 1.2, src, Math.abs(vy) * 0.08 + vh * 0.04 * state.wake);
        tmp.set(p.pos.x, p.water, p.pos.z);
        if (vy > 0.8) {
          // sale: el agua sube con el cuerpo (columna) y se desprende en láminas y gotas
          emit(p, 'sheet', 260 * ar * vy * dt * state.curtains, { pos: tmp.clone(), vel: p.vel.clone().multiplyScalar(0.8), radius: ar, spread: 1.2, type: T.sheet, size: [0.12, 0.3], life: 3, up: 0.1, ring: true });
          emit(p, 'drop', 160 * ar * vy * dt, { pos: tmp.clone(), vel: p.vel.clone().multiplyScalar(0.6), radius: ar, spread: 3, type: T.drop, size: [0.04, 0.12], life: 3, up: 0.3, ring: true });
        } else if (vy < -0.8) {
          // entra: corona radial de gotas y spray, y bruma
          const s = -vy;
          const base = new THREE.Vector3(p.vel.x * 0.3, 0, p.vel.z * 0.3);
          emit(p, 'drop', 420 * ar * s * dt, { pos: tmp.clone(), vel: base, radius: ar, spread: s * 0.7, type: T.drop, size: [0.04, 0.12], life: 3, up: 0.55, ring: true });
          emit(p, 'spray', 260 * ar * s * dt, { pos: tmp.clone(), vel: base.clone(), radius: ar, spread: s * 0.8, type: T.spray, size: [0.08, 0.22], life: 2.5, up: 0.35, ring: true });
          emit(p, 'mist', 3 * ar * s * dt, { pos: tmp.clone().setY(p.water + 0.8), vel: new THREE.Vector3(0, 1, 0), radius: ar * 1.5, spread: 1.5, type: T.mist, size: [1.5, 4], life: 6, up: 0.2 });
        } else if (vh > 1.5) {
          // roza la superficie nadando: spray fino
          emit(p, 'spray', 18 * ar * vh * dt, { pos: tmp.clone(), vel: p.vel.clone().multiplyScalar(0.3), radius: ar, spread: 1.2, type: T.spray, size: [0.1, 0.3], life: 1.5, up: 0.4, ring: true });
        }
        if (vy < -0.8) {
          // el cuerpo mete aire al entrar: burbujas bajo la huella
          emit(p, 'bubble', 120 * ar * -vy * dt * state.bubbles, { pos: tmp.clone().setY(p.water - p.r), vel: p.vel.clone().multiplyScalar(0.3), radius: ar * 1.4, spread: 2, type: T.bubble, size: [0.005, 0.035], life: 7 });
        }
      } else if (active && p.depth < -p.r) {
        // 6.6 estela de burbujas: bajo el agua, poco después de haber estado fuera (aire atrapado)
        const since = time - p.lastAir;
        const sp = p.vel.length();
        if (since < 4 && sp > 2) {
          emit(p, 'bubble', 30 * p.r * sp * (1 - since / 4) * dt * state.bubbles, { pos: p.pos.clone(), vel: p.vel.clone().multiplyScalar(0.2), radius: p.r * 1.3, spread: 1.2, type: T.bubble, size: [0.005, 0.03], life: 6 });
        }
      } else if (active && p.depth > p.r) {
        // 5.4 cortinas: el agua que el cuerpo ha sacado cae durante ~2 s; goteo de las aletas más tiempo
        const since = time - p.lastSubmerged;
        // cuanto más rápido ha salido, más agua arrastra (al asomar despacio, casi nada)
        const runoff = Math.max(0, 1 - since / 2.2) * Math.min(1, Math.max(0, p.exitSpeed - 1.5) / 5);
        if (runoff > 0 && p.role !== 'finTip') {
          // se desprende por la parte baja del cuerpo y queda detrás formando la cortina
          const under = p.pos.clone().add(tmp.set(0, -0.75 * p.r, 0));
          emit(p, 'sheet', 380 * p.r * runoff * dt * state.curtains, { pos: under, vel: p.vel.clone().multiplyScalar(0.85).add(tmp.set(0, -1.5, 0)), radius: p.r * 0.7, spread: 0.7, type: T.sheet, size: [0.15, 0.35], life: 2.5, up: -1 });
        }
        if ((p.role === 'finTip' || p.role === 'fluke') && since < 6) {
          emit(p, 'drop', 70 * (1 - since / 6) * dt, { pos: p.pos.clone(), vel: p.vel.clone(), radius: p.r, spread: 0.4, type: T.drop, size: [0.05, 0.12], life: 2, up: -1 });
        }
      }
    }
    if (wetCount > 0) lastWet = time;
    // 5.7: eventos del salto
    while (pending.length) burst(pending.shift());
    for (let i = pulses.length - 1; i >= 0; i--) {
      const q = pulses[i];
      if (active && dt > 0) ripples.addSource(q[0], q[1], q[2], q[3], q[4]);
      q[5] -= dt;
      if (q[5] <= 0) pulses.splice(i, 1);
    }
    // 5.4: piel mojada: recién salida brilla; se seca en ~1 min
    if (state.dynamicWet) whale.uniforms.wetness.value = Math.max(0.35, Math.exp(-(time - lastWet) / 60));

    // simulación de ondas centrada en la ballena y partículas
    const center = probes[3]?.pos ?? tmp.set(0, 0, 0);
    ripples.update(active ? dt : 0, center.x, center.z, wind2);
    splash.update(dt, light);
    state.info = `${crossing} sondas en la superficie · ${splash.stats.spawned.toLocaleString('es-ES')} partículas emitidas`;
  }

  function apply() {
    splash.visible = state.enabled && state.splashes;
    for (const m of probeMeshes) m.visible = state.showProbes;
  }

  return { state, apply, update, probes, splash, ripples };
}
