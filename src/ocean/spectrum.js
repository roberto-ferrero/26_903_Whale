/**
 * Espectro del oleaje y FFT de referencia en CPU (Fase 4.3 y 4.5).
 *
 * - Mar de viento: JONSWAP limitado por el fetch (Hasselmann 1973), con dispersión direccional
 *   de Mitsuyasu (cos^2s del semiángulo, s dependiente de la frecuencia).
 * - Mar de fondo (swell): forma JONSWAP con periodo de pico dado y escalada para dar la altura
 *   significativa pedida; dispersión cos^2s estrecha.
 * - Amplitudes iniciales de Tessendorf: h0(k) = (ξr + iξi)/√2 · √(E(k)·Δk²/2), con E(k) la densidad
 *   de energía en número de onda (m⁴) → la varianza del campo coincide con m0 = ∫E dk.
 * - Evolución: h(k,t) = h0(k)·e^(−iωt) + conj(h0(−k))·e^(iωt) → cada componente avanza en la
 *   dirección de su k (convención de la transformada inversa: f(x) = Σ F(k)·e^(ik·x)).
 * - Tres cascadas de distinto tamaño; cada una solo contiene su banda de |k| (sin solaparse).
 *
 * No depende de Three.js: se usa en el navegador y en las pruebas con Node (tools/test-ocean.mjs).
 */

export const G = 9.81;

export const SPECTRUM_DEFAULTS = {
  windSpeed: 9, // m/s a 10 m
  windDirection: 60, // grados desde el norte hacia donde va el oleaje (como el viento de las nubes)
  fetch: 120, // km
  windAlign: 1, // multiplica el exponente de Mitsuyasu (más = más alineado con el viento)
  swellHeight: 1.2, // m (altura significativa)
  swellPeriod: 11, // s
  swellDirection: 20,
  swellSpread: 24, // exponente s del cos^2s
  shortWaveCut: 0.02, // m: amortigua las longitudes de onda por debajo (≈ capilares)
  seed: 1,
};

/** Tamaño de cada cascada (m) y resolución de la FFT. */
export const CASCADE_LENGTHS = [500, 97, 19];
export const FFT_SIZE = 256;

// --------------------------------------------------------------------------- utilidades
function lgamma(x) {
  // Lanczos (g = 7, n = 9)
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Normalización de cos^2s(θ/2) para que integre 1 en [−π, π]. */
function spreadNorm(s) {
  return Math.exp(lgamma(s + 1) - lgamma(s + 0.5)) / (2 * Math.sqrt(Math.PI));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussPair(rnd) {
  const u = Math.max(rnd(), 1e-12), v = rnd();
  const r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
}

/** Índice de la FFT → número de onda entero (0..N/2−1, luego −N/2..−1). */
export const freqIndex = (i, n) => (i < n / 2 ? i : i - n);

// --------------------------------------------------------------------------- espectros 1D
function jonswapShape(w, wp, gamma) {
  const sigma = w <= wp ? 0.07 : 0.09;
  const r = Math.exp(-((w - wp) ** 2) / (2 * sigma * sigma * wp * wp));
  return (G * G / w ** 5) * Math.exp(-1.25 * (wp / w) ** 4) * gamma ** r;
}

/** Parámetros derivados del estado del mar (picos, α, Hs teóricas). */
export function seaState(p) {
  const U = Math.max(p.windSpeed, 0.1);
  const F = Math.max(p.fetch, 0.1) * 1000;
  // JONSWAP limitado por fetch, sin pasar del mar totalmente desarrollado (Pierson-Moskowitz)
  const wp = Math.max(22 * Math.cbrt((G * G) / (U * F)), 0.855 * G / U);
  const alpha = Math.max(0.076 * ((U * U) / (F * G)) ** 0.22, 0.0081);
  // realce del pico: 3,3 en mar joven → 1 (Pierson-Moskowitz) al acercarse al mar desarrollado
  const nu = (U * wp) / G;
  const tt = Math.min(Math.max((nu - 0.855) / (1.3 - 0.855), 0), 1);
  const gamma = 1 + 2.3 * tt * tt * (3 - 2 * tt);
  const windM0 = integrate((w) => alpha * jonswapShape(w, wp, gamma), wp);
  const swp = (2 * Math.PI) / Math.max(p.swellPeriod, 1);
  const unit = integrate((w) => jonswapShape(w, swp, 5), swp);
  const swellAlpha = p.swellHeight > 0 ? (p.swellHeight / 4) ** 2 / unit : 0;
  return {
    wp, alpha, gamma, swp, swellAlpha,
    windHs: 4 * Math.sqrt(windM0),
    windPeriod: (2 * Math.PI) / wp,
    windLength: (2 * Math.PI * G) / (wp * wp),
    swellLength: (2 * Math.PI * G) / (swp * swp),
  };
}

function integrate(f, wp) {
  let s = 0;
  const w0 = wp * 0.3, w1 = wp * 12, n = 4000, dw = (w1 - w0) / n;
  for (let i = 0; i < n; i++) s += f(w0 + (i + 0.5) * dw) * dw;
  return s;
}

/**
 * Densidad de energía direccional en número de onda E(kx, kz) (m⁴), mar de viento + swell.
 * `ss` = seaState(p).
 */
export function energyAt(kx, kz, p, ss) {
  const k = Math.hypot(kx, kz);
  if (k < 1e-6) return 0;
  const w = Math.sqrt(G * k);
  const dwdk = G / (2 * w);
  const theta = Math.atan2(kx, -kz); // ángulo desde el norte (−Z), horario hacia el este (+X)
  let e = 0;
  if (p.windSpeed > 0.1) {
    // Mitsuyasu: s_p = 11,5·(U·ωp/g)^−2,5; s ∝ (ω/ωp)^5 por debajo del pico y ^−2,5 por encima
    const sp = 11.5 * ((p.windSpeed * ss.wp) / G) ** -2.5;
    const s = Math.max(0.5, p.windAlign * sp * (w <= ss.wp ? (w / ss.wp) ** 5 : (w / ss.wp) ** -2.5));
    const d = Math.cos(0.5 * angleDiff(theta, p.windDirection * Math.PI / 180));
    e += ss.alpha * jonswapShape(w, ss.wp, ss.gamma) * spreadNorm(s) * Math.abs(d) ** (2 * s);
  }
  if (ss.swellAlpha > 0) {
    const s = Math.max(0.5, p.swellSpread);
    const d = Math.cos(0.5 * angleDiff(theta, p.swellDirection * Math.PI / 180));
    e += ss.swellAlpha * jonswapShape(w, ss.swp, 5) * spreadNorm(s) * Math.abs(d) ** (2 * s);
  }
  // E(ω,θ)·dω/dk / k → E(kx,kz); amortiguación de las ondas muy cortas
  return (e * dwdk / k) * Math.exp(-((k * p.shortWaveCut) ** 2));
}

const angleDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

/** Bandas de |k| de cada cascada: [kLow, kHigh). */
export function cascadeBands(lengths = CASCADE_LENGTHS) {
  const bands = [];
  for (let c = 0; c < lengths.length; c++) {
    const low = c === 0 ? 0 : (2 * Math.PI / lengths[c]) * 6;
    const high = c === lengths.length - 1 ? Infinity : (2 * Math.PI / lengths[c + 1]) * 6;
    bands.push([low, high]);
  }
  return bands;
}

/**
 * Amplitudes iniciales de todas las cascadas.
 * Devuelve { h0: Float32Array(C·N·N·4) [Re h0(k), Im h0(k), Re conj(h0(−k)), Im conj(h0(−k))],
 *            omega: Float32Array(C·N·N), m0, hs, ... }.
 */
export function buildSpectrum(p, n = FFT_SIZE, lengths = CASCADE_LENGTHS) {
  const ss = seaState(p);
  const bands = cascadeBands(lengths);
  const C = lengths.length;
  const h0 = new Float32Array(C * n * n * 4);
  const omega = new Float32Array(C * n * n);
  const raw = new Float32Array(C * n * n * 2);
  let m0 = 0;
  for (let c = 0; c < C; c++) {
    const rnd = mulberry32((p.seed * 7919 + c * 104729) >>> 0);
    const dk = (2 * Math.PI) / lengths[c];
    const [lo, hi] = bands[c];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const [gr, gi] = gaussPair(rnd); // se consume siempre: misma semilla → mismo mar
        const fx = freqIndex(x, n), fy = freqIndex(y, n);
        const kx = fx * dk, kz = fy * dk;
        const k = Math.hypot(kx, kz);
        const idx = c * n * n + y * n + x;
        omega[idx] = Math.sqrt(G * k);
        if (k < lo || k >= hi || k === 0 || fx === -n / 2 || fy === -n / 2) continue;
        const e = energyAt(kx, kz, p, ss);
        m0 += e * dk * dk;
        const a = Math.sqrt((e * dk * dk) / 2);
        raw[idx * 2] = (gr / Math.SQRT2) * a;
        raw[idx * 2 + 1] = (gi / Math.SQRT2) * a;
      }
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const idx = c * n * n + y * n + x;
        const mx = (n - x) % n, my = (n - y) % n; // índice de −k
        const midx = c * n * n + my * n + mx;
        h0[idx * 4] = raw[idx * 2];
        h0[idx * 4 + 1] = raw[idx * 2 + 1];
        h0[idx * 4 + 2] = raw[midx * 2];
        h0[idx * 4 + 3] = -raw[midx * 2 + 1];
      }
    }
  }
  return { h0, omega, m0, hs: 4 * Math.sqrt(m0), seaState: ss, bands, lengths, n };
}

// --------------------------------------------------------------------------- FFT (misma mariposa que la GPU)
export const bitReverse = (x, bits) => {
  let r = 0;
  for (let b = 0; b < bits; b++) r |= ((x >> b) & 1) << (bits - 1 - b);
  return r;
};

/**
 * Mariposa de Cooley-Tukey (inversa, e^{+2πi k/N}) para la etapa `s` y el índice `x`:
 * devuelve [idxA, idxB, twRe, twIm] con salida = in[idxA] + tw·in[idxB].
 */
export function butterfly(s, x, n) {
  const bits = Math.log2(n);
  const span = 1 << s;
  const k = (x * (n >> (s + 1))) % n;
  const ang = (2 * Math.PI * k) / n;
  const top = x % (span * 2) < span;
  let a, b;
  if (s === 0) {
    a = top ? bitReverse(x, bits) : bitReverse(x - 1, bits);
    b = top ? bitReverse(x + 1, bits) : bitReverse(x, bits);
  } else {
    a = top ? x : x - span;
    b = top ? x + span : x;
  }
  return [a, b, Math.cos(ang), Math.sin(ang)];
}

const fftTables = new Map();
function tablesFor(n) {
  let t = fftTables.get(n);
  if (!t) {
    const bits = Math.log2(n);
    t = { bits, a: new Int32Array(bits * n), b: new Int32Array(bits * n), wr: new Float64Array(bits * n), wi: new Float64Array(bits * n) };
    for (let s = 0; s < bits; s++) {
      for (let x = 0; x < n; x++) {
        const [a, b, wr, wi] = butterfly(s, x, n);
        const o = s * n + x;
        t.a[o] = a; t.b[o] = b; t.wr[o] = wr; t.wi[o] = wi;
      }
    }
    t.r = [new Float64Array(n), new Float64Array(n)];
    t.i = [new Float64Array(n), new Float64Array(n)];
    fftTables.set(n, t);
  }
  return t;
}

/** IFFT 2D in-place (sin normalizar) de un campo complejo re/im de n×n. */
export function ifft2d(re, im, n) {
  const t = tablesFor(n);
  const pass = (off, stride) => {
    let ar = t.r[0], ai = t.i[0], br = t.r[1], bi = t.i[1];
    for (let i = 0; i < n; i++) { ar[i] = re[off + i * stride]; ai[i] = im[off + i * stride]; }
    for (let s = 0; s < t.bits; s++) {
      const base = s * n;
      for (let x = 0; x < n; x++) {
        const a = t.a[base + x], b = t.b[base + x], wr = t.wr[base + x], wi = t.wi[base + x];
        br[x] = ar[a] + wr * ar[b] - wi * ai[b];
        bi[x] = ai[a] + wr * ai[b] + wi * ar[b];
      }
      let tmp = ar; ar = br; br = tmp;
      tmp = ai; ai = bi; bi = tmp;
    }
    for (let i = 0; i < n; i++) { re[off + i * stride] = ar[i]; im[off + i * stride] = ai[i]; }
  };
  for (let y = 0; y < n; y++) pass(y * n, 1);
  for (let x = 0; x < n; x++) pass(x, n);
}

// --------------------------------------------------------------------------- consulta de altura en CPU (4.5)
/**
 * Campo de desplazamiento de baja resolución: para cada cascada, las frecuencias |i| < m/2 del
 * mismo espectro que la GPU (m = sizes[c]; 0 = se omite la cascada). Da la altura exacta de las
 * olas medianas y grandes, sin latencia ni lectura de la GPU.
 */
export function createCpuField(spec, sizes = [64, 32, 0]) {
  const { n, lengths } = spec;
  const C = lengths.length;
  if (typeof sizes === 'number') sizes = lengths.map(() => sizes);
  const fields = lengths.map((_, c) => {
    const m = sizes[c] || 0;
    return {
      m, dx: new Float64Array(m * m), dy: new Float64Array(m * m), dz: new Float64Array(m * m),
      re: new Float64Array(m * m), im: new Float64Array(m * m), re2: new Float64Array(m * m), im2: new Float64Array(m * m),
    };
  });
  let lambda = 1;

  function update(time, choppiness) {
    lambda = choppiness;
    for (let c = 0; c < C; c++) {
      const { m, re, im, re2, im2 } = fields[c];
      if (!m) continue;
      const dk = (2 * Math.PI) / lengths[c];
      re.fill(0); im.fill(0); re2.fill(0); im2.fill(0);
      for (let y = 0; y < m; y++) {
        for (let x = 0; x < m; x++) {
          const fx = freqIndex(x, m), fy = freqIndex(y, m);
          if (fx === -m / 2 || fy === -m / 2) continue;
          const sx = (fx + n) % n, sy = (fy + n) % n;
          const idx = c * n * n + sy * n + sx;
          const kx = fx * dk, kz = fy * dk, k = Math.sqrt(kx * kx + kz * kz);
          if (k === 0) continue;
          const w = spec.omega[idx] * time;
          const cw = Math.cos(w), sw = Math.sin(w);
          // h = h0·e^(−iωt) + conj(h0(−k))·e^(iωt)
          const hr = spec.h0[idx * 4] * cw + spec.h0[idx * 4 + 1] * sw + spec.h0[idx * 4 + 2] * cw - spec.h0[idx * 4 + 3] * sw;
          const hi = spec.h0[idx * 4 + 1] * cw - spec.h0[idx * 4] * sw + spec.h0[idx * 4 + 3] * cw + spec.h0[idx * 4 + 2] * sw;
          const o = y * m + x;
          re[o] = hr; im[o] = hi; // altura
          // Dx + i·Dz = i(kx/k)h + i·i(kz/k)h
          re2[o] = -(kx / k) * hi - (kz / k) * hr;
          im2[o] = (kx / k) * hr - (kz / k) * hi;
        }
      }
      ifft2d(re, im, m);
      ifft2d(re2, im2, m);
      const f = fields[c];
      for (let i = 0; i < m * m; i++) { f.dy[i] = re[i]; f.dx[i] = re2[i]; f.dz[i] = im2[i]; }
    }
  }

  // interpolación Catmull-Rom (4×4): con ~2 muestras por longitud de onda la bilineal pierde
  // mucha amplitud; la cúbica reproduce el mismo campo que la GPU con la mitad de muestras
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = new Float64Array(4);
  const sample = (arr, m, u, v) => {
    // u, v en celdas (con repetición)
    const x0 = Math.floor(u), y0 = Math.floor(v);
    const fx = u - x0, fy = v - y0;
    for (let j = 0; j < 4; j++) {
      const yy = (((y0 + j - 1) % m) + m) % m;
      const o = yy * m;
      const xa = (((x0 - 1) % m) + m) % m, xb = (xa + 1) % m, xc = (xa + 2) % m, xd = (xa + 3) % m;
      row[j] = cr(arr[o + xa], arr[o + xb], arr[o + xc], arr[o + xd], fx);
    }
    return cr(row[0], row[1], row[2], row[3], fy);
  };

  /** Desplazamiento (λ·Dx, Dy, λ·Dz) en la posición sin desplazar (x, z). */
  function displacement(x, z, out) {
    out[0] = out[1] = out[2] = 0;
    for (let c = 0; c < C; c++) {
      const f = fields[c];
      if (!f.m) continue;
      const s = f.m / lengths[c];
      const u = x * s, v = z * s;
      out[0] += lambda * sample(f.dx, f.m, u, v);
      out[1] += sample(f.dy, f.m, u, v);
      out[2] += lambda * sample(f.dz, f.m, u, v);
    }
    return out;
  }

  const d = [0, 0, 0];
  /** Altura del agua en el punto del mundo (x, z): invierte el desplazamiento horizontal. */
  function heightAt(x, z) {
    let px = x, pz = z;
    for (let i = 0; i < 4; i++) {
      displacement(px, pz, d);
      px = x - d[0];
      pz = z - d[2];
    }
    return displacement(px, pz, d)[1];
  }

  return { update, displacement, heightAt, sizes };
}
