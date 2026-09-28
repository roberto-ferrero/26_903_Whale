import * as THREE from 'three/webgpu';
import {
  Fn, If, clamp, cos, float, instanceIndex, localId, max, select, sin, sqrt, storage, textureStore, uint, uniform, uvec2, vec2, vec4,
  workgroupArray, workgroupBarrier, workgroupId,
} from 'three/tsl';
import { G } from './spectrum.js';

/**
 * Oleaje FFT en la GPU (Fase 4.3): compute shaders TSL.
 *
 * Cada fotograma:
 *   1. `spectrum`: h(k,t) a partir de h0 y 8 campos derivados empaquetados en 4 señales complejas
 *      (dos vec4): [Dx + iDz, Dy + i·∂Dx/∂z] y [∂Dy/∂x + i·∂Dy/∂z, ∂Dx/∂x + i·∂Dz/∂z].
 *   2. IFFT en dos despachos (filas y columnas): cada workgroup de N hilos carga una línea en
 *      memoria compartida y hace allí las log2(N) etapas de mariposa (Cooley-Tukey, la misma tabla
 *      que `spectrum.js` en CPU), primero con un vec4 y luego con el otro. Antes eran 2·log2(N)
 *      despachos leyendo y escribiendo en memoria global: 2,7 ms → ver docs/fase_4_oceano.md.
 *   3. `post` por cascada: escribe dos texturas RGBA16F con repetición y mipmaps:
 *        disp  = (λ·Dx, Dy, λ·Dz, 0)
 *        deriv = (∂Dy/∂x, ∂Dy/∂z, jacobiano, espuma acumulada)
 */
export function createFFTOcean(renderer, spec) {
  const N = spec.n;
  const C = spec.lengths.length;
  const NN = N * N;
  const COUNT = C * NN;
  const BITS = Math.log2(N);

  const h0Attr = new THREE.StorageBufferAttribute(spec.h0, 4);
  const h0 = storage(h0Attr, 'vec4', COUNT).toReadOnly();
  const mk = () => storage(new THREE.StorageBufferAttribute(new Float32Array(COUNT * 4), 4), 'vec4', COUNT);
  const bufs = { A: mk(), B: mk() }; // los dos juegos de señales (la IFFT se hace en el sitio)
  const foam = storage(new THREE.StorageBufferAttribute(new Float32Array(COUNT), 1), 'float', COUNT);

  const u = {
    time: uniform(0),
    lambda: uniform(1),
    dk: spec.lengths.map((L) => uniform((2 * Math.PI) / L)),
    foamJ: uniform(0.82), // la espuma nace donde el jacobiano baja de este valor (cresta que se pliega)
    foamGain: uniform(8),
    foamDecay: uniform(0.9), // factor por fotograma (se recalcula con dt)
  };

  // ------------------------------------------------------------------ 1. espectro en el tiempo t
  const cmul = (ar, ai, br, bi) => vec2(ar.mul(br).sub(ai.mul(bi)), ar.mul(bi).add(ai.mul(br)));
  const spectrumNode = Fn(() => {
    const idx = instanceIndex;
    const c = idx.div(NN);
    const rem = idx.mod(NN);
    const y = rem.div(N), x = rem.mod(N);
    const fx = float(x).toVar(), fy = float(y).toVar();
    If(fx.greaterThanEqual(N / 2), () => { fx.subAssign(N); });
    If(fy.greaterThanEqual(N / 2), () => { fy.subAssign(N); });
    const dk = select(c.equal(0), u.dk[0], select(c.equal(1), u.dk[1], u.dk[C - 1]));
    const kx = fx.mul(dk), kz = fy.mul(dk);
    const k = sqrt(kx.mul(kx).add(kz.mul(kz)));
    const w = sqrt(float(G).mul(k)).mul(u.time);
    const cw = cos(w), sw = sin(w);
    const s = h0.element(idx);
    // h = h0·e^(−iωt) + conj(h0(−k))·e^(iωt)
    const a = cmul(s.x, s.y, cw, sw.negate());
    const b = cmul(s.z, s.w, cw, sw);
    const hr = a.x.add(b.x), hi = a.y.add(b.y);
    const ik = select(k.greaterThan(1e-6), float(1).div(k), float(0));
    const nx = kx.mul(ik), nz = kz.mul(ik);
    // campos en el espacio de frecuencias (i·a = (−a.im, a.re))
    const dxR = nx.mul(hi).negate(), dxI = nx.mul(hr); // Dx = i·(kx/k)·h
    const dzR = nz.mul(hi).negate(), dzI = nz.mul(hr); // Dz = i·(kz/k)·h
    const dxzR = kx.mul(nz).mul(hr).negate(), dxzI = kx.mul(nz).mul(hi).negate(); // ∂Dx/∂z = −kx·kz/k·h
    const dyxR = kx.mul(hi).negate(), dyxI = kx.mul(hr); // ∂Dy/∂x = i·kx·h
    const dyzR = kz.mul(hi).negate(), dyzI = kz.mul(hr); // ∂Dy/∂z = i·kz·h
    const dxxR = kx.mul(nx).mul(hr).negate(), dxxI = kx.mul(nx).mul(hi).negate(); // ∂Dx/∂x = −kx²/k·h
    const dzzR = kz.mul(nz).mul(hr).negate(), dzzI = kz.mul(nz).mul(hi).negate(); // ∂Dz/∂z = −kz²/k·h
    // empaquetado f + i·g: (fR − gI, fI + gR)
    bufs.A.element(idx).assign(vec4(dxR.sub(dzI), dxI.add(dzR), hr.sub(dxzI), hi.add(dxzR)));
    bufs.B.element(idx).assign(vec4(dyxR.sub(dyzI), dyxI.add(dyzR), dxxR.sub(dzzI), dxxI.add(dzzR)));
  })().compute(COUNT, [64]);

  // ------------------------------------------------------------------ 2. IFFT en memoria compartida
  const bitrev = (v) => {
    let r = uint(0);
    for (let b = 0; b < BITS; b++) r = r.add(v.shiftRight(b).bitAnd(1).shiftLeft(BITS - 1 - b));
    return r;
  };
  const shared = [workgroupArray('vec4', N), workgroupArray('vec4', N)];
  const passes = [false, true].map((vertical) => Fn(() => {
    const line = workgroupId.x; // una fila (o columna) de una cascada por workgroup
    const i = localId.x;
    const c = line.div(N), r = line.mod(N);
    const e = vertical ? c.mul(NN).add(i.mul(N)).add(r) : c.mul(NN).add(r.mul(N)).add(i);
    for (const set of ['A', 'B']) {
      shared[0].element(i).assign(bufs[set].element(e));
      workgroupBarrier();
      for (let s = 0; s < BITS; s++) {
        const src = shared[s % 2], dst = shared[(s + 1) % 2];
        const span = 1 << s;
        const kk = i.mul(N >> (s + 1)).mod(N);
        const ang = float(kk).mul((2 * Math.PI) / N);
        const wr = cos(ang), wi = sin(ang);
        const top = i.mod(span * 2).lessThan(span);
        const ia = s === 0 ? select(top, bitrev(i), bitrev(i.sub(1))) : select(top, i, i.sub(span));
        const ib = s === 0 ? select(top, bitrev(i.add(1)), bitrev(i)) : select(top, i.add(span), i);
        const A = src.element(ia);
        const B = src.element(ib);
        const t1 = cmul(wr, wi, B.x, B.y), t2 = cmul(wr, wi, B.z, B.w);
        dst.element(i).assign(vec4(A.x.add(t1.x), A.y.add(t1.y), A.z.add(t2.x), A.w.add(t2.y)));
        workgroupBarrier();
      }
      bufs[set].element(e).assign(shared[BITS % 2].element(i));
      workgroupBarrier();
    }
  })().compute(COUNT, [N]));

  // ------------------------------------------------------------------ 3. texturas por cascada
  const makeTex = () => {
    const t = new THREE.StorageTexture(N, N);
    t.type = THREE.HalfFloatType;
    t.format = THREE.RGBAFormat;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    return t;
  };
  const disp = [], deriv = [], post = [];
  for (let c = 0; c < C; c++) {
    const td = makeTex(), tv = makeTex();
    disp.push(td);
    deriv.push(tv);
    post.push(Fn(() => {
      const local = instanceIndex;
      const idx = local.add(c * NN);
      const x = local.mod(N), y = local.div(N);
      const a = bufs.A.element(idx);
      const b = bufs.B.element(idx);
      const lam = u.lambda;
      // a = (Dx, Dz, Dy, ∂Dx/∂z) · b = (∂Dy/∂x, ∂Dy/∂z, ∂Dx/∂x, ∂Dz/∂z)
      const jxx = float(1).add(lam.mul(b.z)), jzz = float(1).add(lam.mul(b.w)), jxz = lam.mul(a.w);
      const J = jxx.mul(jzz).sub(jxz.mul(jxz));
      const prev = foam.element(idx);
      const fresh = clamp(u.foamJ.sub(J).mul(u.foamGain), 0, 1);
      const f = max(prev.mul(u.foamDecay), fresh);
      foam.element(idx).assign(f);
      textureStore(td, uvec2(x, y), vec4(a.x.mul(lam), a.z, a.y.mul(lam), 0)).toWriteOnly();
      textureStore(tv, uvec2(x, y), vec4(b.x, b.y, J, f)).toWriteOnly();
    })().compute(NN, [64]));
  }

  const all = [spectrumNode, ...passes, ...post];

  return {
    uniforms: u,
    disp,
    deriv,
    lengths: spec.lengths,
    /** Sustituye el espectro inicial (mismo tamaño). */
    setSpectrum(s) {
      h0Attr.array.set(s.h0);
      h0Attr.needsUpdate = true;
    },
    /** Avanza el oleaje al instante `time` (s de simulación). */
    update(time, dt, choppiness, foamDecayPerSecond) {
      u.time.value = time;
      u.lambda.value = choppiness;
      u.foamDecay.value = Math.exp(-Math.max(dt, 0) * foamDecayPerSecond);
      renderer.compute(all);
    },
    /** Pruebas: lee de la GPU los campos espaciales (A = Dx, Dz, Dy, ∂Dx/∂z · B = derivadas). */
    async readFinal(which = 'A') {
      const buf = which === 'foam' ? foam : bufs[which];
      return new Float32Array(await renderer.getArrayBufferAsync(buf.value));
    },
    dispatches: all.length,
  };
}
