import * as THREE from 'three/webgpu';
import {
  Fn, Loop, clamp, exp, float, instanceIndex, int, max, min, mix, select, smoothstep, storage, texture, textureStore,
  uniform, uniformArray, uvec2, vec2, vec4,
} from 'three/tsl';

export const MAX_SOURCES = 48;

/**
 * Ondas dinámicas y espuma persistente alrededor de la ballena (Fases 5.2, 5.5 y 5.6).
 *
 * Campo de alturas de N×N celdas (dx = size/N) que sigue a la ballena: cuando el centro se mueve
 * un número entero de celdas, el paso de simulación lee el estado desplazado (lo que sale del
 * dominio se pierde, lo que entra es agua en calma). Cada celda guarda (h, v, espuma):
 *   v += (c²·∇²h − amortiguación·v)·dt + fuentes      (ecuación de onda, Euler semi-implícito)
 *   h += v·dt
 *   espuma: se crea con las fuentes y donde la superficie se rompe (|∇h| grande), se advecta con la
 *   deriva del viento, se difumina un poco y se disipa con constante de tiempo τ.
 * Los bordes absorben (esponja) para que las ondas no reboten.
 * Salida: textura RGBA16F (h, ∂h/∂x, ∂h/∂z, espuma) que el océano suma a su oleaje.
 */
export function createRipples(renderer, { size = 128, n = 256 } = {}) {
  const N = n, NN = N * N;
  const mk = () => storage(new THREE.StorageBufferAttribute(new Float32Array(NN * 4), 4), 'vec4', NN);
  const buf = [mk(), mk()];
  let ping = 0;

  const u = {
    dt: uniform(1 / 60),
    c: uniform(4.5), // m/s: velocidad de las ondas (≈ onda de gravedad de ~13 m)
    damping: uniform(0.08),
    shift: uniform(new THREE.Vector2()), // celdas que se ha movido el dominio en este paso
    origin: uniform(new THREE.Vector2()), // centro del dominio (m, múltiplo de dx)
    size: uniform(size),
    count: uniform(0),
    sources: uniformArray(Array.from({ length: MAX_SOURCES }, () => new THREE.Vector4()), 'vec4'), // x, z, radio, velocidad (m/s)
    foamSrc: uniformArray(new Array(MAX_SOURCES).fill(0), 'float'), // espuma por segundo de cada fuente
    foamTau: uniform(25),
    drift: uniform(new THREE.Vector2()), // deriva superficial (m/s)
    steepFoam: uniform(1),
  };
  const dx = size / N;

  const makeStep = (src, dst) => Fn(() => {
    const idx = instanceIndex;
    const x = int(idx.mod(N)), y = int(idx.div(N));
    const sx = int(u.shift.x), sy = int(u.shift.y);
    // estado anterior en la celda desplazada (fuera del dominio: agua en calma)
    const read = (ix, iy) => {
      const px = ix.add(sx), py = iy.add(sy);
      const inside = px.greaterThanEqual(0).and(px.lessThan(N)).and(py.greaterThanEqual(0)).and(py.lessThan(N));
      const cx = clamp(px, 0, N - 1), cy = clamp(py, 0, N - 1);
      return src.element(cy.mul(N).add(cx)).mul(select(inside, float(1), float(0)));
    };
    const s = read(x, y);
    const l = read(x.sub(1), y), r = read(x.add(1), y), d = read(x, y.sub(1)), t = read(x, y.add(1));
    const lap = l.x.add(r.x).add(d.x).add(t.x).sub(s.x.mul(4)).div(dx * dx);
    // posición del centro de la celda en el mundo
    const wx = float(x).add(0.5).mul(dx).sub(size / 2).add(u.origin.x);
    const wz = float(y).add(0.5).mul(dx).sub(size / 2).add(u.origin.y);
    // fuentes (huella de la ballena) y espuma que generan
    const wsum = float(0).toVar();
    const wv = float(0).toVar();
    const foamIn = float(0).toVar();
    Loop({ start: int(0), end: int(u.count), type: 'int', condition: '<' }, ({ i }) => {
      const e = u.sources.element(i);
      const ddx = wx.sub(e.x), ddz = wz.sub(e.y);
      const w = exp(ddx.mul(ddx).add(ddz.mul(ddz)).div(max(e.z.mul(e.z), 0.01)).negate());
      wsum.addAssign(w);
      wv.addAssign(e.w.mul(w));
      foamIn.addAssign(u.foamSrc.element(i).mul(w));
    });
    // esponja en los bordes (12 % exterior)
    const fx = float(x).add(0.5).div(N), fy = float(y).add(0.5).div(N);
    const edge = min(min(fx, float(1).sub(fx)), min(fy, float(1).sub(fy)));
    const sponge = float(1).sub(smoothstep(0.0, 0.12, edge)).mul(6);
    const dt = u.dt;
    // la fuente impone la velocidad vertical del agua bajo la huella (el cuerpo empuja el agua)
    const vNew = s.y.add(u.c.mul(u.c).mul(lap).sub(u.damping.add(sponge).mul(s.y)).mul(dt)).toVar();
    vNew.assign(mix(vNew, wv.div(max(wsum, 1e-4)), clamp(wsum, 0, 1).mul(0.35)));
    const hNew = clamp(s.x.add(vNew.mul(dt)).mul(float(1).sub(sponge.mul(dt))), -3, 3);
    // espuma: advección semi-lagrangiana con la deriva, difusión suave, fuentes, rotura y disipación
    const back = vec2(float(x), float(y)).sub(u.drift.mul(dt).div(dx));
    const bx = int(back.x.floor()), by = int(back.y.floor());
    const f00 = read(bx, by).z, f10 = read(bx.add(1), by).z, f01 = read(bx, by.add(1)).z, f11 = read(bx.add(1), by.add(1)).z;
    const ax = back.x.fract(), ay = back.y.fract();
    const adv = mix(mix(f00, f10, ax), mix(f01, f11, ax), ay);
    const blur = l.z.add(r.z).add(d.z).add(t.z).mul(0.25);
    const grad = vec2(r.x.sub(l.x), t.x.sub(d.x)).div(2 * dx).length();
    const breakFoam = clamp(grad.sub(0.35).mul(3), 0, 1).mul(u.steepFoam);
    const foam = mix(adv, blur, 0.08).add(foamIn.add(breakFoam).mul(dt)).mul(exp(dt.div(u.foamTau).negate()));
    dst.element(idx).assign(vec4(hNew, vNew, clamp(foam, 0, 1.5), 0));
  })().compute(NN, [64]);
  const steps = [makeStep(buf[0], buf[1]), makeStep(buf[1], buf[0])];

  // salida a textura: altura, gradiente y espuma
  const tex = new THREE.StorageTexture(N, N);
  tex.type = THREE.HalfFloatType;
  tex.format = THREE.RGBAFormat;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  const makeOut = (b) => Fn(() => {
    const idx = instanceIndex;
    const x = int(idx.mod(N)), y = int(idx.div(N));
    const at = (ix, iy) => b.element(clamp(iy, 0, N - 1).mul(N).add(clamp(ix, 0, N - 1)));
    const s = at(x, y);
    const gx = at(x.add(1), y).x.sub(at(x.sub(1), y).x).div(2 * dx);
    const gz = at(x, y.add(1)).x.sub(at(x, y.sub(1)).x).div(2 * dx);
    textureStore(tex, uvec2(idx.mod(N), idx.div(N)), vec4(s.x, gx, gz, s.z)).toWriteOnly();
  })().compute(NN, [64]);
  const outs = [makeOut(buf[0]), makeOut(buf[1])];

  const texNode = texture(tex);
  /** Muestra (h, ∂h/∂x, ∂h/∂z, espuma) en la posición del mundo xz; fuera del dominio, 0. */
  const sampleNode = (xz, lod = null) => {
    const uvw = xz.sub(u.origin).div(u.size).add(0.5);
    const inside = smoothstep(0.0, 0.1, min(min(uvw.x, float(1).sub(uvw.x)), min(uvw.y, float(1).sub(uvw.y))));
    const s = texNode.sample(uvw);
    return (lod === null ? s : s.level(lod)).mul(inside);
  };

  const origin = new THREE.Vector2();
  let initialized = false;
  const sources = [];

  return {
    uniforms: u,
    texture: tex,
    sampleNode,
    size,
    cell: dx,
    /** Añade una fuente para el próximo paso: vy = velocidad vertical impuesta (m/s), foam = espuma/s. */
    addSource(x, z, radius, vy, foam = 0) {
      if (sources.length < MAX_SOURCES) sources.push([x, z, radius, vy, foam]);
    },
    /**
     * Avanza la simulación `dt` segundos (de simulación) centrada en (cx, cz).
     * Varios subpasos para no pasar del límite de estabilidad.
     */
    update(dt, cx, cz, wind) {
      // mover el dominio por celdas enteras
      const tx = Math.round(cx / dx) * dx, tz = Math.round(cz / dx) * dx;
      if (!initialized) { origin.set(tx, tz); initialized = true; }
      const shx = Math.round((tx - origin.x) / dx), shz = Math.round((tz - origin.y) / dx);
      origin.x += shx * dx;
      origin.y += shz * dx;
      u.origin.value.copy(origin);
      u.count.value = sources.length;
      sources.forEach((s, i) => { u.sources.array[i].set(s[0], s[1], s[2], s[3]); u.foamSrc.array[i] = s[4]; });
      sources.length = 0;
      if (wind) u.drift.value.set(wind.x, wind.y);
      if (dt <= 0) { u.shift.value.set(shx, shz); if (shx || shz) { renderer.compute(steps[ping]); ping = 1 - ping; } renderer.compute(outs[ping]); return; }
      const sub = Math.max(1, Math.ceil(dt / (0.6 * dx / u.c.value)), Math.ceil(dt / (1 / 60)));
      u.dt.value = dt / sub;
      const list = [];
      for (let i = 0; i < sub; i++) {
        u.shift.value.set(i === 0 ? shx : 0, i === 0 ? shz : 0);
        // el desplazamiento solo se aplica en el primer subpaso: se lanzan por separado
        if (i === 0) { renderer.compute(steps[ping]); ping = 1 - ping; continue; }
        list.push(steps[ping]);
        ping = 1 - ping;
      }
      if (list.length) renderer.compute(list);
      renderer.compute(outs[ping]);
    },
    /** Pruebas: lee el estado (h, v, espuma) de la GPU. */
    async read() { return new Float32Array(await renderer.getArrayBufferAsync(buf[ping].value)); },
    reset() { initialized = false; },
  };
}
