/**
 * Secuencia completa del salto (Fase 7.1):
 *   nado profundo → ascenso → salto → impacto → ondas y espuma (nado en superficie) → otra vez.
 * Usa la máquina de estados de la ballena (el salto se planifica desde donde esté) y controla la
 * profundidad del nado y los saltos automáticos mientras se reproduce. Con "Cámaras automáticas"
 * pasa la cámara a cinemática y dirige los planos según la fase (Fase 7.2).
 */
export const SEQ_PHASES = ['nado profundo', 'ascenso y salto', 'ondas y espuma'];

// plano de cada momento: fase de la secuencia o estado de la ballena
const SHOTS = {
  'nado profundo': 'Bajo el agua',
  preparar: 'Hacia la luz (desde abajo)',
  saltar: 'Barco',
  caer: 'Ras de agua',
  recuperar: 'Cruce de superficie',
  'ondas y espuma': 'Aérea',
};

export function createSequence({ fsm, cameras, helpers, anchor }) {
  const state = {
    playing: false,
    loop: true,
    deepTime: 8, // s de nado profundo antes del ascenso
    deepDepth: 16, // m
    surfaceTime: 7, // s mirando las ondas y la espuma después del salto
    surfaceDepth: 3, // m: nada cerca de la superficie después del salto
    autoCamera: true,
    // lecturas
    phase: '—',
    progress: '',
  };

  let phase = null;
  let t = 0;
  let saved = null; // parámetros de la ballena y de la cámara antes de empezar

  function setPhase(p) {
    phase = p;
    t = 0;
    state.phase = p ?? '—';
    if (p === 'nado profundo') fsm.params.depth = state.deepDepth;
    if (p === 'ondas y espuma') fsm.params.depth = state.surfaceDepth;
    if (p === 'ascenso y salto') fsm.jump();
  }

  function play() {
    if (!saved) {
      saved = {
        depth: fsm.params.depth, autoJump: fsm.params.autoJump, enabled: fsm.params.enabled,
        mode: cameras.state.mode, rail: cameras.state.rail, hardCuts: cameras.state.hardCuts,
        showPath: fsm.params.showPath, human: helpers?.state.human, axes: helpers?.state.axes,
        marker: anchor?.state.marker, dropLine: anchor?.state.dropLine,
      };
      // en los planos cinematográficos no se ven las ayudas de depuración
      fsm.params.showPath = false;
      fsm.apply?.();
      if (helpers) { helpers.state.human = false; helpers.state.axes = false; helpers.apply(); }
      if (anchor) { anchor.state.marker = false; anchor.state.dropLine = false; anchor.apply(); }
    }
    if (!fsm.params.enabled) fsm.setEnabled(true);
    fsm.params.autoJump = false;
    if (state.autoCamera) {
      cameras.state.mode = 'Cinemática';
      cameras.state.rail = 'Director (cortes)';
      cameras.state.hardCuts = true; // cortes secos; el cruce de superficie ya es un travelling
      cameras.apply();
      cameras.setDirector((whaleState) => (phase === 'ascenso y salto' ? SHOTS[whaleState] : SHOTS[phase]) ?? null);
    }
    state.playing = true;
    // si la ballena ya está en pleno salto, se espera a que acabe
    setPhase(fsm.state.current === 'nadar' ? 'nado profundo' : 'ascenso y salto');
  }

  function stop() {
    state.playing = false;
    setPhase(null);
    cameras.setDirector(null);
    if (saved) {
      fsm.params.depth = saved.depth;
      fsm.params.autoJump = saved.autoJump;
      fsm.params.showPath = saved.showPath;
      fsm.apply?.();
      if (helpers) { helpers.state.human = saved.human; helpers.state.axes = saved.axes; helpers.apply(); }
      if (anchor) { anchor.state.marker = saved.marker; anchor.state.dropLine = saved.dropLine; anchor.apply(); }
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
    play,
    stop,
    /** Botón de la GUI: reproducir desde el principio (o parar si ya se reproduce). */
    toggle() { if (state.playing) stop(); else play(); },
    /** Salta directamente al ascenso (disparo manual). */
    jumpNow() { if (!state.playing) play(); setPhase('ascenso y salto'); },
    update(dt) {
      if (!state.playing || !phase) return;
      t += dt;
      if (phase === 'nado profundo') {
        state.progress = `${t.toFixed(1)} / ${state.deepTime} s`;
        if (t >= state.deepTime) setPhase('ascenso y salto');
      } else if (phase === 'ascenso y salto') {
        state.progress = fsm.state.label;
        // la máquina de estados vuelve a "nadar" al acabar la recuperación
        if (t > 1 && fsm.state.current === 'nadar') setPhase('ondas y espuma');
      } else if (phase === 'ondas y espuma') {
        state.progress = `${t.toFixed(1)} / ${state.surfaceTime} s`;
        if (t >= state.surfaceTime) {
          if (state.loop) setPhase('nado profundo');
          else stop();
        }
      }
    },
  };
}
