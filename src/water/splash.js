import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, atan, cameraPosition, cameraViewMatrix, clamp, cos, dot, exp, float, hash, instanceIndex, instancedArray, int,
  length, max, mix, normalize, pow, select, sin, smoothstep, sqrt, uint, uniform, uniformArray, uv, vec2, vec3, vec4,
} from 'three/tsl';

export const SPLASH_TYPES = { drop: 0, spray: 1, mist: 2, sheet: 3, bubble: 4 };
const MAX_EMITTERS = 64;

/**
 * Salpicaduras con partículas en la GPU (Fases 5.3 y 5.4).
 *
 * Búfer circular de N partículas (posición+edad, velocidad+vida, tipo+tamaño). En cada fotograma la
 * CPU reparte hasta 64 emisores: cada uno recibe un tramo contiguo del anillo [inicio, inicio+n) y el
 * compute inicializa las partículas de ese tramo (sin atómicos). Tipos:
 *   0 gota   · balística, poco rozamiento, muere al tocar el agua
 *   1 spray  · gotitas finas, más rozamiento
 *   2 bruma  · sprites grandes y tenues, casi sin gravedad, crecen y se los lleva el viento
 *   3 lámina · agua que cae del cuerpo (cortinas): sprites estirados según la velocidad
 *   4 burbuja · bajo el agua: sube a su velocidad terminal (según el tamaño), oscila y estalla al llegar arriba
 * Iluminación: ambiente del cielo + sol con fase Henyey-Greenstein (el agua brilla a contraluz).
 */
export function createSplash(renderer, scene, { count = 131072, surfaceHeight, lightNode = null }) {
  const N = count;
  const P = instancedArray(N, 'vec4'); // xyz, edad
  const V = instancedArray(N, 'vec4'); // velocidad, vida (0 = muerta)
  const A = instancedArray(N, 'vec4'); // tipo, tamaño, aleatorio, —

  const u = {
    dt: uniform(0),
    frame: uniform(0, 'uint'),
    emitters: uniformArray(Array.from({ length: MAX_EMITTERS * 4 }, () => new THREE.Vector4()), 'vec4'),
    numEmitters: uniform(0),
    wind: uniform(new THREE.Vector3()),
    sunDir: uniform(new THREE.Vector3(0, 1, 0)),
    sunColor: uniform(new THREE.Color(1, 1, 1)),
    ambient: uniform(new THREE.Color(0.3, 0.4, 0.5)),
    brightness: uniform(1),
    sizeScale: uniform(1),
    shutter: uniform(1 / 45), // s: estela de movimiento de las gotas
    opacity: uniform(1),
  };

  // ------------------------------------------------------------------ simulación
  const rnd = (i, k) => hash(i.mul(9).add(u.frame.mul(7919)).add(uint(k)));
  const update = Fn(() => {
    const i = instanceIndex;
    const p = P.element(i), v = V.element(i), a = A.element(i);
    // ¿nace en este fotograma?
    Loop({ start: int(0), end: int(u.numEmitters), type: 'int', condition: '<' }, ({ i: e }) => {
      const e0 = u.emitters.element(e.mul(4)), e1 = u.emitters.element(e.mul(4).add(1));
      const e2 = u.emitters.element(e.mul(4).add(2)), e3 = u.emitters.element(e.mul(4).add(3));
      const rel = i.add(N).sub(uint(e3.x)).mod(N);
      If(rel.lessThan(uint(e3.y)), () => {
        const r1 = rnd(i, 1), r2 = rnd(i, 2), r3 = rnd(i, 3), r4 = rnd(i, 4), r5 = rnd(i, 5), r6 = rnd(i, 6);
        const ang = r1.mul(Math.PI * 2);
        const ring = e3.w; // 1: salida radial desde el borde de un círculo horizontal
        // dirección aleatoria: esfera con sesgo hacia arriba, o radial hacia fuera
        const up = mix(e3.z, float(1), r3);
        const horiz = sqrt(max(float(1).sub(up.mul(up)), 0));
        const dirRing = vec3(cos(ang).mul(horiz), up, sin(ang).mul(horiz));
        const zz = r2.mul(2).sub(1);
        const hs = sqrt(max(float(1).sub(zz.mul(zz)), 0));
        const dirSph = vec3(cos(ang).mul(hs), max(zz, e3.z.mul(2).sub(1)), sin(ang).mul(hs));
        const dir = normalize(mix(dirSph, dirRing, ring));
        const rr = mix(sqrt(r4), mix(float(0.75), float(1.0), r4), ring).mul(e0.w);
        const off = vec3(cos(ang).mul(rr), r5.sub(0.5).mul(e0.w).mul(float(1).sub(ring)).mul(0.6), sin(ang).mul(rr));
        p.assign(vec4(e0.xyz.add(off), 0));
        const speed = e1.w.mul(float(0.35).add(r6.mul(0.65)));
        v.assign(vec4(e1.xyz.add(dir.mul(speed)), e2.w.mul(float(0.6).add(r5.mul(0.8)))));
        a.assign(vec4(e2.x, mix(e2.y, e2.z, r2.mul(r2)), r1, 0));
      });
    });
    // integración
    If(v.w.greaterThan(0).and(p.w.lessThan(v.w)), () => {
      const type = a.x;
      const isMist = type.greaterThan(1.5).and(type.lessThan(2.5));
      const isBubble = type.greaterThan(3.5);
      const drag = select(type.lessThan(0.5), float(0.08), select(type.lessThan(1.5), float(0.9), select(isMist, float(1.2), select(isBubble, float(3), float(0.25)))));
      // la bruma flota y sube despacio; la burbuja sube a ~0,3-1 m/s según su tamaño (empuje/rozamiento)
      const grav = select(isMist, float(0.15), select(isBubble, a.y.mul(3).add(0.3).mul(3), float(-9.81)));
      const vel = v.xyz.add(vec3(0, grav, 0).mul(u.dt)).toVar();
      // rozamiento hacia el viento (la bruma se va con él)
      vel.assign(u.wind.add(vel.sub(u.wind).mul(exp(drag.negate().mul(u.dt)))));
      const pos = p.xyz.add(vel.mul(u.dt));
      p.assign(vec4(pos, p.w.add(u.dt)));
      v.assign(vec4(vel, v.w));
      If(isMist, () => { a.y.assign(a.y.mul(float(1).add(u.dt.mul(0.12)))); });
      // al volver al agua desaparece (salvo la bruma)
      If(isMist.not().and(isBubble.not()).and(vel.y.lessThan(0)).and(pos.y.lessThan(surfaceHeight(pos.xz))), () => { v.w.assign(0); });
      // la burbuja se bambolea y estalla al llegar a la superficie
      If(isBubble, () => {
        v.x.addAssign(sin(p.w.mul(9).add(a.z.mul(50))).mul(u.dt).mul(1.2));
        v.z.addAssign(cos(p.w.mul(8).add(a.z.mul(31))).mul(u.dt).mul(1.2));
        If(pos.y.greaterThan(surfaceHeight(pos.xz)), () => { v.w.assign(0); });
      });
    });
  })().compute(N, [64]);

  // ------------------------------------------------------------------ render
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const pA = P.toAttribute(), vA = V.toAttribute(), aA = A.toAttribute();
  const alive = vA.w.greaterThan(0).and(pA.w.lessThan(vA.w));
  const t01 = pA.w.div(max(vA.w, 1e-3));
  const type = aA.x;
  const isMist = type.greaterThan(1.5).and(type.lessThan(2.5));
  const isSheet = type.greaterThan(2.5).and(type.lessThan(3.5));
  const isBubble = type.greaterThan(3.5);
  material.positionNode = pA.xyz;
  // estela de movimiento: se estira en la dirección de la velocidad en pantalla
  const vv = cameraViewMatrix.mul(vec4(vA.xyz, 0)).xyz;
  const dist = length(pA.xyz.sub(cameraPosition));
  const streak = length(vv.xy).mul(u.shutter).mul(select(isMist.or(isBubble), float(0), select(isSheet, float(4), float(1))));
  const size = aA.y.mul(u.sizeScale).mul(select(alive, float(1), float(0)));
  material.scaleNode = vec2(size.add(streak), size);
  material.rotationNode = atan(vv.y, vv.x);
  // luz: ambiente + sol con dispersión hacia delante (a contraluz el agua se ilumina)
  const hg = (c, g) => float(1 - g * g).div(pow(float(1 + g * g).sub(c.mul(2 * g)), 1.5)).mul(1 / (4 * Math.PI));
  const viewDir = normalize(pA.xyz.sub(cameraPosition));
  const cosT = dot(viewDir, normalize(u.sunDir));
  const phase = mix(hg(cosT, 0.75), hg(cosT, -0.2), 0.3).mul(4 * Math.PI);
  const light = vec3(u.ambient).mul(1.3).add(vec3(u.sunColor).mul(phase.mul(0.35).add(0.12)));
  // bajo el agua: la luz que llega a esa profundidad (absorción y cáusticas, Fase 6.5)
  const lit = lightNode ? light.mul(lightNode(pA.xyz)) : light;
  material.colorNode = select(isBubble, lit.mul(1.6), lit).mul(u.brightness);
  // forma y transparencia por tipo; la bruma aparece y se desvanece despacio
  const d = length(uv().sub(0.5)).mul(2);
  const round = smoothstep(1.0, 0.45, d);
  const ring = smoothstep(0.55, 0.9, d).mul(smoothstep(1.0, 0.9, d)).add(smoothstep(0.35, 0.0, length(uv().sub(vec2(0.35, 0.65)))).mul(0.8));
  const soft = exp(d.mul(d).mul(-3.5)).mul(smoothstep(1.0, 0.7, d));
  const fadeIn = smoothstep(0.0, 0.08, t01), fadeOut = smoothstep(1.0, 0.7, t01);
  const alphaType = select(type.lessThan(0.5), float(0.8), select(type.lessThan(1.5), float(0.3), select(isMist, float(0.035), select(isBubble, float(0.7), float(0.4)))));
  material.opacityNode = select(isMist, soft, select(isBubble, ring, round)).mul(alphaType).mul(fadeIn.mul(fadeOut)).mul(u.opacity)
    .mul(clamp(dist.div(2), 0, 1)); // no tapar la cámara
  const sprites = new THREE.Sprite(material);
  sprites.count = N;
  sprites.frustumCulled = false;
  sprites.renderOrder = 3;
  scene.add(sprites);

  // ------------------------------------------------------------------ emisores (CPU)
  let head = 0;
  const pending = [];
  let frame = 0;
  const stats = { spawned: 0 };

  return {
    uniforms: u,
    mesh: sprites,
    count: N,
    stats,
    /**
     * Pide `n` partículas: pos, vel base, radio de salida, velocidad aleatoria, tipo, tamaños, vida
     * media, sesgo hacia arriba (−1..1 en esfera; 0..1 en anillo) y anillo (salida radial).
     */
    emit({ pos, vel, radius = 0.5, spread = 1, type = 0, size = [0.05, 0.15], life = 2, up = -1, ring = false }, n) {
      n = Math.floor(n);
      if (n <= 0 || pending.length >= MAX_EMITTERS) return;
      n = Math.min(n, N >> 2);
      pending.push({ pos, vel, radius, spread, type, size, life, up, ring, start: head, n });
      head = (head + n) % N;
      stats.spawned += n;
    },
    update(dt, light) {
      frame++;
      u.dt.value = Math.max(dt, 0);
      u.frame.value = frame;
      u.numEmitters.value = pending.length;
      pending.forEach((e, k) => {
        const o = k * 4, arr = u.emitters.array;
        arr[o].set(e.pos.x, e.pos.y, e.pos.z, e.radius);
        arr[o + 1].set(e.vel.x, e.vel.y, e.vel.z, e.spread);
        arr[o + 2].set(e.type, e.size[0], e.size[1], e.life);
        arr[o + 3].set(e.start, e.n, e.up, e.ring ? 1 : 0);
      });
      pending.length = 0;
      if (light) {
        u.sunDir.value.copy(light.dir);
        u.sunColor.value.copy(light.sunRadiance);
        u.ambient.value.copy(light.ambient);
      }
      renderer.compute(update);
    },
    set visible(v) { sprites.visible = v; },
  };
}
