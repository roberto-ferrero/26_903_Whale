import { G } from './spectrum.js';

/**
 * Prototipo de olas de Gerstner (Fase 4.2): N ondas generadas a partir de pocos parámetros.
 * Cada onda i: dirección d_i, número de onda k_i, amplitud A_i, afilado Q_i, ω_i = √(g·k_i).
 *   fase θ = k·(d·x) − ω·t
 *   desplazamiento: x −= Q·A·d·sin θ, y += A·cos θ (crestas afiladas: dx'/dx = 1 − Q·A·k·cos θ)
 */
export const GERSTNER_COUNT = 8;

export const GERSTNER_DEFAULTS = {
  gAmplitude: 0.5, // m (onda principal)
  gWavelength: 45, // m (onda principal)
  gDirection: 60, // grados desde el norte hacia donde avanza
  gSpread: 35, // grados de dispersión de las direcciones
  gSteepness: 0.6, // 0-1 (1 = crestas en el límite de plegarse)
};

/** Devuelve Float32Array(COUNT·4) [dx, dz, k, A] y Float32Array(COUNT) Q. */
export function buildGerstnerWaves(p) {
  const waves = new Float32Array(GERSTNER_COUNT * 4);
  const q = new Float32Array(GERSTNER_COUNT);
  const base = (p.gDirection * Math.PI) / 180;
  for (let i = 0; i < GERSTNER_COUNT; i++) {
    const lambda = p.gWavelength * 0.72 ** i;
    const k = (2 * Math.PI) / lambda;
    // direcciones repartidas con el ángulo áureo dentro de ±spread
    const t = ((i * 0.618034) % 1) * 2 - 1;
    const ang = base + (i === 0 ? 0 : t * (p.gSpread * Math.PI) / 180);
    const A = p.gAmplitude * (lambda / p.gWavelength) ** 1.1;
    waves.set([Math.sin(ang), -Math.cos(ang), k, A], i * 4);
    q[i] = Math.min(1, p.gSteepness / (k * A * GERSTNER_COUNT));
  }
  return { waves, q };
}

/** Desplazamiento en CPU (misma fórmula que el shader). */
export function gerstnerDisplacement(g, x, z, t, out) {
  out[0] = out[1] = out[2] = 0;
  for (let i = 0; i < GERSTNER_COUNT; i++) {
    const dx = g.waves[i * 4], dz = g.waves[i * 4 + 1], k = g.waves[i * 4 + 2], A = g.waves[i * 4 + 3];
    const th = k * (dx * x + dz * z) - Math.sqrt(G * k) * t;
    const s = Math.sin(th), c = Math.cos(th);
    out[0] -= g.q[i] * A * dx * s;
    out[1] += A * c;
    out[2] -= g.q[i] * A * dz * s;
  }
  return out;
}
