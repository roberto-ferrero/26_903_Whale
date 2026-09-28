// Pruebas del espectro y de la FFT de referencia del océano (Fase 4): node tools/test-ocean.mjs
import {
  SPECTRUM_DEFAULTS, buildSpectrum, createCpuField, ifft2d, seaState, CASCADE_LENGTHS, FFT_SIZE,
} from '../src/ocean/spectrum.js';

let fails = 0;
const check = (name, ok, info) => {
  console.log(`${ok ? 'OK  ' : 'FALLO'} ${name}${info ? ` · ${info}` : ''}`);
  if (!ok) fails++;
};

// 1. IFFT con la mariposa de la GPU frente a la DFT directa
{
  const n = 16;
  const re = new Float64Array(n * n).map(() => Math.random() - 0.5);
  const im = new Float64Array(n * n).map(() => Math.random() - 0.5);
  const r0 = re.slice(), i0 = im.slice();
  ifft2d(re, im, n);
  let err = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let sr = 0, si = 0;
    for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) {
      const a = (2 * Math.PI * (u * x + v * y)) / n;
      const c = Math.cos(a), s = Math.sin(a);
      sr += r0[v * n + u] * c - i0[v * n + u] * s;
      si += r0[v * n + u] * s + i0[v * n + u] * c;
    }
    err = Math.max(err, Math.abs(sr - re[y * n + x]), Math.abs(si - im[y * n + x]));
  }
  check('IFFT 2D = DFT directa', err < 1e-9, `error máx ${err.toExponential(2)}`);
}

// 2. Varianza del campo generado frente a m0 del espectro (Hs = 4√m0)
{
  const p = { ...SPECTRUM_DEFAULTS };
  const t0 = performance.now();
  const spec = buildSpectrum(p);
  const ms = performance.now() - t0;
  const n = FFT_SIZE;
  let variance = 0;
  for (let c = 0; c < CASCADE_LENGTHS.length; c++) {
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) {
      const j = c * n * n + i;
      re[i] = spec.h0[j * 4] + spec.h0[j * 4 + 2];
      im[i] = spec.h0[j * 4 + 1] + spec.h0[j * 4 + 3];
    }
    ifft2d(re, im, n);
    let s = 0, maxIm = 0;
    for (let i = 0; i < n * n; i++) { s += re[i] * re[i]; maxIm = Math.max(maxIm, Math.abs(im[i])); }
    variance += s / (n * n);
    check(`cascada ${c} (${CASCADE_LENGTHS[c]} m): campo real`, maxIm < 1e-6, `|Im| máx ${maxIm.toExponential(1)}`);
  }
  const hsField = 4 * Math.sqrt(variance);
  const ss = seaState(p);
  const hsTheory = Math.hypot(ss.windHs, p.swellHeight);
  check('Hs del campo ≈ Hs del espectro discreto', Math.abs(hsField / spec.hs - 1) < 0.08,
    `campo ${hsField.toFixed(2)} m · espectro ${spec.hs.toFixed(2)} m`);
  check('Hs discreta ≈ teórica (viento ⊕ swell)', Math.abs(spec.hs / hsTheory - 1) < 0.15,
    `discreta ${spec.hs.toFixed(2)} m · teórica ${hsTheory.toFixed(2)} m (viento ${ss.windHs.toFixed(2)} m, Tp ${ss.windPeriod.toFixed(1)} s, λp ${ss.windLength.toFixed(0)} m)`);
  console.log(`     buildSpectrum: ${ms.toFixed(0)} ms (3 × ${n}²)`);

  // Mar totalmente desarrollado (Pierson-Moskowitz): Hs ≈ 0,21·U²/g
  for (const U of [5, 10, 15]) {
    const s2 = seaState({ ...p, windSpeed: U, fetch: 5000, swellHeight: 0 });
    const pm = (0.21 * U * U) / 9.81;
    check(`PM U=${U} m/s`, Math.abs(s2.windHs / pm - 1) < 0.2, `JONSWAP ${s2.windHs.toFixed(2)} m · PM ${pm.toFixed(2)} m`);
  }
}

// 3. Una sola onda: avanza en la dirección de k y las crestas se afilan (jacobiano < 1)
{
  const n = 16, L = 16;
  const h0 = new Float32Array(n * n * 4), omega = new Float32Array(n * n);
  const k = (2 * Math.PI) / L;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const fx = x < n / 2 ? x : x - n, fy = y < n / 2 ? y : y - n;
    omega[y * n + x] = Math.sqrt(9.81 * Math.hypot(fx, fy) * k);
  }
  h0[1 * 4] = 0.5; // h0(k=(1,0)) = 0,5 → h = cos(kx − ωt)
  h0[(n - 1) * 4 + 2] = 0.5; // conj(h0(−k)) en −k
  const spec = { h0, omega, lengths: [L], n };
  const f = createCpuField(spec, n);
  const w = omega[1];
  const crestX = (t) => {
    f.update(t, 1);
    let best = -1e9, bx = 0;
    for (let i = 0; i < 400; i++) { const x = (i / 400) * L; const d = f.displacement(x, 0, [0, 0, 0]); if (d[1] > best) { best = d[1]; bx = x; } }
    return bx;
  };
  const dt = 0.2;
  const x0 = crestX(0), x1 = crestX(dt);
  const speed = (x1 - x0) / dt, c = w / k;
  check('la onda avanza hacia +k a la velocidad de fase', Math.abs(speed / c - 1) < 0.1, `${speed.toFixed(2)} m/s · teórica ${c.toFixed(2)} m/s`);
  f.update(0, 1);
  const eps = 0.01;
  const jac = (x) => 1 + (f.displacement(x + eps, 0, [0, 0, 0])[0] - f.displacement(x - eps, 0, [0, 0, 0])[0]) / (2 * eps);
  check('cresta afilada: J < 1 en la cresta y > 1 en el valle', jac(0) < 1 && jac(L / 2) > 1, `J cresta ${jac(0).toFixed(3)} · valle ${jac(L / 2).toFixed(3)}`);
}

// 4. Consulta de altura: la inversión del desplazamiento horizontal converge
{
  const spec = buildSpectrum({ ...SPECTRUM_DEFAULTS, windSpeed: 14, choppiness: 1 });
  const f = createCpuField(spec, [64, 64, 64]);
  f.update(12.3, 1.2);
  let err = 0;
  for (let i = 0; i < 200; i++) {
    const px = Math.random() * 300, pz = Math.random() * 300;
    const d = f.displacement(px, pz, [0, 0, 0]);
    const h = f.heightAt(px + d[0], pz + d[2]);
    err = Math.max(err, Math.abs(h - d[1]));
  }
  check('heightAt invierte el desplazamiento horizontal', err < 0.02, `error máx ${(err * 100).toFixed(2)} cm`);
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) f.update(i * 0.016, 1.2);
  console.log(`     createCpuField.update (3 × 64²): ${((performance.now() - t0) / 100).toFixed(2)} ms`);
}

// 5. Precisión de la consulta rápida frente al campo completo (256² en las 3 cascadas, = GPU)
{
  const spec = buildSpectrum({ ...SPECTRUM_DEFAULTS });
  const ref = createCpuField(spec, [256, 256, 256]);
  ref.update(20, 1.1);
  const pts = Array.from({ length: 300 }, () => [Math.random() * 400 - 200, Math.random() * 400 - 200]);
  const href = pts.map(([x, z]) => ref.heightAt(x, z));
  let rms = 0;
  for (const h of href) rms += h * h;
  console.log(`     altura de referencia: rms ${Math.sqrt(rms / href.length).toFixed(2)} m`);
  for (const sizes of [[64, 64, 64], [64, 64, 0], [64, 32, 0], [32, 32, 0], [128, 64, 0]]) {
    const f = createCpuField(spec, sizes);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) f.update(20, 1.1);
    const ms = (performance.now() - t0) / 20;
    let e = 0, em = 0;
    pts.forEach(([x, z], i) => { const d = f.heightAt(x, z) - href[i]; e += d * d; em = Math.max(em, Math.abs(d)); });
    console.log(`     consulta [${sizes}]: error rms ${(Math.sqrt(e / pts.length) * 100).toFixed(1)} cm, máx ${(em * 100).toFixed(1)} cm · update ${ms.toFixed(2)} ms`);
  }
}

console.log(fails ? `\n${fails} prueba(s) fallida(s)` : '\nTodas las pruebas correctas');
process.exit(fails ? 1 : 0);
