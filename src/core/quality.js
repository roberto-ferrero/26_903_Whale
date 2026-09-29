/**
 * Perfiles de calidad (Fase 8.1). Cada perfil ajusta a la vez los parámetros que más cuestan:
 * escala de render, nubes (resolución, pasos), god rays (pasos), posprocesado, salpicaduras y
 * partículas en suspensión. "Automático" empieza en Alto y baja o sube un nivel según el tiempo
 * de fotograma medido (objetivo: 60 fps → 16,7 ms), con histéresis para no oscilar.
 */
export const QUALITY_LEVELS = ['Bajo', 'Medio', 'Alto', 'Ultra'];

export const PROFILES = {
  Bajo: {
    renderScale: 0.6,
    nubes: { resolution: 0.35, steps: 24, lightSteps: 2 },
    bajoagua: { steps: 6, blur: 0 },
    post: { aa: 'FXAA', bloom: false, motionBlur: false, dof: false, grain: 0 },
    agua: { density: 0.5 },
    snow: 0.5,
  },
  Medio: {
    renderScale: 0.8,
    nubes: { resolution: 0.5, steps: 32, lightSteps: 3 },
    bajoagua: { steps: 10, blur: 1 },
    post: { aa: 'TAA', bloom: true, motionBlur: false, dof: false, grain: 0.04 },
    agua: { density: 0.8 },
    snow: 0.8,
  },
  Alto: {
    renderScale: 1,
    nubes: { resolution: 0.5, steps: 40, lightSteps: 4 },
    bajoagua: { steps: 16, blur: 1 },
    post: { aa: 'TAA', bloom: true, motionBlur: true, dof: true, grain: 0.04 },
    agua: { density: 1 },
    snow: 1,
  },
  Ultra: {
    renderScale: 1.25,
    nubes: { resolution: 0.75, steps: 64, lightSteps: 6 },
    bajoagua: { steps: 20, blur: 1 },
    post: { aa: 'TAA', bloom: true, motionBlur: true, dof: true, grain: 0.04 },
    agua: { density: 1.3 },
    snow: 1.3,
  },
};

export function createQuality({ viewer, clouds, under, post, water, onChange }) {
  const state = {
    profile: 'Alto', // o 'Automático'
    // lecturas
    active: 'Alto',
    frameMs: '',
  };
  const baseRatio = Math.min(window.devicePixelRatio, 2);

  function applyLevel(level) {
    const p = PROFILES[level];
    state.active = level;
    viewer.renderer.setPixelRatio(baseRatio * p.renderScale);
    Object.assign(clouds.state, p.nubes);
    clouds.apply();
    Object.assign(under.state, p.bajoagua, { snow: p.snow });
    under.apply();
    Object.assign(post.state, p.post);
    post.apply();
    Object.assign(water.state, p.agua);
    water.apply();
    onChange?.();
  }

  // modo automático: media móvil del tiempo de fotograma (tiempo real entre fotogramas)
  let avg = 16.7, settle = 0;
  function apply() {
    if (state.profile !== 'Automático') applyLevel(state.profile);
    else { applyLevel('Alto'); settle = 3; }
  }

  return {
    state,
    apply,
    levels: [...QUALITY_LEVELS, 'Automático'],
    applyLevel,
    /** Llamar cada fotograma con el tiempo real transcurrido (s). */
    update(realDt) {
      if (realDt <= 0 || realDt > 0.25) return;
      avg += (realDt * 1000 - avg) * 0.05;
      state.frameMs = `${avg.toFixed(1)} ms (${(1000 / avg).toFixed(0)} fps)`;
      if (state.profile !== 'Automático') return;
      settle -= realDt;
      if (settle > 0) return;
      const i = QUALITY_LEVELS.indexOf(state.active);
      if (avg > 19 && i > 0) { applyLevel(QUALITY_LEVELS[i - 1]); settle = 3; avg = 16.7; }
      else if (avg < 11 && i < 2) { applyLevel(QUALITY_LEVELS[i + 1]); settle = 5; avg = 16.7; }
    },
  };
}
