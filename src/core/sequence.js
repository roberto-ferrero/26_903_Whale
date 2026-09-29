/**
 * Secuencia completa (Fase 7.1; ampliada con la respiración el 29/09/2026):
 *   nado profundo → respira → nada → salta → ondas y espuma (nado en superficie) → respira →
 *   nada → respira → otra vez.
 * Usa la máquina de estados de la ballena (el salto y la respiración se planifican desde donde
 * esté) y controla la profundidad del nado mientras se reproduce. Con "Cámaras automáticas" pasa la
 * cámara a cinemática y dirige los planos según el paso y el estado de la ballena (Fase 7.2).
 */
// pasos: nadar (etiqueta, s y profundidad desde `state`) o acción de la ballena
const STEPS = [
  { id: 'nadar', label: 'nado profundo', time: 'deepTime', depth: 'deepDepth' },
  { id: 'respirar', label: 'respira' },
  { id: 'nadar', label: 'nado', time: 'swimTime', depth: 'swimDepth' },
  { id: 'saltar', label: 'salto' },
  { id: 'nadar', label: 'ondas y espuma', time: 'surfaceTime', depth: 'surfaceDepth' },
  { id: 'respirar', label: 'respira' },
  { id: 'nadar', label: 'nado', time: 'swimTime', depth: 'swimDepth' },
  { id: 'respirar', label: 'respira' },
];
export const SEQ_PHASES = STEPS.map((s) => s.label);

// plano de cada momento: paso de nado (por su etiqueta) o estado de la ballena en las acciones
const SHOTS = {
  'nado profundo': 'Bajo el agua',
  nado: 'Bajo el agua',
  'ondas y espuma': 'Aérea',
  // salto
  preparar: 'Hacia la luz (desde abajo)',
  saltar: 'Barco',
  caer: 'Ras de agua',
  recuperar: 'Cruce de superficie',
  // respiración
  subir: 'Hacia la luz (desde abajo)',
  respirar: 'Soplido (cerca)',
  bajar: 'Cruce de superficie',
};

export function createSequence({ fsm, cameras, helpers, anchor, skeleton }) {
  const state = {
    playing: false,
    loop: true,
    deepTime: 8, // s de nado profundo al empezar
    deepDepth: 14, // m
    swimTime: 6, // s de nado entre respiraciones (inmersión corta)
    swimDepth: 6, // m
    surfaceTime: 7, // s mirando las ondas y la espuma después del salto
    surfaceDepth: 3, // m: nada cerca de la superficie después del salto
    autoCamera: true,
    // lecturas
    phase: '—',
    progress: '',
  };

  let step = -1;
  let t = 0;
  let saved = null; // parámetros de la ballena y de la cámara antes de empezar

  const current = () => STEPS[step] ?? null;

  function setStep(i) {
    step = i;
    t = 0;
    const s = current();
    state.phase = s ? `${i + 1}/${STEPS.length} · ${s.label}` : '—';
    if (!s) return;
    if (s.id === 'nadar') fsm.params.depth = state[s.depth];
    else if (s.id === 'saltar') fsm.jump();
    else if (s.id === 'respirar') fsm.breathe();
  }
  function next() {
    if (step + 1 < STEPS.length) setStep(step + 1);
    else if (state.loop) setStep(0);
    else stop();
  }

  function play() {
    if (!saved) {
      saved = {
        depth: fsm.params.depth, autoJump: fsm.params.autoJump, autoBreath: fsm.params.autoBreath, enabled: fsm.params.enabled,
        mode: cameras.state.mode, rail: cameras.state.rail, hardCuts: cameras.state.hardCuts,
        showPath: fsm.params.showPath, axes: helpers?.state.axes,
        marker: anchor?.state.marker, dropLine: anchor?.state.dropLine, bone: skeleton?.state.showSelected,
      };
      // en los planos cinematográficos no se ven las ayudas de depuración
      fsm.params.showPath = false;
      fsm.apply?.();
      if (helpers) { helpers.state.axes = false; helpers.apply(); }
      if (anchor) { anchor.state.marker = false; anchor.state.dropLine = false; anchor.apply(); }
      if (skeleton) { skeleton.state.showSelected = false; skeleton.apply(); }
    }
    if (!fsm.params.enabled) fsm.setEnabled(true);
    fsm.params.autoJump = false;
    fsm.params.autoBreath = false;
    if (state.autoCamera) {
      cameras.state.mode = 'Cinemática';
      cameras.state.rail = 'Director (cortes)';
      cameras.state.hardCuts = true; // cortes secos; el cruce de superficie ya es un travelling
      cameras.apply();
      cameras.setDirector((whaleState) => {
        const s = current();
        if (!s) return null;
        if (s.id === 'nadar') return SHOTS[s.label];
        // acción recién acabada (la ballena ya nada, el paso cambia en este fotograma): el plano del
        // paso siguiente, para no intercalar un fotograma del plano por defecto
        if (whaleState === 'nadar') return SHOTS[STEPS[(step + 1) % STEPS.length].label] ?? null;
        return SHOTS[whaleState] ?? null;
      });
    }
    state.playing = true;
    // si la ballena está en pleno salto o respiración, se espera a que acabe
    const s = fsm.state.current;
    if (s === 'nadar') setStep(0);
    else setStep(STEPS.findIndex((x) => x.id === (['subir', 'respirar', 'bajar'].includes(s) ? 'respirar' : 'saltar')));
  }

  function stop() {
    state.playing = false;
    setStep(-1);
    cameras.setDirector(null);
    if (saved) {
      fsm.params.depth = saved.depth;
      fsm.params.autoJump = saved.autoJump;
      fsm.params.autoBreath = saved.autoBreath;
      fsm.params.showPath = saved.showPath;
      fsm.apply?.();
      if (helpers) { helpers.state.axes = saved.axes; helpers.apply(); }
      if (anchor) { anchor.state.marker = saved.marker; anchor.state.dropLine = saved.dropLine; anchor.apply(); }
      if (skeleton) { skeleton.state.showSelected = saved.bone; skeleton.apply(); }
      cameras.state.hardCuts = saved.hardCuts;
      if (state.autoCamera) {
        cameras.state.mode = saved.mode;
        cameras.state.rail = saved.rail;
        cameras.apply();
      }
      saved = null;
    }
  }

  return {
    state,
    steps: STEPS,
    play,
    stop,
    /** Botón de la GUI: reproducir desde el principio (o parar si ya se reproduce). */
    toggle() { if (state.playing) stop(); else play(); },
    /** Salta directamente al paso del salto (disparo manual). */
    jumpNow() { if (!state.playing) play(); if (fsm.state.current === 'nadar') setStep(STEPS.findIndex((x) => x.id === 'saltar')); },
    /** Salta directamente a la primera respiración. */
    breatheNow() { if (!state.playing) play(); if (fsm.state.current === 'nadar') setStep(STEPS.findIndex((x) => x.id === 'respirar')); },
    update(dt) {
      const s = current();
      if (!state.playing || !s) return;
      t += dt;
      if (s.id === 'nadar') {
        state.progress = `${t.toFixed(1)} / ${state[s.time]} s`;
        if (t >= state[s.time]) next();
      } else {
        state.progress = fsm.state.label;
        // la máquina de estados vuelve a "nadar" al acabar el plan
        if (t > 1 && fsm.state.current === 'nadar') next();
      }
    },
  };
}
